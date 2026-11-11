const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const test = require('node:test');
const grade9Practice = require('./grade9-practice');
const { createLocalGame } = require('./local-game');

function createStorage() {
	const values = new Map();
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, String(value)),
		values,
	};
}

function post(api, route, body) {
	return api.handle(route, { method: 'POST', body: JSON.stringify(body) });
}

test('local accounts enforce unique usernames and store password hashes, not plaintext passwords', async () => {
	const storage = createStorage();
	const api = createLocalGame(storage, webcrypto, grade9Practice);
	const registered = await post(api, '/api/register', { username: 'StudyKnight', password: 'strong password' });

	assert.equal(registered.you.username, 'StudyKnight');
	assert.equal(registered.you.level, 1);
	assert.equal(storage.values.get('ict-quattle-local-players').includes('strong password'), false);
	await assert.rejects(
		post(api, '/api/register', { username: 'studyknight', password: 'another password' }),
		/username is already taken/i,
	);
	await assert.rejects(
		post(api, '/api/login', { username: 'StudyKnight', password: 'wrong password' }),
		/incorrect/i,
	);
	await assert.rejects(
		post(api, '/api/login', { username: 'ServerPlayer', password: 'strong password' }),
		/no account.*in this browser.*server accounts are separate/i,
	);
	const signedIn = await post(api, '/api/login', { username: 'studyknight', password: 'strong password' });
	assert.equal(signedIn.you.id, registered.you.id);
	await post(api, '/api/homework-check', { playerId: signedIn.you.id, completed: true });
	const exported = await post(api, '/api/export-local-account', { username: 'StudyKnight', password: 'strong password' });
	assert.equal(exported.format, 'ict-quattle-local-account-v1');
	assert.equal(exported.account.username, 'StudyKnight');
	assert.equal(exported.account.totalXp, 2);
	assert.equal(exported.account.xpBalance, 2);
	assert.equal('passwordHash' in exported.account, false);
	const signedInExport = await post(api, '/api/export-account', {
		playerId: signedIn.you.id,
		password: 'strong password',
	});
	assert.equal(signedInExport.account.username, 'StudyKnight');
	assert.equal(signedInExport.account.totalXp, 2);
	await assert.rejects(
		post(api, '/api/export-account', {
			playerId: signedIn.you.id,
			password: 'wrong password',
		}),
		/incorrect/i,
	);
	await assert.rejects(
		post(api, '/api/export-local-account', { username: 'StudyKnight', password: 'wrong password' }),
		/incorrect/i,
	);
});

test('local practice awards and saves XP on the player profile', async () => {
	const storage = createStorage();
	const api = createLocalGame(storage, webcrypto, grade9Practice);
	const registered = await post(api, '/api/register', { username: 'PracticeHero', password: 'strong password' });
	const { question } = await post(api, '/api/practice-question', {
		playerId: registered.you.id,
		subject: 'computers',
	});

	assert.equal(question.options.length, 4);
	const result = await post(api, '/api/practice-answer', {
		playerId: registered.you.id,
		subject: 'computers',
		questionId: question.id,
		answer: 0,
	});
	assert.equal(result.xpAwarded, result.correct ? 1 : 0);
	const signedIn = await post(api, '/api/login', { username: 'PracticeHero', password: 'strong password' });
	assert.equal(signedIn.you.totalXp, result.xpAwarded);
	assert.equal(signedIn.you.xpBalance, result.xpAwarded);
});

test('local practice avoids repeating questions across 50 prompts in one subject', async () => {
	const api = createLocalGame(createStorage(), webcrypto, grade9Practice);
	const registered = await post(api, '/api/register', { username: 'QuestionRotator', password: 'strong password' });
	const prompts = [];
	for (let index = 0; index < 50; index += 1) {
		const result = await post(api, '/api/practice-question', {
			playerId: registered.you.id,
			subject: 'computers',
		});
		prompts.push(result.question.prompt);
	}
	assert.equal(new Set(prompts).size, prompts.length);
});

test('local account edits require the current password and remain available after reload', async () => {
	const storage = createStorage();
	const api = createLocalGame(storage, webcrypto, grade9Practice);
	const registered = await post(api, '/api/register', { username: 'AccountHero', password: 'strong password' });
	await assert.rejects(
		post(api, '/api/account', {
			playerId: registered.you.id,
			currentPassword: 'wrong password',
			username: 'RenamedHero',
		}),
		/current password is incorrect/i,
	);
	await post(api, '/api/account', {
		playerId: registered.you.id,
		currentPassword: 'strong password',
		username: 'RenamedHero',
		password: 'new strong password',
	});
	await assert.rejects(
		post(api, '/api/login', { username: 'AccountHero', password: 'strong password' }),
		/no account.*in this browser/i,
	);
	const signedIn = await post(api, '/api/login', { username: 'RenamedHero', password: 'new strong password' });
	assert.equal(signedIn.you.id, registered.you.id);
	assert.equal(signedIn.you.name, 'RenamedHero');
});

test('local browser mode can start an NPC battle and advance to the NPC turn', async () => {
	const storage = createStorage();
	const api = createLocalGame(storage, webcrypto, grade9Practice);
	const registered = await post(api, '/api/register', { username: 'BotFighter', password: 'strong password' });
	const initialState = await api.handle(`/api/state?playerId=${encodeURIComponent(registered.you.id)}`);
	assert.equal(initialState.npcs.some((npc) => ['Prannoy', 'Stalin'].includes(npc.name)), false);
	const started = await post(api, '/api/battle', {
		playerId: registered.you.id,
		opponentId: 'npc-computers-1',
		subject: 'computers',
	});

	assert.equal(started.battle.status, 'active');
	assert.equal(started.battle.isYourTurn, true);
	const answered = await post(api, '/api/answer', {
		playerId: registered.you.id,
		questionId: started.battle.questionId,
		answer: -1,
	});
	assert.equal(answered.battle.turnPlayerId, 'npc-computers-1');
	assert.equal(answered.battle.isYourTurn, false);
	await new Promise((resolve) => setTimeout(resolve, 950));
	const nextTurn = await api.handle(`/api/state?playerId=${encodeURIComponent(registered.you.id)}`);
	assert.equal(nextTurn.battle.status, 'active');
	assert.equal(nextTurn.battle.isYourTurn, true);
});

test('Prannoy explains a topic and each subject uses its own level-up rival', async () => {
	const storage = createStorage();
	const api = createLocalGame(storage, webcrypto, grade9Practice);
	const registered = await post(api, '/api/register', { username: 'LevelChallenger', password: 'strong password' });
	const guide = await api.handle(`/api/study-guide?playerId=${encodeURIComponent(registered.you.id)}&subject=computers&topic=3`);
	assert.ok(guide.explanations.length > 0);
	assert.match(guide.coachIntro, /one idea at a time/i);

	const records = JSON.parse(storage.values.get('ict-quattle-local-players'));
	records[0].subjectProgress.computers = { level: 1, xp: 100, challengePending: true };
	storage.values.set('ict-quattle-local-players', JSON.stringify(records));
	await assert.rejects(
		post(api, '/api/battle', { playerId: registered.you.id, opponentId: 'npc-computers-1', subject: 'computers' }),
		/Beat Solomon/i,
	);
	const challenge = await post(api, '/api/stalin-challenge', {
		playerId: registered.you.id,
		subject: 'computers',
	});
	const stalin = challenge.battle.players.find((player) => player.id === 'npc-computers-1');
	assert.equal(challenge.battle.levelUpChallenge, true);
	assert.equal(stalin.name, 'Solomon');
	assert.equal(stalin.level, challenge.you.level);
});

test('local subject levels and bot rosters remain independent and hide rivals 10 levels below', async () => {
	const storage = createStorage();
	const api = createLocalGame(storage, webcrypto, grade9Practice);
	const registered = await post(api, '/api/register', { username: 'SubjectLevels', password: 'strong password' });
	const records = JSON.parse(storage.values.get('ict-quattle-local-players'));
	records[0].subjectProgress.chemistry = { level: 15, xp: 0, challengePending: false };
	storage.values.set('ict-quattle-local-players', JSON.stringify(records));

	const chemistry = await api.handle(`/api/state?playerId=${encodeURIComponent(registered.you.id)}&subject=chemistry`);
	const physics = await api.handle(`/api/state?playerId=${encodeURIComponent(registered.you.id)}&subject=physics`);
	assert.equal(chemistry.you.level, 15);
	assert.deepEqual(chemistry.npcs.map((npc) => npc.level).slice(0, 1), [6]);
	assert.equal(chemistry.npcs.some((npc) => npc.level <= 5), false);
	assert.equal(chemistry.npcs.at(-1).level, 25);
	assert.equal(chemistry.npcs.some((npc) => npc.name === 'Prannoy'), true);
	assert.equal(physics.you.level, 1);
	assert.equal(physics.npcs.some((npc) => npc.name === 'Stalin'), true);
	assert.notEqual(chemistry.npcs[0].id, physics.npcs[0].id);
	assert.equal(chemistry.subjects.some((subject) => subject.id === 'global-perspectives'), false);
});

test('local mode clearly rejects multiplayer that needs a server', async () => {
	const api = createLocalGame(createStorage(), webcrypto, grade9Practice);
	await assert.rejects(
		post(api, '/api/challenge', { playerId: 'no-player' }),
		/need a game server/i,
	);
});
