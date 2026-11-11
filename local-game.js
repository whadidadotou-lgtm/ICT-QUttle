(function exposeLocalGame(root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.ICTQuattleLocal = factory();
}(globalThis, () => {
	const PLAYERS_KEY = 'ict-quattle-local-players';
	const MAX_LEVEL = 100;
	const MAX_HP = 100;
	const BATTLE_TIME_MS = 20_000;
	const MAX_NPC_LEVEL = 110;
	const SOLO_PRACTICE_XP = 1;
	const STORAGE_ERROR = 'Could not save local game data. Check that browser storage is enabled and has space.';
	const subjectRivals = {
		chemistry: 'Prannoy',
		english: 'Prannoy',
		french: 'Prannoy',
		biology: 'Stalin',
		physics: 'Stalin',
		hindi: 'Joshua',
		computers: 'Solomon',
		mathematics: 'Mira',
		business: 'Avery',
		scripture: 'Noah',
	};
	const subjectBotNames = {
		chemistry: ['Copper', 'Molecule', 'Beaker', 'Catalyst', 'Helium', 'Isotope'],
		english: ['Quill', 'Sonnet', 'Fable', 'Verse', 'Syntax', 'Novel'],
		french: ['Amelie', 'Marcel', 'Colette', 'Remy', 'Luc', 'Odette'],
		biology: ['Cell', 'Mitosis', 'Neuron', 'Spore', 'Coral', 'Iris'],
		physics: ['Photon', 'Vector', 'Comet', 'Orbit', 'Quark', 'Nova'],
		hindi: ['Asha', 'Kiran', 'Meera', 'Arjun', 'Tara', 'Dev'],
		computers: ['Pixel', 'Byte', 'Kernel', 'Cipher', 'Nexus', 'Logic'],
		mathematics: ['Sigma', 'Tangent', 'Matrix', 'Prime', 'Vector', 'Delta'],
		business: ['Ledger', 'Market', 'Equity', 'Pioneer', 'Summit', 'Harbor'],
		scripture: ['Noah', 'Esther', 'Micah', 'Ruth', 'Jonah', 'Levi'],
	};

	function createLocalGame(storage, cryptoApi, curriculum) {
		if (!storage || !cryptoApi?.subtle || !curriculum) throw new Error('Local game storage or question data is unavailable.');
		let practiceSession = null;
		let battle = null;
		let npcTimer = null;
		const questionHistory = new Map();

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

		function createSubjectProgress(source = {}) {
			if (!source || typeof source !== 'object' || Array.isArray(source)) {
				throw new Error('Saved local subject progress is invalid. Clear this site’s saved data to start again.');
			}
			return Object.fromEntries(Object.keys(curriculum).map((subjectId) => {
				const value = source[subjectId] || {};
				const level = Number.isInteger(value.level) ? value.level : 1;
				const xp = Number.isInteger(value.xp) ? value.xp : 0;
				if (level < 1 || level > MAX_LEVEL || xp < 0
					|| (value.challengePending !== undefined && typeof value.challengePending !== 'boolean')) {
					throw new Error('Saved local subject progress is invalid. Clear this site’s saved data to start again.');
				}
				return [subjectId, {
					level,
					xp,
					challengePending: value.challengePending === true || (level < MAX_LEVEL && xp >= level * 100),
				}];
			}));
		}

		function progressFor(player, subjectId) {
			if (!curriculum[subjectId]) throw new Error('Choose a valid subject');
			player.subjectProgress ||= createSubjectProgress();
			player.subjectProgress[subjectId] ||= { level: 1, xp: 0, challengePending: false };
			return player.subjectProgress[subjectId];
		}

		function syncAggregateLevel(player) {
			player.level = Math.max(...Object.keys(curriculum).map((subjectId) => progressFor(player, subjectId).level));
			player.xp = 0;
			player.stalinChallengePending = false;
			Object.assign(player, playerStats(player.level));
		}

		function getSubjectRival(subjectId) {
			return subjectRivals[subjectId] || 'Avery';
		}

		function bossOpening(name) {
			const lines = {
				Prannoy: 'I am rooting for you, but I will not make this easy. Show me what you know.',
				Stalin: 'You think you are ready? Prove it. I expect you to fail.',
				Joshua: 'Welcome to my arena. Try to keep up with the smartest person here: me.',
				Solomon: 'The stage is set. Keep the rhythm if you want to keep up.',
				Avery: 'Let us see if you can handle this challenge.',
			};
			return lines[name] || lines.Avery;
		}

		function bossDialogue(name, won) {
			const lines = {
				Prannoy: won
					? 'All right, you earned that one. Keep going; I know you can get even sharper.'
					: 'You were close, but close is not correct. Take another look; I know you can do better.',
				Stalin: won
					? 'Do not celebrate. One win does not make you clever.'
					: 'That was pathetic. Go study before you waste my time again.',
				Joshua: won
					? 'Impressive, but I am still the greatest mind in this arena.'
					: 'Naturally, I won. Nobody here can match my brilliance.',
				Solomon: won
					? 'You found the rhythm this time. I will be ready for the next round.'
					: 'You missed the beat, and I danced away with the win.',
				Avery: won
					? 'You got lucky. I will be ready next time.'
					: 'That was an easy question. Come back when you are ready.',
			};
			return lines[name] || lines.Avery;
		}

		function makeNpc(subjectId, level, playerLevel) {
			const names = subjectBotNames[subjectId] || subjectBotNames.scripture;
			const bossFight = level >= 50 || level % 10 === 0 || level - playerLevel >= 5;
			return {
				id: `npc-${subjectId}-${level}`,
				name: bossFight ? getSubjectRival(subjectId) : `${names[(level - 1) % names.length]} ${level}`,
				level,
				bossFight,
				...playerStats(level),
				hp: MAX_HP,
			};
		}

		function makeNpcs(level, subjectId) {
			const lowestLevel = Math.max(1, level - 9);
			const highestLevel = Math.min(MAX_NPC_LEVEL, level + 10);
			return Array.from({ length: Math.max(0, highestLevel - lowestLevel + 1) }, (_, index) =>
				makeNpc(subjectId, lowestLevel + index, level));
		}

		function completeSubjectChallenge(player, subjectId) {
			const progress = progressFor(player, subjectId);
			if (!progress.challengePending || progress.level >= MAX_LEVEL) return false;
			progress.xp -= progress.level * 100;
			progress.level += 1;
			progress.challengePending = progress.level < MAX_LEVEL && progress.xp >= progress.level * 100;
			if (progress.level === MAX_LEVEL) {
				progress.xp = 0;
				progress.challengePending = false;
			}
			syncAggregateLevel(player);
			return true;
		}

		function addExperience(player, amount, subjectId = null) {
			player.totalXp += amount;
			player.xpBalance += amount;
			if (!subjectId) return;
			const progress = progressFor(player, subjectId);
			if (progress.level >= MAX_LEVEL) return;
			progress.xp += amount;
			if (progress.xp >= progress.level * 100) progress.challengePending = true;
			syncAggregateLevel(player);
		}

		function getPlayersAndPlayer(id) {
			const players = loadPlayers();
			const player = players.find((record) => record.id === id);
			if (!player) throw new Error('Player session not found');
			player.subjectProgress ||= createSubjectProgress();
			return { players, player };
		}

		function savePlayer(players, player) {
			const index = players.findIndex((record) => record.id === player.id);
			if (index < 0) throw new Error('Player session not found');
			players[index] = player;
			savePlayers(players);
		}

		function getSubjects() {
			return Object.values(curriculum).map((subject) => {
				const { questions, computerScienceQuestions, rows, ...details } = subject;
				const battleQuestions = [
					...(questions || []),
					...(computerScienceQuestions || []),
				];
				const practiceTopics = subject.practiceTopics || subject.topics || [];
				const battleAvailable = true;
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

		function chooseQuestion(questionPool, playerIds, subjectId) {
			const histories = playerIds.map((playerId) => {
				const key = `${playerId}:${subjectId}`;
				let history = questionHistory.get(key);
				if (!history) {
					history = [];
					questionHistory.set(key, history);
				}
				return history;
			});
			const unseenQuestions = questionPool.filter((question) => histories.every((history) => !history.includes(question.prompt)));
			const choices = unseenQuestions.length ? unseenQuestions : questionPool;
			const question = choices[Math.floor(Math.random() * choices.length)];
			for (const history of histories) {
				history.push(question.prompt);
				if (history.length > 40) history.shift();
			}
			return question;
		}

		function makeQuestion(subjectId, topic = null, battleQuestion = false, playerIds = []) {
			const subject = curriculum[subjectId];
			if (!subject) throw new Error('Choose a valid subject');
			let questionPool = [...(subject.questions || []), ...(subject.computerScienceQuestions || [])];
			if (subjectId === 'computers' && curriculum.ict) questionPool.push(...(curriculum.ict.questions || []));
			if (topic) questionPool = questionPool.filter((question) => question.chapter === topic);
			if (!questionPool.length) throw new Error('There are no questions for this subject or chapter yet.');
			const source = chooseQuestion(questionPool, playerIds, subjectId);
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

		function getStudyGuide(subjectId, topic) {
			const subject = curriculum[subjectId];
			if (!subject || typeof topic !== 'string' || !topic.trim()) return null;
			const questions = [
				...(subject.questions || []),
				...(subject.computerScienceQuestions || []),
			].filter((question) => question.chapter === topic);
			if (!questions.length) return null;
			return {
				subject: subject.name,
				topic,
				coachIntro: `Let's work through ${topic} in ${subject.name}, one idea at a time.`,
				encouragement: 'Take your time, connect each idea to an example, and ask yourself why it works.',
				explanations: [...new Set(questions.map((question) => question.hint).filter(Boolean))].slice(0, 6),
			};
		}

		function makeState(id, selectedSubject = 'computers') {
			const { player } = getPlayersAndPlayer(id);
			const subjectId = battle?.playerId === id ? battle.subject : selectedSubject;
			const progress = progressFor(player, subjectId);
			const availableNpcs = makeNpcs(progress.level, subjectId);
			const battlePlayer = battle?.playerId === id ? battle.player : null;
			return {
				subjects: getSubjects(),
				selectedSubject: subjectId,
				you: {
					id: player.id,
					name: player.name,
					username: player.username,
					hasPassword: true,
					hp: battlePlayer?.hp ?? MAX_HP,
					xp: progress.xp,
					totalXp: player.totalXp,
					xpBalance: player.xpBalance,
					level: progress.level,
					maxLevel: MAX_LEVEL,
					stalinChallengePending: Boolean(progress.challengePending),
					nextLevelXp: progress.level < MAX_LEVEL ? progress.level * 100 : null,
					attack: playerStats(progress.level).attack,
					defence: playerStats(progress.level).defence,
					subjectProgress: player.subjectProgress,
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
				levelUpChallenge: Boolean(battle.levelUpChallenge),
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
			battle.question = makeQuestion(battle.subject, battle.topic, true, [battle.playerId]);
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
			if (!resigned) addExperience(player, xp, battle.subject);
			if (battle.levelUpChallenge && won) completeSubjectChallenge(player, battle.subject);
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
			if (battle.bossFight) battle.log.unshift({
				text: `${battle.npc.name}: "${bossDialogue(battle.npc.name, won)}"`,
				kind: 'dialogue',
			});
			battle.log = battle.log.slice(0, 8);
			savePlayer(players, player);
			battle.player.name = player.name;
			battle.player.level = progressFor(player, battle.subject).level;
			Object.assign(battle.player, playerStats(battle.player.level));
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
					xp: 0, totalXp: 0, xpBalance: 0, xpSpent: 0, level: 1, stalinChallengePending: false,
					subjectProgress: createSubjectProgress(),
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
				if (!player) {
					throw new Error('No account with that username exists in this browser. Server accounts are separate from browser-only accounts.');
				}
				const credentials = await hashPassword(body.password, player.passwordSalt);
				if (!equalHex(credentials.passwordHash, player.passwordHash)) throw new Error('Username or password is incorrect');
				return makeState(player.id);
			}

			if (['/api/export-local-account', '/api/export-account'].includes(parsedUrl.pathname) && method === 'POST') {
				let player;
				if (parsedUrl.pathname === '/api/export-account') {
					player = loadPlayers().find((record) => record.id === String(body.playerId || ''));
				} else {
					let account;
					try {
						account = normalizeUsername(body.username);
					} catch {
						throw new Error('Username or password is incorrect');
					}
					player = loadPlayers().find((record) => record.usernameKey === account.usernameKey);
				}
				if (!player) throw new Error('No matching account exists in this browser');
				const credentials = await hashPassword(body.password, player.passwordSalt);
				if (!equalHex(credentials.passwordHash, player.passwordHash)) throw new Error('Username or password is incorrect');
				return {
					format: 'ict-quattle-local-account-v1',
					account: {
						username: player.username,
						xp: player.xp,
						totalXp: player.totalXp,
						xpBalance: player.xpBalance,
						xpSpent: player.xpSpent,
						level: player.level,
						stalinChallengePending: Boolean(player.stalinChallengePending),
						subjectProgress: createSubjectProgress(player.subjectProgress),
						matches: player.matches,
						wins: player.wins,
						losses: player.losses,
						draws: player.draws,
						homeworkRewardDate: player.homeworkRewardDate || '',
					},
				};
			}

			if (parsedUrl.pathname === '/api/state' && method === 'GET') {
				tickBattle();
				return makeState(id, parsedUrl.searchParams.get('subject') || 'computers');
			}

			if (parsedUrl.pathname === '/api/study-guide' && method === 'GET') {
				getPlayersAndPlayer(id);
				const guide = getStudyGuide(parsedUrl.searchParams.get('subject'), parsedUrl.searchParams.get('topic'));
				if (!guide) throw new Error('Choose a subject and topic available in Solo Practice');
				return guide;
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
				return makeState(id, body.subject || 'computers');
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
				return { ...makeState(id, body.subject || 'computers'), xpAwarded };
			}

			if (parsedUrl.pathname === '/api/practice-question' && method === 'POST') {
				getPlayersAndPlayer(id);
				const question = makeQuestion(String(body.subject || ''), body.topic || null, false, [id]);
				practiceSession = { playerId: id, question, score: practiceSession?.playerId === id && practiceSession.subject === body.subject ? practiceSession.score : 0, attempts: practiceSession?.playerId === id && practiceSession.subject === body.subject ? practiceSession.attempts : 0, subject: body.subject, answered: false };
				const { correct, hint, ...publicQuestion } = question;
				return { question: publicQuestion, score: practiceSession.score, attempts: practiceSession.attempts };
			}

			if (parsedUrl.pathname === '/api/practice-answer' && method === 'POST') {
				const { players, player } = getPlayersAndPlayer(id);
				if (!practiceSession || practiceSession.playerId !== id || practiceSession.subject !== body.subject
					|| practiceSession.question.id !== body.questionId || practiceSession.answered) {
					throw new Error('That question has already ended');
				}
				const selectedIndex = Number(body.answer);
				const correct = selectedIndex === practiceSession.question.correct;
				practiceSession.answered = true;
				practiceSession.attempts += 1;
				if (correct) {
					practiceSession.score += 1;
					addExperience(player, SOLO_PRACTICE_XP, practiceSession.subject);
					savePlayer(players, player);
				}
				const progress = progressFor(player, practiceSession.subject);
				return {
					correct,
					correctAnswer: practiceSession.question.options[practiceSession.question.correct],
					correctIndex: practiceSession.question.correct,
					selectedIndex,
					explanation: practiceSession.question.hint,
					score: practiceSession.score,
					attempts: practiceSession.attempts,
					xpAwarded: correct ? SOLO_PRACTICE_XP : 0,
					progress: {
						xp: progress.xp,
						totalXp: player.totalXp,
						xpBalance: player.xpBalance,
						level: progress.level,
						stalinChallengePending: Boolean(progress.challengePending),
						nextLevelXp: progress.level < MAX_LEVEL ? progress.level * 100 : null,
						attack: playerStats(progress.level).attack,
						defence: playerStats(progress.level).defence,
					},
				};
			}

			if (parsedUrl.pathname === '/api/battle' && method === 'POST') {
				const { player } = getPlayersAndPlayer(id);
				const subject = String(body.subject || '');
				const subjectInfo = getSubjects().find((item) => item.id === subject);
				if (!subjectInfo?.battleAvailable) throw new Error('Choose a subject available for battles');
				const progress = progressFor(player, subject);
				if (progress.challengePending) throw new Error(`Beat ${getSubjectRival(subject)} in your ${subjectInfo.name} level-up challenge before starting another battle`);
				const npc = makeNpcs(progress.level, subject).find((candidate) => candidate.id === body.opponentId);
				if (!npc) throw new Error('That bot is not available for this subject at your current level');
				const topic = body.topic || null;
				const firstQuestion = makeQuestion(subject, topic, true, [id]);
				const npcPlayer = { ...npc, hp: MAX_HP };
				battle = {
					id: cryptoApi.randomUUID(),
					playerId: id,
					player: { ...player, level: progress.level, ...playerStats(progress.level), hp: MAX_HP },
					npc: npcPlayer,
					subject,
					topic,
					status: 'active',
					levelUpChallenge: false,
					bossFight: npc.bossFight,
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
					log: [npc.bossFight
						? { text: `${npc.name}: "${bossOpening(npc.name)}"`, kind: 'info' }
						: { text: `${npc.name} steps into the arena.`, kind: 'info' }],
				};
				return makeState(id, subject);
			}

			if (parsedUrl.pathname === '/api/stalin-challenge' && method === 'POST') {
				const { player } = getPlayersAndPlayer(id);
				if (battle?.status === 'active') throw new Error('Finish your current battle first');
				const subject = String(body.subject || '');
				const subjectInfo = getSubjects().find((item) => item.id === subject);
				if (!subjectInfo?.battleAvailable) throw new Error('Choose a subject available for battles');
				const progress = progressFor(player, subject);
				if (!progress.challengePending) throw new Error(`${getSubjectRival(subject)} has not challenged you to a level-up battle`);
				const topic = body.topic || null;
				if (topic && !subjectInfo.battleTopics.includes(topic)) throw new Error('Choose a valid topic for this battle');
				const npcPlayer = {
					id: `npc-${subject}-${progress.level}`,
					name: getSubjectRival(subject),
					level: progress.level,
					bossFight: true,
					...playerStats(progress.level),
					hp: MAX_HP,
				};
				battle = {
					id: cryptoApi.randomUUID(),
					playerId: id,
					player: { ...player, level: progress.level, ...playerStats(progress.level), hp: MAX_HP },
					npc: npcPlayer,
					subject,
					topic,
					status: 'active',
					levelUpChallenge: true,
					bossFight: true,
					turnPlayerId: id,
					round: 1,
					question: makeQuestion(subject, topic, true, [id]),
					questionId: cryptoApi.randomUUID(),
					questionStartedAt: Date.now(),
					deadline: Date.now() + BATTLE_TIME_MS,
					answerFeedback: null,
					winnerTeamIndex: null,
					xpEarned: null,
					hint: null,
					parryOpportunity: null,
					log: [{ text: `${npcPlayer.name}: "${bossOpening(npcPlayer.name)}"`, kind: 'info' }],
				};
				return makeState(id, subject);
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
				return makeState(id, battle.subject);
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
				return makeState(id, battle.subject);
			}

			if (parsedUrl.pathname === '/api/resign' && method === 'POST') {
				const { players, player } = getPlayersAndPlayer(id);
				if (!battle || battle.playerId !== id || battle.status !== 'active') throw new Error('There is no active match to resign from');
				if (player.xpBalance < 50) throw new Error('You need 50 XP to resign');
				player.xpBalance -= 50;
				player.xpSpent += 50;
				savePlayer(players, player);
				finishBattle(1, true);
				return makeState(id, battle.subject);
			}

			if (parsedUrl.pathname === '/api/leave' && method === 'POST') {
				getPlayersAndPlayer(id);
				if (battle?.playerId === id) {
					clearTimeout(npcTimer);
					battle = null;
				}
				return makeState(id, body.subject || 'computers');
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
