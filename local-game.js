(function exposeLocalGame(root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.ICTQuattleLocal = factory();
}(globalThis, () => {
	const PLAYERS_KEY = 'ict-quattle-local-players';
	const MAX_LEVEL = 100;
	const MAX_HP = 100;
	const BATTLE_TIME_MS = 20_000;
	const MAX_NPC_LEVEL = 110;
	const STORAGE_ERROR = 'Could not save local game data. Check that browser storage is enabled and has space.';
	const legacyNpcNames = {
		2: ['npc-bit', 'Mira Sparks'],
		4: ['npc-circuit', 'Theo Quill'],
		5: ['npc-kernel', 'Nia Orbit'],
		6: ['npc-packet', 'Jules Finch'],
		7: ['npc-pixel', 'Remy Vale'],
		8: ['npc-cache', 'Zara Bloom'],
		9: ['npc-cipher', 'Ellis North'],
		10: ['npc-logic', 'Kai Rowan'],
	};
	const npcFirstNames = ['Ari', 'Blaze', 'Cora', 'Dax', 'Echo', 'Freya', 'Gale', 'Hale', 'Indigo', 'Juno', 'Kestrel'];
	const npcLastNames = ['Ashfall', 'Blackwell', 'Cross', 'Dawnbreak', 'Ember', 'Frost', 'Graves', 'Hawke', 'Ironwood', 'Jett', 'Knight', 'Locke', 'Morrow'];

	function createLocalGame(storage, cryptoApi, curriculum) {
		if (!storage || !cryptoApi?.subtle || !curriculum) throw new Error('Local game storage or question data is unavailable.');
		let practiceSession = null;
		let battle = null;
		let npcTimer = null;

		function loadPlayers() {
			let raw;
			try {
				raw = storage.getItem(PLAYERS_KEY);
			} catch {
				throw new Error(STORAGE_ERROR);
			}
			if (raw === null) return [];
			let records;
			try {
				records = JSON.parse(raw);
			} catch {
				throw new Error('Saved local player data is invalid. Clear this site’s saved data to start again.');
			}
			if (!Array.isArray(records) || records.some((player) => !player || typeof player.id !== 'string'
				|| typeof player.usernameKey !== 'string' || typeof player.passwordSalt !== 'string'
				|| typeof player.passwordHash !== 'string' || !Number.isInteger(player.level))) {
				throw new Error('Saved local player data is invalid. Clear this site’s saved data to start again.');
			}
			return records;
		}

		function savePlayers(players) {
			try {
				storage.setItem(PLAYERS_KEY, JSON.stringify(players));
			} catch {
				throw new Error(STORAGE_ERROR);
			}
		}

		function normalizeUsername(value) {
			const username = String(value || '').trim();
			if (!/^[a-zA-Z0-9_-]{3,18}$/.test(username)) {
				throw new Error('Username must be 3–18 characters using letters, numbers, _ or -');
			}
			return { username, usernameKey: username.toLowerCase() };
		}

		function bytesToHex(bytes) {
			return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
		}

		function hexToBytes(hex) {
			return Uint8Array.from(hex.match(/.{2}/g) || [], (byte) => Number.parseInt(byte, 16));
		}

		async function hashPassword(password, salt = null) {
			if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
				throw new Error('Password must be between 8 and 128 characters');
			}
			const saltBytes = salt ? hexToBytes(salt) : cryptoApi.getRandomValues(new Uint8Array(16));
			const key = await cryptoApi.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
			const hash = await cryptoApi.subtle.deriveBits({
				name: 'PBKDF2',
				salt: saltBytes,
				iterations: 150_000,
				hash: 'SHA-256',
			}, key, 256);
			return { passwordSalt: bytesToHex(saltBytes), passwordHash: bytesToHex(hash) };
		}

		function equalHex(first, second) {
			if (first.length !== second.length) return false;
			let difference = 0;
			for (let index = 0; index < first.length; index += 1) difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
			return difference === 0;
		}

		function playerStats(level) {
			const cappedLevel = Math.max(1, Math.min(MAX_LEVEL, level));
			return { attack: 10 + cappedLevel - 1, defence: 2 + Math.floor((cappedLevel - 1) / 2) };
		}

		function addExperience(player, amount) {
			player.totalXp += amount;
			player.xpBalance += amount;
			if (player.level >= MAX_LEVEL) return;
			player.xp += amount;
			while (player.level < MAX_LEVEL && player.xp >= player.level * 100) {
				player.xp -= player.level * 100;
				player.level += 1;
			}
			Object.assign(player, playerStats(player.level));
			if (player.level === MAX_LEVEL) player.xp = 0;
		}

		function getPlayersAndPlayer(id) {
			const players = loadPlayers();
			const player = players.find((record) => record.id === id);
			if (!player) throw new Error('Player session not found');
			return { players, player };
		}

		function savePlayer(players, player) {
			const index = players.findIndex((record) => record.id === player.id);
			if (index < 0) throw new Error('Player session not found');
			players[index] = player;
			savePlayers(players);
		}

		function makeNpcs(level) {
			return Array.from({ length: Math.min(MAX_NPC_LEVEL, level + 10) - 1 }, (_, index) => {
				const npcLevel = index + 2;
				const [id, name] = legacyNpcNames[npcLevel] || [
					`npc-level-${npcLevel}`,
					`${npcFirstNames[(npcLevel - 2) % npcFirstNames.length]} ${npcLastNames[Math.floor((npcLevel - 2) / npcFirstNames.length) % npcLastNames.length]}`,
				];
				return { id, name, level: npcLevel, ...playerStats(npcLevel), hp: MAX_HP };
			});
		}

		function getSubjects() {
			return Object.values(curriculum).map((subject) => {
				const { questions, computerScienceQuestions, rows, ...details } = subject;
				const battleQuestions = [
					...(questions || []),
					...(computerScienceQuestions || []),
				];
				const practiceTopics = subject.practiceTopics || subject.topics || [];
				const battleAvailable = !['business', 'english', 'mathematics'].includes(subject.id);
				return {
					...details,
					practiceTopics,
					questionCount: subject.questionCount || questions?.length || 0,
					topics: subject.topics || practiceTopics,
					battleAvailable,
					battleTopics: [...new Set(battleQuestions.map((question) => question.chapter))],
				};
			});
		}

		function makeQuestion(subjectId, topic = null, battleQuestion = false) {
			const subject = curriculum[subjectId];
			if (!subject) throw new Error('Choose a valid subject');
			let questionPool = [...(subject.questions || []), ...(subject.computerScienceQuestions || [])];
			if (subjectId === 'computers' && curriculum.ict) questionPool.push(...(curriculum.ict.questions || []));
			if (topic) questionPool = questionPool.filter((question) => question.chapter === topic);
			if (!questionPool.length) throw new Error('There are no questions for this subject or chapter yet.');
			const source = questionPool[Math.floor(Math.random() * questionPool.length)];
			const correct = Math.floor(Math.random() * source.options.length);
			const options = [...source.options];
			const [correctAnswer] = options.splice(source.correct, 1);
			options.splice(correct, 0, correctAnswer);
			return {
				id: cryptoApi.randomUUID(),
				chapter: source.chapter,
				prompt: source.prompt,
				options,
				correct,
				hint: source.hint || 'Review the topic and try again.',
				...(battleQuestion ? { difficulty: 1 + Math.floor(Math.random() * 3) } : {}),
			};
		}

		function makeState(id) {
			const { player } = getPlayersAndPlayer(id);
			const availableNpcs = makeNpcs(player.level);
			const battlePlayer = battle?.playerId === id ? battle.player : null;
			return {
				subjects: getSubjects(),
				you: {
					id: player.id,
					name: player.name,
					username: player.username,
					hasPassword: true,
					hp: battlePlayer?.hp ?? MAX_HP,
					xp: player.xp,
					totalXp: player.totalXp,
					xpBalance: player.xpBalance,
					level: player.level,
					maxLevel: MAX_LEVEL,
					nextLevelXp: player.level < MAX_LEVEL ? player.level * 100 : null,
					attack: player.attack,
					defence: player.defence,
					matches: player.matches,
					wins: player.wins,
					losses: player.losses,
					draws: player.draws,
				},
				onlinePlayers: [],
				opponents: [],
				incomingChallenges: [],
				outgoingChallenges: [],
				npcs: availableNpcs,
				battle: battle?.playerId === id ? publicBattle(id) : null,
			};
		}

		function publicBattle(id) {
			if (!battle || battle.playerId !== id) return null;
			const { player, npc, question } = battle;
			return {
				id: battle.id,
				mode: 'npc',
				subject: battle.subject,
				topic: battle.topic,
				status: battle.status,
				round: battle.round,
				bossFight: battle.bossFight,
				levelGap: Math.abs(player.level - npc.level),
				questionId: battle.questionId,
				questionStartedAt: battle.questionStartedAt,
					parryReady: player.level >= 50 && Boolean(battle.parryOpportunity) && question.difficulty !== 3,
				players: [
					{ id: player.id, name: player.name, hp: player.hp, npc: false, level: player.level, attack: player.attack, defence: player.defence, team: 0 },
					{ id: npc.id, name: npc.name, hp: npc.hp, npc: true, level: npc.level, attack: npc.attack, defence: npc.defence, team: 1 },
				],
				teams: [[{ id: player.id, name: player.name }], [{ id: npc.id, name: npc.name }]],
				turnPlayerId: battle.turnPlayerId,
				isYourTurn: battle.status === 'active' && battle.turnPlayerId === id,
				canAnswer: battle.status === 'active' && battle.turnPlayerId === id && player.hp > 0,
				hasAnswered: Boolean(battle.answerFeedback),
				answerFeedback: battle.turnPlayerId === id ? battle.answerFeedback : null,
				answersReceived: 0,
				question: battle.status === 'active' && battle.turnPlayerId === id ? {
					chapter: question.chapter,
					difficulty: question.difficulty,
					prompt: question.prompt,
					options: question.options,
				} : null,
				deadline: battle.deadline,
				winnerId: battle.winnerTeamIndex === null ? null : battle.winnerTeamIndex === 0 ? player.id : npc.id,
				winnerTeamIndex: battle.winnerTeamIndex,
				winnerName: battle.winnerTeamIndex === null ? null : battle.winnerTeamIndex === 0 ? player.name : npc.name,
				xpEarned: battle.xpEarned ?? null,
				hint: battle.hint || null,
				hintUsed: Boolean(battle.hint),
				log: battle.log,
			};
		}

		function startBattleTurn(playerTurn) {
			if (!battle || battle.status !== 'active') return;
			battle.turnPlayerId = playerTurn ? battle.playerId : battle.npc.id;
			battle.round += 1;
			battle.question = makeQuestion(battle.subject, battle.topic, true);
			battle.questionId = cryptoApi.randomUUID();
			battle.questionStartedAt = Date.now();
			battle.deadline = battle.questionStartedAt + BATTLE_TIME_MS;
			battle.answerFeedback = null;
			battle.hint = null;
			if (playerTurn && battle.question.difficulty === 3 && battle.parryOpportunity) {
				battle.log.unshift({ text: `${battle.player.name}'s parry barrier shattered on a hard question.`, kind: 'parry-break', playerId: battle.playerId, targetId: battle.npc.id });
				battle.parryOpportunity = null;
			}
			if (!playerTurn) {
				clearTimeout(npcTimer);
				npcTimer = setTimeout(() => resolveNpcTurn(), 900);
			}
		}

		function finishBattle(winnerTeamIndex, resigned = false) {
			if (!battle || battle.status !== 'active') return;
			clearTimeout(npcTimer);
			battle.status = 'finished';
			battle.winnerTeamIndex = winnerTeamIndex;
			const { players, player } = getPlayersAndPlayer(battle.playerId);
			const draw = winnerTeamIndex === null;
			const won = winnerTeamIndex === 0;
			const xp = resigned ? -50 : draw ? 30 : won ? 80 + Math.max(0, battle.npc.level - 1) * 10 : 30;
			if (!resigned) addExperience(player, xp);
			player.matches += 1;
			if (resigned) player.losses += 1;
			else if (draw) player.draws += 1;
			else if (won) player.wins += 1;
			else player.losses += 1;
			battle.xpEarned = xp;
			battle.log.unshift({
				text: resigned ? `${player.name} resigned and lost 50 XP.` : `${won ? player.name : battle.npc.name} wins the match and earns XP.`,
				kind: 'info',
			});
			battle.log = battle.log.slice(0, 8);
			savePlayer(players, player);
			battle.player.name = player.name;
			battle.player.level = player.level;
			Object.assign(battle.player, playerStats(player.level));
		}

		function damageFor(attacker, defender, multiplier = 1) {
			return Math.round(Math.max(4, 15 + (attacker.attack - 10) - (defender.defence - 2)) * multiplier);
		}

		function resolveNpcTurn() {
			if (!battle || battle.status !== 'active' || battle.turnPlayerId !== battle.npc.id) return;
			const correct = Math.random() < 0.68;
			if (correct) {
				const damage = damageFor(battle.npc, battle.player, battle.question.difficulty === 3 ? 1.5 : 1);
				battle.player.hp = Math.max(0, battle.player.hp - damage);
				battle.npc.hp = Math.min(MAX_HP, battle.npc.hp + 3);
				battle.log.unshift({ text: `${battle.npc.name} landed a correct answer: ${damage} damage${battle.question.difficulty === 3 ? ' (hard question +50%)' : ''}, +3 HP.`, kind: 'hit', playerId: battle.npc.id, targetId: battle.playerId });
				if (battle.player.hp > 0) battle.parryOpportunity = { damage, attackerId: battle.npc.id };
			} else {
				battle.npc.hp = Math.max(0, battle.npc.hp - 14);
				battle.log.unshift({ text: `${battle.npc.name} missed the answer and lost 14 HP.`, kind: 'miss', playerId: battle.npc.id });
				battle.parryOpportunity = null;
			}
			battle.log = battle.log.slice(0, 8);
			if (battle.npc.hp <= 0) finishBattle(0);
			else if (battle.player.hp <= 0) finishBattle(1);
			else startBattleTurn(true);
		}

		function tickBattle() {
			if (!battle || battle.status !== 'active' || battle.turnPlayerId !== battle.playerId || Date.now() < battle.deadline) return;
			battle.player.hp = Math.max(0, battle.player.hp - 14);
			battle.log.unshift({ text: `${battle.player.name} ran out of time and lost 14 HP.`, kind: 'miss', playerId: battle.playerId });
			battle.log = battle.log.slice(0, 8);
			if (battle.player.hp <= 0) finishBattle(1);
			else startBattleTurn(false);
		}

		async function handle(url, options = {}) {
			const parsedUrl = new URL(url, 'https://local-game.invalid');
			const method = options.method || 'GET';
			let body = {};
			if (options.body) {
				try {
					body = JSON.parse(options.body);
				} catch {
					throw new Error('Invalid request data');
				}
			}
			const id = String(body.playerId || parsedUrl.searchParams.get('playerId') || '');

			if (parsedUrl.pathname === '/api/register' && method === 'POST') {
				const account = normalizeUsername(body.username);
				const players = loadPlayers();
				if (players.some((player) => player.usernameKey === account.usernameKey)) throw new Error('That username is already taken');
				const credentials = await hashPassword(body.password);
				const player = {
					id: cryptoApi.randomUUID(),
					name: account.username,
					...account,
					...credentials,
					xp: 0, totalXp: 0, xpBalance: 0, xpSpent: 0, level: 1,
					matches: 0, wins: 0, losses: 0, draws: 0, homeworkRewardDate: '',
				};
				players.push(player);
				savePlayers(players);
				return makeState(player.id);
			}

			if (parsedUrl.pathname === '/api/login' && method === 'POST') {
				let account;
				try {
					account = normalizeUsername(body.username);
				} catch {
					throw new Error('Username or password is incorrect');
				}
				const player = loadPlayers().find((record) => record.usernameKey === account.usernameKey);
				if (!player) throw new Error('Username or password is incorrect');
				const credentials = await hashPassword(body.password, player.passwordSalt);
				if (!equalHex(credentials.passwordHash, player.passwordHash)) throw new Error('Username or password is incorrect');
				return makeState(player.id);
			}

			if (parsedUrl.pathname === '/api/state' && method === 'GET') {
				tickBattle();
				return makeState(id);
			}

			if (parsedUrl.pathname === '/api/account' && method === 'POST') {
				const { players, player } = getPlayersAndPlayer(id);
				const currentPassword = await hashPassword(body.currentPassword, player.passwordSalt);
				if (!equalHex(currentPassword.passwordHash, player.passwordHash)) throw new Error('Current password is incorrect');
				const account = normalizeUsername(body.username);
				if (players.some((candidate) => candidate.id !== id && candidate.usernameKey === account.usernameKey)) {
					throw new Error('That username is already taken');
				}
				const credentials = body.password ? await hashPassword(body.password) : {
					passwordSalt: player.passwordSalt,
					passwordHash: player.passwordHash,
				};
				Object.assign(player, account, credentials, { name: account.username });
				savePlayer(players, player);
				if (battle?.playerId === id) battle.player.name = player.name;
				return makeState(id);
			}

			if (parsedUrl.pathname === '/api/homework-check' && method === 'POST') {
				const { players, player } = getPlayersAndPlayer(id);
				if (body.completed !== true) throw new Error('Confirm that your homework is finished');
				const date = new Date().toISOString().slice(0, 10);
				const xpAwarded = player.homeworkRewardDate === date ? 0 : 2;
				if (xpAwarded) {
					addExperience(player, xpAwarded);
					player.homeworkRewardDate = date;
					savePlayer(players, player);
				}
				return { ...makeState(id), xpAwarded };
			}

			if (parsedUrl.pathname === '/api/practice-question' && method === 'POST') {
				getPlayersAndPlayer(id);
				const question = makeQuestion(String(body.subject || ''), body.topic || null);
				practiceSession = { playerId: id, question, score: practiceSession?.playerId === id && practiceSession.subject === body.subject ? practiceSession.score : 0, attempts: practiceSession?.playerId === id && practiceSession.subject === body.subject ? practiceSession.attempts : 0, subject: body.subject, answered: false };
				const { correct, hint, ...publicQuestion } = question;
				return { question: publicQuestion, score: practiceSession.score, attempts: practiceSession.attempts };
			}

			if (parsedUrl.pathname === '/api/practice-answer' && method === 'POST') {
				const { players, player } = getPlayersAndPlayer(id);
				if (!practiceSession || practiceSession.playerId !== id || practiceSession.question.id !== body.questionId || practiceSession.answered) {
					throw new Error('That question has already ended');
				}
				const selectedIndex = Number(body.answer);
				const correct = selectedIndex === practiceSession.question.correct;
				practiceSession.answered = true;
				practiceSession.attempts += 1;
				if (correct) {
					practiceSession.score += 1;
					addExperience(player, 2);
					savePlayer(players, player);
				}
				return {
					correct,
					correctAnswer: practiceSession.question.options[practiceSession.question.correct],
					correctIndex: practiceSession.question.correct,
					selectedIndex,
					explanation: practiceSession.question.hint,
					score: practiceSession.score,
					attempts: practiceSession.attempts,
					xpAwarded: correct ? 2 : 0,
					progress: {
						xp: player.xp,
						totalXp: player.totalXp,
						xpBalance: player.xpBalance,
						level: player.level,
						nextLevelXp: player.level < MAX_LEVEL ? player.level * 100 : null,
						attack: player.attack,
						defence: player.defence,
					},
				};
			}

			if (parsedUrl.pathname === '/api/battle' && method === 'POST') {
				const { player } = getPlayersAndPlayer(id);
				const npc = makeNpcs(player.level).find((candidate) => candidate.id === body.opponentId);
				if (!npc) throw new Error('Reach a higher level to unlock that arena rival');
				const subject = String(body.subject || '');
				const subjectInfo = getSubjects().find((item) => item.id === subject);
				if (!subjectInfo?.battleAvailable) throw new Error('Choose a subject available for battles');
				const topic = body.topic || null;
				const firstQuestion = makeQuestion(subject, topic, true);
				const npcPlayer = { ...npc, hp: MAX_HP };
				battle = {
					id: cryptoApi.randomUUID(),
					playerId: id,
					player: { ...player, hp: MAX_HP },
					npc: npcPlayer,
					subject,
					topic,
					status: 'active',
					bossFight: npc.level >= 50 || npc.level - player.level >= 5,
					turnPlayerId: id,
					round: 1,
					question: firstQuestion,
					questionId: cryptoApi.randomUUID(),
					questionStartedAt: Date.now(),
					deadline: Date.now() + BATTLE_TIME_MS,
					answerFeedback: null,
					winnerTeamIndex: null,
					xpEarned: null,
					hint: null,
					parryOpportunity: null,
					log: [{ text: `${npc.name} steps into the arena.`, kind: 'info' }],
				};
				return makeState(id);
			}

			if (parsedUrl.pathname === '/api/answer' && method === 'POST') {
				getPlayersAndPlayer(id);
				tickBattle();
				if (!battle || battle.playerId !== id || battle.status !== 'active' || battle.turnPlayerId !== id) {
					throw new Error('It is not your turn');
				}
				if (body.questionId !== battle.questionId) throw new Error('That question has already ended');
				const selectedIndex = Number(body.answer);
				const correct = selectedIndex === battle.question.correct;
				battle.answerFeedback = {
					questionId: battle.questionId,
					correct,
					selectedIndex: Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < battle.question.options.length ? selectedIndex : null,
					selectedAnswer: battle.question.options[selectedIndex] || null,
					correctIndex: battle.question.correct,
					correctAnswer: battle.question.options[battle.question.correct],
				};
				if (correct) {
					const fast = Date.now() - battle.questionStartedAt <= 2_000;
					const multiplier = (fast ? 2 : 1) * (battle.question.difficulty === 3 ? 1.5 : 1);
					const damage = damageFor(battle.player, battle.npc, multiplier);
					battle.npc.hp = Math.max(0, battle.npc.hp - damage);
					battle.player.hp = Math.min(MAX_HP, battle.player.hp + 3);
					const reflected = battle.player.level >= 50 && fast && battle.question.difficulty !== 3 ? battle.parryOpportunity?.damage || 0 : 0;
					if (reflected) battle.npc.hp = Math.max(0, battle.npc.hp - reflected);
					battle.parryOpportunity = null;
					battle.log.unshift({
						text: `${battle.player.name} landed a correct answer: ${damage} damage${battle.question.difficulty === 3 ? ' (hard question +50%)' : ''}${fast ? ' (2× fast answer)' : ''}, +3 HP.${reflected ? ` Parry reflected ${reflected} damage back at ${battle.npc.name}!` : ''}`,
						kind: reflected ? 'parry' : 'hit',
						playerId: id,
						targetId: battle.npc.id,
						reflectedDamage: reflected,
					});
				} else {
					battle.player.hp = Math.max(0, battle.player.hp - 14);
					battle.log.unshift({ text: `${battle.player.name} missed the answer and lost 14 HP.`, kind: 'miss', playerId: id });
					battle.parryOpportunity = null;
				}
				battle.log = battle.log.slice(0, 8);
				if (battle.npc.hp <= 0) finishBattle(0);
				else if (battle.player.hp <= 0) finishBattle(1);
				else startBattleTurn(false);
				return makeState(id);
			}

			if (parsedUrl.pathname === '/api/hint' && method === 'POST') {
				getPlayersAndPlayer(id);
				if (!battle || battle.playerId !== id || battle.status !== 'active' || battle.turnPlayerId !== id) throw new Error('Hints are only available on your active question');
				if (battle.hint) throw new Error('You already used a hint on this question');
				const { players, player } = getPlayersAndPlayer(id);
				if (player.xpBalance < 20) throw new Error('You need 20 XP to buy a hint');
				player.xpBalance -= 20;
				player.xpSpent += 20;
				savePlayer(players, player);
				battle.hint = battle.question.hint;
				return makeState(id);
			}

			if (parsedUrl.pathname === '/api/resign' && method === 'POST') {
				const { players, player } = getPlayersAndPlayer(id);
				if (!battle || battle.playerId !== id || battle.status !== 'active') throw new Error('There is no active match to resign from');
				if (player.xpBalance < 50) throw new Error('You need 50 XP to resign');
				player.xpBalance -= 50;
				player.xpSpent += 50;
				savePlayer(players, player);
				finishBattle(1, true);
				return makeState(id);
			}

			if (parsedUrl.pathname === '/api/leave' && method === 'POST') {
				getPlayersAndPlayer(id);
				if (battle?.playerId === id) {
					clearTimeout(npcTimer);
					battle = null;
				}
				return makeState(id);
			}

			if (parsedUrl.pathname === '/api/study-status' && method === 'POST') {
				getPlayersAndPlayer(id);
				return { ok: true };
			}

			if (parsedUrl.pathname === '/api/study-room' && method === 'GET') {
				getPlayersAndPlayer(id);
				return { studying: [], messages: [] };
			}

			if (parsedUrl.pathname.startsWith('/api/challenge') || parsedUrl.pathname.startsWith('/api/respond')
				|| parsedUrl.pathname.startsWith('/api/study-chat')) {
				throw new Error('Online multiplayer and shared study chat need a game server; they are not available on static GitHub Pages.');
			}

			throw new Error('This feature is not available in local browser mode.');
		}

		return { handle };
	}

	return { createLocalGame };
}));
