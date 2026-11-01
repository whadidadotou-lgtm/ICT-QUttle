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
	const signedIn = await post(api, '/api/login', { username: 'studyknight', password: 'strong password' });
	assert.equal(signedIn.you.id, registered.you.id);
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
		questionId: question.id,
		answer: 0,
	});
	assert.equal(result.xpAwarded, result.correct ? 2 : 0);
	const signedIn = await post(api, '/api/login', { username: 'PracticeHero', password: 'strong password' });
	assert.equal(signedIn.you.totalXp, result.xpAwarded);
	assert.equal(signedIn.you.xpBalance, result.xpAwarded);
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
		/incorrect/i,
	);
	const signedIn = await post(api, '/api/login', { username: 'RenamedHero', password: 'new strong password' });
	assert.equal(signedIn.you.id, registered.you.id);
	assert.equal(signedIn.you.name, 'RenamedHero');
});

test('local browser mode can start a bot battle and advance to the bot turn', async () => {
	const storage = createStorage();
	const api = createLocalGame(storage, webcrypto, grade9Practice);
	const registered = await post(api, '/api/register', { username: 'BotFighter', password: 'strong password' });
	const started = await post(api, '/api/battle', {
		playerId: registered.you.id,
		opponentId: 'npc-bit',
		subject: 'computers',
	});

	assert.equal(started.battle.status, 'active');
	assert.equal(started.battle.isYourTurn, true);
	const answered = await post(api, '/api/answer', {
		playerId: registered.you.id,
		questionId: started.battle.questionId,
		answer: -1,
	});
	assert.equal(answered.battle.turnPlayerId, 'npc-bit');
	assert.equal(answered.battle.isYourTurn, false);
	await new Promise((resolve) => setTimeout(resolve, 950));
	const nextTurn = await api.handle(`/api/state?playerId=${encodeURIComponent(registered.you.id)}`);
	assert.equal(nextTurn.battle.status, 'active');
	assert.equal(nextTurn.battle.isYourTurn, true);
});

test('local mode clearly rejects multiplayer that needs a server', async () => {
	const api = createLocalGame(createStorage(), webcrypto, grade9Practice);
	await assert.rejects(
		post(api, '/api/challenge', { playerId: 'no-player' }),
		/need a game server/i,
	);
});
