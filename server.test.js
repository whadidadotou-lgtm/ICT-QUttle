const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
	SUBJECTS,
	addExperience,
	awardHomeworkXp,
	buildTurnOrder,
	censorProfanity,
	combatStats,
	damageFor,
	getQuestion,
	isStudyRelatedMessage,
	isFastAnswer,
	questionDamageMultiplier,
	getSoloPracticeQuestion,
	getOnlinePlayers,
	answerSoloPracticeQuestion,
	loadSavedPlayers,
	hashPassword,
	normalizeUsername,
	npcWinXp,
	savePlayers,
	verifyPassword,
	MAX_LEVEL,
	MAX_PVP_LEVEL_GAP,
	PARRY_LEVEL,
	getAvailableNpcs,
	levelGapBetweenTeams,
	parryDamageFor,
} = require('./server');

test('online players stay visible while showing whether they can be challenged', () => {
	const now = 100_000;
	const playerMap = new Map([
		['self', { id: 'self', name: 'Self', lastSeen: now, level: 1 }],
		['available', { id: 'available', name: 'Available', lastSeen: now - 1_000, level: 2, attack: 11, defence: 2 }],
		['battling', { id: 'battling', name: 'Battling', lastSeen: now - 2_000, level: 3, attack: 12, defence: 3, battleId: 'battle-1' }],
		['invited', { id: 'invited', name: 'Invited', lastSeen: now - 3_000, level: 4, attack: 13, defence: 3, challengeId: 'challenge-1' }],
		['stale', { id: 'stale', name: 'Stale', lastSeen: now - 45_000, level: 1 }],
	]);

	assert.deepEqual(getOnlinePlayers('self', now, playerMap).map(({ id, status }) => [id, status]), [
		['available', 'available'],
		['battling', 'in-match'],
		['invited', 'invited'],
	]);
});

test('XP thresholds level players up and refresh combat stats', () => {
	const player = { xp: 0, totalXp: 0, xpBalance: 0, level: 1 };

	addExperience(player, 99);
	assert.equal(player.level, 1);
	assert.equal(player.xp, 99);
	assert.deepEqual(combatStats(player.level), { attack: 10, defence: 2 });

	addExperience(player, 1);
	assert.equal(player.level, 2);
	assert.equal(player.xp, 0);
	assert.deepEqual(combatStats(player.level), { attack: 11, defence: 2 });

	addExperience(player, 200);
	assert.equal(player.level, 3);
	assert.equal(player.xp, 0);
	assert.deepEqual(combatStats(player.level), { attack: 12, defence: 3 });
	assert.equal(player.totalXp, 300);
	assert.equal(player.xpBalance, 300);
});

test('progression caps at level 100 and unlocks one new bot for each level', () => {
	assert.equal(MAX_LEVEL, 100);
	const player = { xp: 0, totalXp: 0, xpBalance: 0, level: 1 };
	addExperience(player, 495_000);
	assert.equal(player.level, MAX_LEVEL);
	assert.equal(player.xp, 0);
	assert.deepEqual(combatStats(player.level), { attack: 109, defence: 51 });
	addExperience(player, 100);
	assert.equal(player.level, MAX_LEVEL);
	assert.equal(player.totalXp, 495_100);

	const levelOneBots = getAvailableNpcs(1);
	const levelTwoBots = getAvailableNpcs(2);
	assert.equal(levelOneBots.length, 10);
	assert.equal(levelTwoBots.length, 11);
	assert.equal(levelTwoBots.at(-1).level, 12);
	assert.deepEqual(
		levelTwoBots.filter((npc) => !levelOneBots.some((oldNpc) => oldNpc.id === npc.id)).map((npc) => npc.level),
		[12],
	);
	assert.equal(getAvailableNpcs(MAX_LEVEL).at(-1).level, 110);
});

test('homework check XP is awarded once per date', () => {
	const player = { xp: 0, totalXp: 0, xpBalance: 0, level: 1 };
	assert.equal(awardHomeworkXp(player, '2026-10-28'), 2);
	assert.equal(awardHomeworkXp(player, '2026-10-28'), 0);
	assert.equal(player.totalXp, 2);
	assert.equal(player.xpBalance, 2);
	assert.equal(awardHomeworkXp(player, '2026-10-29'), 2);
	assert.equal(player.totalXp, 4);
});

test('level attack increases damage and defence reduces incoming damage', () => {
	assert.equal(damageFor({ attack: 10 }, { defence: 2 }), 15);
	assert.equal(damageFor({ attack: 11 }, { defence: 2 }), 16);
	assert.equal(damageFor({ attack: 10 }, { defence: 3 }), 14);
	assert.equal(damageFor({ attack: 10 }, { defence: 30 }), 4);
	assert.equal(damageFor({ attack: 10 }, { defence: 2 }, 2), 30);
	assert.equal(damageFor({ attack: 10 }, { defence: 30 }, 2), 8);
	assert.equal(damageFor({ attack: 10 }, { defence: 2 }, 1.5), 23);
	assert.equal(damageFor({ attack: 10 }, { defence: 2 }, 3), 45);
	assert.equal(questionDamageMultiplier({ difficulty: 1 }), 1);
	assert.equal(questionDamageMultiplier({ difficulty: 2 }), 1);
	assert.equal(questionDamageMultiplier({ difficulty: 3 }), 1.5);
	assert.equal(questionDamageMultiplier({ difficulty: 3 }, true), 3);
});

test('correct answers qualify for double damage only within the first two seconds', () => {
	assert.equal(isFastAnswer(10_000, 10_000), true);
	assert.equal(isFastAnswer(10_000, 11_999), true);
	assert.equal(isFastAnswer(10_000, 12_000), true);
	assert.equal(isFastAnswer(10_000, 12_001), false);
	assert.equal(isFastAnswer(10_000, 9_999), false);
});

test('player PvP level-gap checks compare opposing teams only', () => {
	assert.equal(MAX_PVP_LEVEL_GAP, 10);
	const levels = new Map([
		['one', { id: 'one', level: 10 }],
		['two', { id: 'two', level: 20 }],
		['three', { id: 'three', level: 15 }],
		['four', { id: 'four', level: 24 }],
	]);
	assert.equal(levelGapBetweenTeams([['one'], ['two']], levels), 10);
	assert.equal(levelGapBetweenTeams([['one', 'three'], ['two', 'four']], levels), 14);
	assert.equal(levelGapBetweenTeams([['one'], ['four']], levels), 14);
});

test('level 50 parries reflect fast answers except against hard questions', () => {
	const incomingAttack = { attackerId: 'rival', damage: 23 };
	assert.equal(parryDamageFor({ level: PARRY_LEVEL - 1 }, incomingAttack, { difficulty: 1 }, true), 0);
	assert.equal(parryDamageFor({ level: PARRY_LEVEL }, incomingAttack, { difficulty: 1 }, false), 0);
	assert.equal(parryDamageFor({ level: PARRY_LEVEL }, incomingAttack, { difficulty: 3 }, true), 0);
	assert.equal(parryDamageFor({ level: PARRY_LEVEL }, incomingAttack, { difficulty: 1 }, true), 23);
});

test('study chat flags obvious off-topic messages without blocking them', () => {
	assert.equal(isStudyRelatedMessage('Can you explain this homework question?'), true);
	assert.equal(isStudyRelatedMessage('What movie are you watching tonight?'), false);
	assert.equal(isStudyRelatedMessage('Want to play games after school?'), false);
});

test('study chat censors profanity without changing ordinary words', () => {
	assert.equal(censorProfanity('That is shit!'), 'That is ****!');
	assert.equal(censorProfanity('F.u.c.k this!'), '**** this!');
	assert.equal(censorProfanity('The classic is helpful.'), 'The classic is helpful.');
});

test('all Grade 9 syllabus subjects have at least 100 solo practice questions', () => {
	assert.equal(SUBJECTS.length, 11);
	for (const subject of SUBJECTS) {
		assert.ok(subject.questionCount >= 100, `${subject.name} question count`);
		assert.ok(subject.source.length > 0, `${subject.name} curriculum source`);
	}

	for (const subject of SUBJECTS) {
		const result = getSoloPracticeQuestion('practice-player', subject.id);
		assert.ok(result, `${subject.name} has practice questions`);
		assert.equal(result.question.options.length, 4);
		assert.equal('correct' in result.question, false);
		assert.equal('hint' in result.question, false);
		const answerResult = answerSoloPracticeQuestion('practice-player', result.question.id, 0);
		assert.ok(answerResult);
		assert.equal(answerSoloPracticeQuestion('practice-player', 'old-question', 0), null);
		assert.equal(answerSoloPracticeQuestion('practice-player', result.question.id, 0), null);
	}
});

test('winning against higher-level NPCs grants more XP', () => {
	assert.equal(npcWinXp(1), 80);
	assert.equal(npcWinXp(2), 90);
	assert.equal(npcWinXp(5), 120);
	assert.equal(npcWinXp(10), 170);
});

test('online matches alternate the starting team without changing team positions', () => {
	const teams = [['challenger', 'challengerTeammate'], ['opponent', 'opponentTeammate']];
	const originalRandom = Math.random;
	try {
		Math.random = () => 0.25;
		assert.deepEqual(buildTurnOrder(teams, true), ['opponent', 'challenger', 'opponentTeammate', 'challengerTeammate']);
		Math.random = () => 0.75;
		assert.deepEqual(buildTurnOrder(teams, true), ['challenger', 'opponent', 'challengerTeammate', 'opponentTeammate']);
	} finally {
		Math.random = originalRandom;
	}
	assert.deepEqual(buildTurnOrder([['player'], ['npc']], false), ['player', 'npc']);
});

test('player levels, XP, and match records survive saving and loading', (context) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ict-quattle-save-'));
	context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const filePath = path.join(directory, 'players.json');
	const originalPlayers = new Map([['player-one', {
		id: 'player-one',
		name: 'Test Player',
		xp: 75,
		totalXp: 475,
		xpBalance: 400,
		xpSpent: 25,
		level: 3,
		matches: 9,
		wins: 5,
		losses: 3,
		draws: 1,
		homeworkRewardDate: '2026-10-28',
		hp: 24,
		attack: 12,
		defence: 3,
		battleId: 'old-battle',
	}]]);

	savePlayers(filePath, originalPlayers);
	const restoredPlayers = loadSavedPlayers(filePath);
	assert.equal(restoredPlayers.size, 1);
	assert.deepEqual(
		Object.fromEntries(['name', 'xp', 'totalXp', 'xpBalance', 'xpSpent', 'level', 'matches', 'wins', 'losses', 'draws']
			.map((field) => [field, restoredPlayers.get('player-one')[field]])),
		{
			name: 'Test Player',
			xp: 75,
			totalXp: 475,
			xpBalance: 400,
			xpSpent: 25,
			level: 3,
			matches: 9,
			wins: 5,
			losses: 3,
			draws: 1,
		},
	);
	assert.equal(restoredPlayers.get('player-one').hp, 100);
	assert.equal(restoredPlayers.get('player-one').homeworkRewardDate, '2026-10-28');
	assert.equal(restoredPlayers.get('player-one').battleId, null);
	assert.deepEqual(loadSavedPlayers(path.join(directory, 'not-created.json')), new Map());
});

test('account usernames are normalized uniquely and passwords are stored as verifiable salted hashes', () => {
	assert.deepEqual(normalizeUsername('  ByteKnight  '), { username: 'ByteKnight', usernameKey: 'byteknight' });
	assert.throws(() => normalizeUsername('ab'), /3–18 characters/);
	assert.throws(() => normalizeUsername('name with spaces'), /3–18 characters/);

	const firstCredentials = hashPassword('correct horse battery');
	const secondCredentials = hashPassword('correct horse battery');
	const player = { ...firstCredentials };
	assert.notEqual(firstCredentials.passwordSalt, secondCredentials.passwordSalt);
	assert.notEqual(firstCredentials.passwordHash, secondCredentials.passwordHash);
	assert.equal(verifyPassword('correct horse battery', player), true);
	assert.equal(verifyPassword('incorrect password', player), false);
	assert.equal(verifyPassword('x'.repeat(200), player), false);
	assert.throws(() => hashPassword('short'), /8 and 128 characters/);
});

test('account credentials survive saved-player reloads without exposing passwords', (context) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ict-quattle-account-'));
	context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const filePath = path.join(directory, 'players.json');
	const credentials = hashPassword('saved profile password');
	const accountPlayer = {
		id: 'account-player',
		name: 'SavedPlayer',
		username: 'SavedPlayer',
		usernameKey: 'savedplayer',
		...credentials,
		xp: 0,
		totalXp: 0,
		xpBalance: 0,
		xpSpent: 0,
		level: 1,
		matches: 0,
		wins: 0,
		losses: 0,
		draws: 0,
	};

	savePlayers(filePath, new Map([[accountPlayer.id, accountPlayer]]));
	const restored = loadSavedPlayers(filePath).get(accountPlayer.id);
	assert.equal(restored.username, 'SavedPlayer');
	assert.equal(verifyPassword('saved profile password', restored), true);
	assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8'))[0].passwordHash, credentials.passwordHash);
});

test('battle questions sample all difficulty pools without a level filter', () => {
	const originalRandom = Math.random;
	try {
		const seenQuestions = new Set();
		const seenDifficulties = new Set();
		const totalQuestions = 65;
		for (let index = 0; index < totalQuestions; index += 1) {
			Math.random = () => index / totalQuestions;
			const question = getQuestion('scripture');
			assert.ok(question);
			seenQuestions.add(question.prompt);
			seenDifficulties.add(question.difficulty || 1);
		}
		assert.equal(seenQuestions.size, totalQuestions);
		assert.deepEqual([...seenDifficulties].sort(), [1, 2, 3]);
	} finally {
		Math.random = originalRandom;
	}
});

test('question pools have expanded coverage and rotate correct answer positions', () => {
	const scripture = SUBJECTS.find((subject) => subject.id === 'scripture');
	assert.ok(scripture);
	assert.equal(scripture.grade, 9);
	assert.equal(scripture.topics.length, 5);

	const originalRandom = Math.random;
	try {
		for (const [subject, count] of [['scripture', 65]]) {
			const seenQuestions = new Set();
			const positions = [];
			for (let index = 0; index < count; index += 1) {
				Math.random = () => index / count;
				const question = getQuestion(subject);
				seenQuestions.add(question.prompt);
				positions.push(question.correct);
				assert.equal(question.options.length, 4);
				assert.ok(question.correct >= 0 && question.correct < 4);
				if (subject === 'scripture') assert.ok(scripture.topics.includes(question.chapter));
			}
			assert.equal(seenQuestions.size, count);
			assert.deepEqual(
				positions,
				Array.from({ length: count }, (_, index) => (positions[0] + index) % 4),
			);
			if (subject === 'scripture') {
				for (const reference of ['Romans 3:23', 'Romans 6:23', '1 John 3:4', 'Mark 1:38', 'Mark 2:17', 'Mark 10:45']) {
					assert.ok([...seenQuestions].some((prompt) => prompt.includes(reference)), `Missing memory verse: ${reference}`);
				}
			}
		}
	} finally {
		Math.random = originalRandom;
	}
});

test('Computers and Scripture topic filters only return questions from populated syllabus topics', () => {
	const computers = SUBJECTS.find((subject) => subject.id === 'computers');
	const scripture = SUBJECTS.find((subject) => subject.id === 'scripture');
	assert.ok(computers);
	assert.equal(SUBJECTS.some((subject) => ['ict', 'computer-science'].includes(subject.id)), false);
	assert.deepEqual(computers.practiceTopics.slice().sort(), computers.topics.slice().sort());
	assert.ok(computers.practiceTopics.includes('1.2'));
	assert.ok(computers.practiceTopics.includes('Cyber security'));
	assert.ok(computers.source.some((source) => source.includes('0417')));
	assert.ok(computers.source.some((source) => source.includes('0478')));
	assert.deepEqual(scripture.practiceTopics, [
		'Ch 1: The Beginning of the Gospel of Mark',
		'Ch 2: Christ and the Multitudes',
		'Ch 3: Christ and the Sick (through page 43, including the leper)',
		'Making choices and the consequences: Abraham, Lot, David, and Solomon',
		'Memory Verses (KJV)',
	]);

	for (const subject of [computers, scripture]) {
		assert.deepEqual(subject.practiceTopics.slice().sort(), subject.topics.slice().sort());
		for (const topic of subject.practiceTopics) {
			const practiceQuestion = getSoloPracticeQuestion(`${subject.id}-topic-player`, subject.id, topic);
			assert.equal(practiceQuestion.question.chapter, topic);
			assert.equal(getSoloPracticeQuestion(`${subject.id}-topic-player`, subject.id, 'not-a-topic'), null);
		}
		for (const topic of subject.battleTopics) {
			assert.equal(getQuestion(subject.id, topic).chapter, topic);
		}
	}
});

test('all subjects except English, Mathematics, and Business support battles by populated chapter', () => {
	assert.deepEqual(
		SUBJECTS.filter((subject) => !subject.battleAvailable).map((subject) => subject.id).sort(),
		['business', 'english', 'mathematics'],
	);
	for (const subject of SUBJECTS) {
		assert.ok(subject.practiceTopics.length, `${subject.id} exposes practice chapters`);
		for (const topic of subject.practiceTopics) {
			const question = getSoloPracticeQuestion(`${subject.id}-${topic}`, subject.id, topic);
			assert.ok(question, `${subject.id} has a practice question in ${topic}`);
			assert.equal(question.question.chapter, topic);
		}
	}
	for (const subject of SUBJECTS.filter((item) => item.battleAvailable)) {
		assert.ok(subject.battleTopics.length, `${subject.id} exposes battle chapters`);
		for (const topic of subject.battleTopics) {
			const question = getQuestion(subject.id, topic);
			assert.ok(question, `${subject.id} has a question in ${topic}`);
			assert.equal(question.chapter, topic);
			assert.equal(question.options.length, 4);
		}
	}
});

test('Business Studies practice questions use short case-study prompts', () => {
	const business = require('./grade9-practice').business;
	assert.ok(business.questions.length >= 100);
	assert.ok(business.questions.every((question) => /case:/i.test(question.prompt)));
	assert.ok(business.questions.every((question) => question.prompt.length < 240));
});
