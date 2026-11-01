const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const grade9Practice = require('./grade9-practice');

const PORT = Number(process.env.PORT || 3000);
const INDEX = path.join(__dirname, 'index.html');
const STATIC_ASSETS = new Map([
	['/grade9-practice.js', path.join(__dirname, 'grade9-practice.js')],
	['/local-game.js', path.join(__dirname, 'local-game.js')],
]);
const PLAYER_DATA_FILE = process.env.PLAYER_DATA_FILE || path.join(__dirname, 'data', 'players.json');
const TURN_MS = 20_000;
const MAX_HP = 100;
const MAX_LEVEL = 100;
const MAX_NPC_LEVEL = MAX_LEVEL + 10;
const MAX_PVP_LEVEL_GAP = 10;
const BOSS_FIGHT_LEVEL_GAP = 5;
const PARRY_LEVEL = 50;
const HINT_COST = 20;
const RESIGN_COST = 50;
const NPC_WIN_XP = 80;
const NPC_LOSS_XP = 30;
const DUEL_WIN_XP = 100;
const DUEL_LOSS_XP = 45;
const DRAW_XP = 30;
const SOLO_PRACTICE_XP = 2;
const HOMEWORK_CHECK_XP = 2;
const BASE_HIT_DAMAGE = 15;
const HIT_HEAL = 3;
const FAST_ANSWER_WINDOW_MS = 2_000;
const PLAYER_PROGRESS_FIELDS = [
	'name', 'xp', 'totalXp', 'xpBalance', 'xpSpent', 'level', 'matches', 'wins', 'losses', 'draws',
];
const ACCOUNT_FIELDS = ['username', 'usernameKey', 'passwordSalt', 'passwordHash'];
const battles = new Map();
const challenges = new Map();
const studyStatuses = new Map();
const studyMessages = [];
const MAX_STUDY_MESSAGES = 50;
const soloPracticeSessions = new Map();

function combatStats(level) {
	const cappedLevel = Math.max(1, Math.min(MAX_LEVEL, level));
	return { attack: 10 + cappedLevel - 1, defence: 2 + Math.floor((cappedLevel - 1) / 2) };
}

function getAvailableNpcs(playerLevel) {
	const highestLevel = Math.min(MAX_NPC_LEVEL, playerLevel + 10);
	return npcs.filter((npc) => npc.level <= highestLevel);
}

function levelGapBetweenTeams(teams, playerMap = players) {
	let maximumGap = 0;
	for (const firstId of teams[0] || []) {
		for (const secondId of teams[1] || []) {
			const first = participantForLevel(firstId, playerMap);
			const second = participantForLevel(secondId, playerMap);
			if (first && second) maximumGap = Math.max(maximumGap, Math.abs(first.level - second.level));
		}
	}
	return maximumGap;
}

function participantForLevel(id, playerMap) {
	return id.startsWith('npc-') ? npcs.find((npc) => npc.id === id) : playerMap.get(id);
}

function parryDamageFor(defender, incomingAttack, question, answeredFast) {
	if (!defender || !incomingAttack || defender.level < PARRY_LEVEL || !answeredFast || question.difficulty === 3) return 0;
	return incomingAttack.damage;
}

function normalizeUsername(value) {
	const username = String(value || '').trim();
	if (!/^[a-zA-Z0-9_-]{3,18}$/.test(username)) {
		throw new Error('Username must be 3–18 characters using letters, numbers, _ or -');
	}
	return { username, usernameKey: username.toLowerCase() };
}

function hashPassword(password) {
	if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
		throw new Error('Password must be between 8 and 128 characters');
	}
	const passwordSalt = crypto.randomBytes(16).toString('hex');
	const passwordHash = crypto.scryptSync(password, passwordSalt, 64).toString('hex');
	return { passwordSalt, passwordHash };
}

function verifyPassword(password, player) {
	if (typeof password !== 'string' || password.length < 8 || password.length > 128
		|| !player?.passwordSalt || !player?.passwordHash) return false;
	const actual = crypto.scryptSync(password, player.passwordSalt, 64);
	const expected = Buffer.from(player.passwordHash, 'hex');
	return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function validateImportedAccount(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('The browser save file is invalid');
	}
	const account = normalizeUsername(value.username);
	const integerFields = ['totalXp', 'xpBalance', 'xpSpent', 'matches', 'wins', 'losses', 'draws'];
	if (!Number.isInteger(value.level) || value.level < 1 || value.level > MAX_LEVEL
		|| !Number.isInteger(value.xp) || value.xp < 0 || value.xp >= value.level * 100
		|| integerFields.some((field) => !Number.isSafeInteger(value[field]) || value[field] < 0)
		|| value.xpBalance > value.totalXp
		|| value.xpBalance + value.xpSpent !== value.totalXp
		|| (value.homeworkRewardDate !== undefined && value.homeworkRewardDate !== ''
			&& !/^\d{4}-\d{2}-\d{2}$/.test(value.homeworkRewardDate))) {
		throw new Error('The browser save file contains invalid player progress');
	}
	return { ...account, ...Object.fromEntries(['xp', ...integerFields, 'level', 'homeworkRewardDate']
		.map((field) => [field, value[field] ?? ''])) };
}

function mergeImportedProgress(player, imported) {
	player.totalXp = Math.max(player.totalXp, imported.totalXp);
	player.xpBalance = Math.max(player.xpBalance, imported.xpBalance);
	player.xpSpent = Math.max(0, player.totalXp - player.xpBalance);
	let earnedXp = player.totalXp;
	player.level = 1;
	while (player.level < MAX_LEVEL && earnedXp >= player.level * 100) {
		earnedXp -= player.level * 100;
		player.level += 1;
	}
	player.xp = player.level === MAX_LEVEL ? 0 : earnedXp;
	for (const field of ['matches', 'wins', 'losses', 'draws']) {
		player[field] = Math.max(player[field], imported[field]);
	}
	player.matches = Math.max(player.matches, player.wins + player.losses + player.draws);
	player.homeworkRewardDate = [player.homeworkRewardDate || '', imported.homeworkRewardDate || ''].sort().at(-1);
	Object.assign(player, combatStats(player.level));
}

function loadSavedPlayers(filePath) {
	let content;
	try {
		content = fs.readFileSync(filePath, 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT') return new Map();
		throw error;
	}

	const records = JSON.parse(content);
	if (!Array.isArray(records)) throw new Error('Player save file must contain an array');
	const loadedPlayers = new Map(records.map((record) => {
		if (!record || typeof record.id !== 'string' || typeof record.name !== 'string'
			|| !Number.isInteger(record.level) || record.level < 1 || record.level > MAX_LEVEL
			|| (record.homeworkRewardDate !== undefined && typeof record.homeworkRewardDate !== 'string')
			|| PLAYER_PROGRESS_FIELDS.some((field) => field !== 'name' && !Number.isFinite(record[field]))
			|| ACCOUNT_FIELDS.some((field) => record[field] !== undefined && typeof record[field] !== 'string')) {
			throw new Error('Player save file contains an invalid record');
		}
		const account = Object.fromEntries(ACCOUNT_FIELDS.map((field) => [field, record[field] || '']));
		const hasAccount = ACCOUNT_FIELDS.every((field) => Boolean(account[field]));
		if (ACCOUNT_FIELDS.some((field) => Boolean(account[field])) && !hasAccount) {
			throw new Error('Player save file contains incomplete account credentials');
		}
		if (hasAccount && (normalizeUsername(account.username).usernameKey !== account.usernameKey
			|| !/^[\da-f]{32}$/i.test(account.passwordSalt) || !/^[\da-f]{128}$/i.test(account.passwordHash))) {
			throw new Error('Player save file contains invalid account credentials');
		}
		return [record.id, {
			...record,
			...account,
			homeworkRewardDate: record.homeworkRewardDate || '',
			hp: MAX_HP,
			...combatStats(record.level),
			battleId: null,
			challengeId: null,
			lastSeen: 0,
		}];
	}));
	const usernames = [...loadedPlayers.values()].filter((player) => player.usernameKey).map((player) => player.usernameKey);
	if (new Set(usernames).size !== usernames.length) throw new Error('Player save file contains duplicate usernames');
	return loadedPlayers;
}

function savePlayers(filePath, playerMap) {
	const records = [...playerMap.values()].map((player) => ({
		id: player.id,
		...Object.fromEntries(PLAYER_PROGRESS_FIELDS.map((field) => [field, player[field]])),
		...Object.fromEntries(ACCOUNT_FIELDS.map((field) => [field, player[field] || ''])),
		homeworkRewardDate: player.homeworkRewardDate || '',
	}));
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const temporaryFile = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
	fs.writeFileSync(temporaryFile, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
	fs.renameSync(temporaryFile, filePath);
}

const players = loadSavedPlayers(PLAYER_DATA_FILE);

const SUBJECTS = [
	{
		id: 'scripture',
		name: 'Scripture',
		grade: 9,
		topics: [
			'Ch 1: The Beginning of the Gospel of Mark',
			'Ch 2: Christ and the Multitudes',
			'Ch 3: Christ and the Sick (through page 43, including the leper)',
			'Making choices and the consequences: Abraham, Lot, David, and Solomon',
				'Memory Verses (KJV)',
			],
		},
];
for (const subject of SUBJECTS) {
const practiceSubject = grade9Practice[subject.id];
if (practiceSubject) Object.assign(subject, {
	source: practiceSubject.source,
	questionCount: practiceSubject.questionCount,
	practiceTopics: practiceSubject.practiceTopics,
});
}
SUBJECTS.push(...Object.values(grade9Practice)
.filter((subject) => !SUBJECTS.some((existing) => existing.id === subject.id))
.map(({ questions, computerScienceQuestions, ...subject }) => ({ ...subject, battleAvailable: true })));

const questions = [
	{ chapter: '1.2', prompt: 'Which unit represents one binary digit?', options: ['Bit', 'Byte', 'Pixel', 'Hertz'], correct: 0, hint: 'It is the smallest unit of digital data.' },
	{ chapter: '1.2', prompt: 'How many bits make up one byte?', options: ['4', '8', '16', '32'], correct: 1, hint: 'A byte groups together eight binary digits.' },
	{ chapter: '1.2', prompt: 'What is the binary value of decimal 5?', options: ['100', '101', '110', '111'], correct: 1, hint: 'Think of the 4 and 1 columns in binary.' },
	{ chapter: '1.2', prompt: 'Which binary number represents decimal 10?', options: ['1001', '1010', '1100', '1110'], correct: 1, hint: 'Add the 8 and 2 place values.' },
	{ chapter: '1.2', prompt: 'What is the decimal value of binary 1101?', options: ['11', '12', '13', '14'], correct: 2, hint: 'Add the place values 8, 4, 2, and 1 where there is a 1.' },
	{ chapter: '1.2', prompt: 'How many different values can be represented by 3 bits?', options: ['6', '8', '12', '16'], correct: 1, hint: 'Each bit doubles the number of possible combinations.' },
	{ chapter: '1.3', prompt: 'Which is a common lossless image format?', options: ['PNG', 'MP3', 'JPEG', 'MP4'], correct: 0, hint: 'This image format keeps image data without lossy compression.' },
	{ chapter: '1.3', prompt: 'What does a higher image resolution usually mean?', options: ['Fewer pixels', 'More pixels per image', 'Less colour depth', 'Smaller file every time'], correct: 1, hint: 'Resolution describes how much image detail is represented.' },
	{ chapter: '1.3', prompt: 'Which file type is primarily used for compressed audio?', options: ['CSV', 'MP3', 'PNG', 'HTML'], correct: 1, hint: 'Look for the familiar three-letter audio extension.' },
	{ chapter: '1.3', prompt: 'What does colour depth describe?', options: ['The number of colours an image can represent', 'The physical thickness of a screen', 'The speed of an internet connection', 'The number of pages in a file'], correct: 0, hint: 'It relates to how many bits are used to store each pixel’s colour.' },
	{ chapter: '1.3', prompt: 'Which type of compression permanently removes some data to make a file smaller?', options: ['Lossless compression', 'Lossy compression', 'Encryption', 'Error correction'], correct: 1, hint: 'The original cannot be perfectly reconstructed after some information is discarded.' },
	{ chapter: '1.3', prompt: 'Which file extension is commonly used for a web page?', options: ['.html', '.mp3', '.bmp', '.wav'], correct: 0, hint: 'It stands for HyperText Markup Language.' },
	{ chapter: '2.1', prompt: 'What is the main job of a router?', options: ['Print documents', 'Forward data between networks', 'Store passwords', 'Scan images'], correct: 1, hint: 'It directs traffic from one network to another.' },
	{ chapter: '2.1', prompt: 'What does LAN stand for?', options: ['Local Area Network', 'Linked Access Node', 'Long Analog Network', 'Limited Account Number'], correct: 0, hint: 'The first word describes a small geographic area.' },
	{ chapter: '2.1', prompt: 'Which protocol is commonly used to load secure websites?', options: ['HTTP', 'HTTPS', 'FTP', 'SMTP'], correct: 1, hint: 'It is HTTP with an added security layer.' },
	{ chapter: '2.1', prompt: 'Which device connects several devices within a local network?', options: ['A network switch', 'A microphone', 'A plotter', 'A webcam'], correct: 0, hint: 'It forwards data to the device connected to the correct port.' },
	{ chapter: '2.1', prompt: 'Which network covers a small area such as a school building?', options: ['WAN', 'LAN', 'The internet', 'GPS'], correct: 1, hint: 'The first word in its name is “Local”.' },
	{ chapter: '2.1', prompt: 'What is the role of a modem?', options: ['Connect a network to an internet service by converting signals', 'Display images on a screen', 'Store files permanently', 'Check a program for spelling errors'], correct: 0, hint: 'Its name comes from modulator-demodulator.' },
	{ chapter: '2.3', prompt: 'Why is data split into packets for network transmission?', options: ['To make it easier to route and reassemble', 'To remove the need for addresses', 'To prevent all errors', 'To turn it into analogue data'], correct: 0, hint: 'Small units can travel independently and be put back together.' },
	{ chapter: '2.3', prompt: 'What can a checksum help a receiver detect?', options: ['A damaged or altered transmission', 'The sender’s screen size', 'The network cable colour', 'The file creator’s age'], correct: 0, hint: 'The receiver recalculates it to check data integrity.' },
	{ chapter: '2.3', prompt: 'What is encryption used for?', options: ['Making data unreadable without a key', 'Increasing screen brightness', 'Deleting duplicate files', 'Speeding up a printer'], correct: 0, hint: 'It protects confidentiality by transforming readable data.' },
	{ chapter: '2.3', prompt: 'What does a packet header commonly contain?', options: ['Addressing and control information', 'A copy of the computer’s wallpaper', 'The user’s account password', 'The full program source code'], correct: 0, hint: 'This information helps deliver the packet to its destination.' },
	{ chapter: '2.3', prompt: 'What is the purpose of an IP address?', options: ['To identify a device on a network', 'To compress a photograph', 'To measure processor temperature', 'To create a spreadsheet formula'], correct: 0, hint: 'Network data uses it to identify where a device can be reached.' },
	{ chapter: '2.3', prompt: 'What does a protocol define in a network?', options: ['Rules for communication between devices', 'The colour of network cables', 'The size of a computer monitor', 'The user’s typing speed'], correct: 0, hint: 'Devices need shared rules to exchange data correctly.' },
	{ chapter: '3', prompt: 'Which component executes program instructions?', options: ['CPU', 'Monitor', 'Keyboard', 'Speaker'], correct: 0, hint: 'It is often described as the computer’s processor.' },
	{ chapter: '3', prompt: 'Which memory loses its contents when power is switched off?', options: ['ROM', 'RAM', 'SSD', 'Blu-ray disc'], correct: 1, hint: 'This temporary working memory is volatile.' },
	{ chapter: '3', prompt: 'What is an operating system responsible for?', options: ['Managing hardware and software resources', 'Designing every webpage', 'Replacing the CPU', 'Creating an internet connection by itself'], correct: 0, hint: 'It manages resources and provides services to applications.' },
	{ chapter: '3', prompt: 'Which is an example of secondary storage?', options: ['An SSD', 'A CPU register', 'A RAM cell', 'A processor cache'], correct: 0, hint: 'It stores files long-term, even when the computer is switched off.' },
	{ chapter: '3', prompt: 'Which computer component temporarily holds data currently in use?', options: ['RAM', 'ROM', 'DVD', 'Flash drive'], correct: 0, hint: 'It is the computer’s volatile working memory.' },
	{ chapter: '3', prompt: 'Which is an input device?', options: ['A keyboard', 'A projector', 'A speaker', 'A monitor'], correct: 0, hint: 'It lets a user enter text and commands into a computer.' },
	{ chapter: '6', prompt: 'Which device converts a paper document into a digital image?', options: ['Scanner', 'Projector', 'Plotter', 'Microphone'], correct: 0, hint: 'It captures the page and sends image data to a computer.' },
	{ chapter: '6', prompt: 'Which is an example of biometric authentication?', options: ['A fingerprint scan', 'A username', 'A file name', 'A postcode'], correct: 0, hint: 'Biometrics use a measurable human characteristic.' },
	{ chapter: '6', prompt: 'Why should important files be backed up?', options: ['To recover them after loss or damage', 'To make the monitor faster', 'To remove all malware', 'To increase their resolution'], correct: 0, hint: 'A separate copy helps after accidental loss or hardware failure.' },
	{ chapter: '6', prompt: 'Which device is used to enter spoken sound into a computer?', options: ['A microphone', 'A monitor', 'A printer', 'A speaker'], correct: 0, hint: 'It converts sound waves into a signal the computer can process.' },
	{ chapter: '6', prompt: 'Which is an output device?', options: ['A monitor', 'A mouse', 'A barcode reader', 'A keyboard'], correct: 0, hint: 'It presents information from the computer to the user.' },
	{ chapter: '6', prompt: 'What is the main purpose of a firewall?', options: ['To help control network traffic', 'To cool the processor', 'To create backup copies', 'To improve screen resolution'], correct: 0, hint: 'It filters network connections according to security rules.' },
	{ chapter: '9', prompt: 'Which is the strongest password choice?', options: ['A long, unique passphrase', 'password123', 'Your first name', 'The word welcome'], correct: 0, hint: 'Length and uniqueness make guessing much harder.' },
	{ chapter: '9', prompt: 'What is phishing?', options: ['A deceptive attempt to steal information', 'A way to compress video', 'A type of printer', 'A backup schedule'], correct: 0, hint: 'It often arrives as a message pretending to be trustworthy.' },
	{ chapter: '9', prompt: 'Which action helps protect an account after a password leak?', options: ['Change the password and enable two-factor authentication', 'Reuse it everywhere', 'Post it in a private chat', 'Turn off updates'], correct: 0, hint: 'Replace the compromised secret and add another verification step.' },
	{ chapter: '9', prompt: 'Why should software updates be installed?', options: ['They can fix security weaknesses and bugs', 'They make every password public', 'They remove the need for backups', 'They stop all online scams automatically'], correct: 0, hint: 'Updates often include patches for known vulnerabilities.' },
	{ chapter: '9', prompt: 'What should you do with a suspicious email asking for your password?', options: ['Avoid its links and report or delete it', 'Reply with your password to check who sent it', 'Forward it to everyone you know', 'Disable your account security'], correct: 0, hint: 'Legitimate services should not ask you to share your password by email.' },
	{ chapter: '9', prompt: 'What does two-factor authentication add to a sign-in?', options: ['A second proof of identity', 'A second username', 'A public copy of the password', 'An automatic software update'], correct: 0, hint: 'It requires another check in addition to the password.' },
	{ chapter: '10', prompt: 'What is an algorithm?', options: ['A step-by-step method for solving a problem', 'A kind of storage cable', 'A computer screen', 'A network address'], correct: 0, hint: 'It is a finite sequence of instructions for a task.' },
	{ chapter: '10', prompt: 'In a flowchart, which shape usually represents a decision?', options: ['Diamond', 'Oval', 'Rectangle', 'Parallelogram'], correct: 0, hint: 'The branching condition uses a four-sided shape.' },
	{ chapter: '10', prompt: 'What does a loop do in a program?', options: ['Repeats a set of instructions', 'Deletes the operating system', 'Changes a monitor into a printer', 'Encrypts every file'], correct: 0, hint: 'It runs the same block again, usually until a condition changes.' },
	{ chapter: '10', prompt: 'Which flowchart shape usually represents the start or end?', options: ['An oval', 'A diamond', 'A rectangle', 'A parallelogram'], correct: 0, hint: 'It is the rounded terminal symbol.' },
	{ chapter: '10', prompt: 'What is a variable used for in a program?', options: ['Storing a value that can change', 'Connecting a computer to Wi-Fi', 'Printing a document', 'Drawing a flowchart diamond'], correct: 0, hint: 'It is a named place to hold data while a program runs.' },
	{ chapter: '10', prompt: 'What is the purpose of testing a program?', options: ['To find errors and check that it works as intended', 'To increase the screen brightness', 'To delete all user data', 'To replace the operating system'], correct: 0, hint: 'Testing checks actual behaviour against expected results.' },
	{ chapter: '1.2', difficulty: 2, prompt: 'Convert binary 101101 to decimal.', options: ['41', '43', '45', '47'], correct: 2, hint: 'Add the place values 32, 8, 4, and 1.' },
	{ chapter: '1.2', difficulty: 3, prompt: 'What is the largest unsigned value representable with 8 bits?', options: ['127', '255', '256', '512'], correct: 1, hint: 'Eight bits represent values from 0 through 2 to the power of 8 minus 1.' },
	{ chapter: '1.3', difficulty: 2, prompt: 'An image is 800 × 600 pixels at 24 bits per pixel. How many bits of uncompressed pixel data does it contain?', options: ['11,520,000', '14,400,000', '24,000,000', '34,560,000'], correct: 3, hint: 'Multiply the pixel dimensions, then multiply by 24 bits.' },
	{ chapter: '1.3', difficulty: 3, prompt: 'Why can a PNG image often be edited and saved repeatedly without accumulating lossy artefacts?', options: ['PNG uses lossless compression', 'PNG removes more colour data on every save', 'PNG stores only audio samples', 'PNG automatically enlarges each pixel'], correct: 0, hint: 'The original image information is preserved by its compression method.' },
	{ chapter: '2.1', difficulty: 2, prompt: 'A device sends data to a host on a different network. Which device normally forwards it between networks?', options: ['A switch', 'A router', 'A repeater', 'A scanner'], correct: 1, hint: 'This device examines network addressing to select a route.' },
	{ chapter: '2.1', difficulty: 3, prompt: 'What is the main distinction between a switch and a router?', options: ['A switch forwards within a LAN; a router forwards between networks', 'A switch encrypts data; a router prints it', 'A router stores files; a switch stores passwords', 'A router is an input device; a switch is an output device'], correct: 0, hint: 'Think about whether the device connects devices on one network or different networks.' },
	{ chapter: '2.3', difficulty: 2, prompt: 'A packet arrives with a checksum that does not match the receiver’s calculation. What can the receiver conclude?', options: ['The data may have been corrupted in transit', 'The sender has the fastest processor', 'The packet reached the correct person', 'The data was definitely encrypted'], correct: 0, hint: 'A checksum is used to check data integrity.' },
	{ chapter: '2.3', difficulty: 3, prompt: 'Why does packet switching help a network continue operating if one route becomes unavailable?', options: ['Packets can be routed along another available path', 'Every packet contains the entire internet', 'It removes all destination addresses', 'It prevents any packet from being delayed'], correct: 0, hint: 'Packets do not all have to follow one fixed route.' },
	{ chapter: '3', difficulty: 2, prompt: 'A computer loses unsaved work when power is removed. Which memory most likely held that temporary work?', options: ['ROM', 'RAM', 'An optical disc', 'A USB drive'], correct: 1, hint: 'This volatile memory holds programs and data currently in use.' },
	{ chapter: '3', difficulty: 3, prompt: 'Why is ROM suitable for storing start-up instructions?', options: ['It retains its contents without power and is not normally changed during use', 'It is faster because it is a display device', 'It loses its contents when the computer shuts down', 'It stores only files downloaded from the internet'], correct: 0, hint: 'Consider which type of memory is non-volatile and holds fixed instructions.' },
	{ chapter: '6', difficulty: 2, prompt: 'Which is the strongest example of multi-factor authentication?', options: ['A password and a one-time code from an authenticator app', 'Two passwords typed into the same form', 'A username and a profile picture', 'A password written in two places'], correct: 0, hint: 'The factors should be different kinds of proof.' },
	{ chapter: '6', difficulty: 3, prompt: 'Why is keeping a backup on the same drive as the original a weak recovery plan?', options: ['A drive failure could destroy both the original and its backup', 'The backup will always be too large', 'A second file cannot be opened by a computer', 'The operating system cannot see two files'], correct: 0, hint: 'A useful backup should survive the event that damages the original.' },
	{ chapter: '9', difficulty: 2, prompt: 'A message says an account will be closed unless you sign in through its link immediately. What is the safest response?', options: ['Visit the service using its known address and check the account there', 'Click quickly and enter the password', 'Reply with personal details to verify the sender', 'Forward the message with the link to friends'], correct: 0, hint: 'Urgency and unexpected sign-in links are common phishing tactics.' },
	{ chapter: '9', difficulty: 3, prompt: 'Why should a unique password be used for every important account?', options: ['A breach at one service then does not automatically expose other accounts', 'Unique passwords make phishing impossible', 'It removes the need for software updates', 'It guarantees that an account cannot be hacked'], correct: 0, hint: 'Password reuse lets attackers try leaked credentials elsewhere.' },
	{ chapter: '10', difficulty: 2, prompt: 'A program repeats a process until a condition becomes true. Which control structure is being used?', options: ['Selection', 'Iteration', 'Sequence only', 'Input'], correct: 1, hint: 'This structure repeats instructions.' },
	{ chapter: '10', difficulty: 3, prompt: 'A program produces the correct answer for normal inputs but fails on an empty list. Which testing approach would most directly expose this?', options: ['Test an edge case at the minimum input boundary', 'Repeat only the normal test', 'Change the screen resolution', 'Rename the program file'], correct: 0, hint: 'Test unusual boundary values, not only typical data.' },
	{ chapter: '1.2', prompt: 'How many bits are in two bytes?', options: ['8', '12', '16', '24'], correct: 2, hint: 'One byte contains eight bits.' },
	{ chapter: '1.3', prompt: 'Which type of data is stored in a bitmap image?', options: ['A grid of pixels', 'A list of sound samples only', 'A set of network addresses', 'A series of program instructions'], correct: 0, hint: 'Bitmap images are made from tiny coloured picture elements.' },
	{ chapter: '2.1', prompt: 'Which network type generally connects computers over a large geographic area?', options: ['PAN', 'LAN', 'WAN', 'USB'], correct: 2, hint: 'The first word in its name is “Wide”.' },
	{ chapter: '3', prompt: 'Which component is commonly called the computer’s brain?', options: ['CPU', 'Mouse', 'Monitor', 'Power cable'], correct: 0, hint: 'It processes instructions and calculations.' },
	{ chapter: '6', prompt: 'Which device displays visual output from a computer?', options: ['Keyboard', 'Monitor', 'Scanner', 'Microphone'], correct: 1, hint: 'It presents text, images, and video on a screen.' },
	{ chapter: '10', prompt: 'In a flowchart, what does a rectangle usually represent?', options: ['A decision', 'A start or end', 'A process or instruction', 'A printed page'], correct: 2, hint: 'It represents an action or processing step.' },
	{ chapter: '1.2', difficulty: 2, prompt: 'Convert decimal 45 to binary.', options: ['101101', '110101', '101011', '111001'], correct: 0, hint: 'Break 45 into the place values 32, 8, 4, and 1.' },
	{ chapter: '1.3', difficulty: 2, prompt: 'A 10-second audio clip is sampled 8,000 times per second using 8 bits per sample. How many bits are stored before compression?', options: ['80,000', '640,000', '800,000', '6,400,000'], correct: 1, hint: 'Multiply duration by samples per second, then by bits per sample.' },
	{ chapter: '2.1', difficulty: 2, prompt: 'Why does a router use a routing table?', options: ['To choose where to forward packets', 'To store copies of every website', 'To check the colour of a cable', 'To assign passwords to users'], correct: 0, hint: 'It contains information used to select a path to a destination network.' },
	{ chapter: '3', difficulty: 2, prompt: 'Which statement correctly compares RAM and ROM?', options: ['RAM is volatile; ROM retains data without power', 'RAM is output; ROM is input', 'Both lose their data when power is off', 'ROM is used only for temporary working data'], correct: 0, hint: 'One is working memory, and the other is non-volatile.' },
	{ chapter: '6', difficulty: 2, prompt: 'Why is a fingerprint scan an example of biometric authentication?', options: ['It uses a physical characteristic of a person', 'It uses a secret phrase', 'It identifies a computer cable', 'It encrypts a downloaded file'], correct: 0, hint: 'Biometrics use measurable body or behavioural traits.' },
	{ chapter: '10', difficulty: 2, prompt: 'A condition has two possible outcomes, true and false. Which flowchart symbol should test it?', options: ['Diamond', 'Oval', 'Rectangle', 'Parallelogram'], correct: 0, hint: 'This symbol branches according to a condition.' },
	{ chapter: '1.2', difficulty: 3, prompt: 'How many bytes are needed to store a 1,200 × 800 image at 24 bits per pixel, ignoring metadata and compression?', options: ['1,440,000', '2,880,000', '23,040,000', '28,800,000'], correct: 1, hint: 'Multiply the pixels by 24 bits, then divide by 8 bits per byte.' },
	{ chapter: '1.3', difficulty: 3, prompt: 'Why might a photograph saved as JPEG show artefacts around sharp edges?', options: ['Lossy compression discards some image information', 'JPEG stores every pixel as a sound sample', 'The image has too many file names', 'Lossless compression always changes edges'], correct: 0, hint: 'JPEG commonly uses a method that reduces file size by removing some detail.' },
	{ chapter: '2.1', difficulty: 3, prompt: 'A school separates staff and student devices into different logical networks on the same switch hardware. What is a common way to do this?', options: ['VLANs', 'Pixels', 'Checksums', 'Flowcharts'], correct: 0, hint: 'This technology creates separate virtual local area networks.' },
	{ chapter: '3', difficulty: 3, prompt: 'Why can adding more RAM improve performance when many applications are open?', options: ['More active data can stay in fast working memory instead of relying as much on slower storage', 'It increases the screen resolution automatically', 'It makes the CPU execute every instruction twice', 'It permanently stores all files without power'], correct: 0, hint: 'Consider what happens when working data no longer fits in memory.' },
	{ chapter: '6', difficulty: 3, prompt: 'Which backup strategy best protects against both a failed computer and a local disaster?', options: ['Keep a separate backup copy off-site', 'Save a second copy on the same internal drive', 'Rename the original file twice', 'Put a shortcut to the original on the desktop'], correct: 0, hint: 'A separate location can survive events that affect the computer’s location.' },
	{ chapter: '10', difficulty: 3, prompt: 'A test uses the smallest value allowed by an input rule and the value immediately below it. What kind of testing is this?', options: ['Boundary value testing', 'Random colour testing', 'Network routing', 'Lossless compression'], correct: 0, hint: 'It checks values at and around the limits of a valid range.' },
];

const scriptureQuestions = [
	{ chapter: 'Ch 1: The Beginning of the Gospel of Mark', prompt: 'Who prepared the way for Jesus at the beginning of Mark’s Gospel?', options: ['John the Baptist', 'Peter', 'Pontius Pilate', 'Zacchaeus'], correct: 0, hint: 'He preached in the wilderness and baptised people in the Jordan.' },
	{ chapter: 'Ch 1: The Beginning of the Gospel of Mark', prompt: 'Where was Jesus baptised by John?', options: ['The Jordan River', 'The Sea of Galilee', 'The Nile River', 'The Dead Sea'], correct: 0, hint: 'John baptised people in a river in the wilderness.' },
	{ chapter: 'Ch 1: The Beginning of the Gospel of Mark', prompt: 'What happened when Jesus was baptised?', options: ['The heavens opened and the Spirit descended like a dove', 'A great earthquake destroyed the river', 'The Roman governor crowned him king', 'The disciples immediately built a temple'], correct: 0, hint: 'Mark describes the Spirit descending and a voice from heaven.' },
	{ chapter: 'Ch 1: The Beginning of the Gospel of Mark', prompt: 'What message did Jesus proclaim in Galilee?', options: ['The kingdom of God has come near; repent and believe the good news', 'The people should return to Egypt', 'The Romans had left the region', 'Everyone should become a fisherman'], correct: 0, hint: 'Jesus called people to respond to the good news.' },
	{ chapter: 'Ch 1: The Beginning of the Gospel of Mark', prompt: 'What did Jesus see Simon and Andrew doing by the Sea of Galilee?', options: ['Casting a net into the lake', 'Collecting taxes at a booth', 'Building a synagogue', 'Travelling to Jerusalem'], correct: 0, hint: 'They were fishermen when Jesus called them.' },
	{ chapter: 'Ch 1: The Beginning of the Gospel of Mark', prompt: 'What did Jesus say he would make Simon and Andrew?', options: ['Fishers of people', 'Roman officials', 'Builders of the temple', 'Teachers in Egypt'], correct: 0, hint: 'He invited them to follow him and gave them a new purpose.' },
	{ chapter: 'Ch 2: Christ and the Multitudes', prompt: 'What did Jesus do for the crowds who came to hear him?', options: ['Taught them about God’s kingdom', 'Enlisted them in the Roman army', 'Sent them to build a palace', 'Made them tax collectors'], correct: 0, hint: 'The crowds gathered to listen to his teaching.' },
	{ chapter: 'Ch 2: Christ and the Multitudes', prompt: 'In Mark’s account, what did Jesus use to feed a large crowd of about five thousand?', options: ['Five loaves and two fish', 'Seven baskets of fruit', 'A jar of oil', 'Twelve fish and bread'], correct: 0, hint: 'A boy’s small meal was shared among the crowd.' },
	{ chapter: 'Ch 2: Christ and the Multitudes', prompt: 'What did Jesus do when he saw the large crowd like sheep without a shepherd?', options: ['He began teaching them many things', 'He sent them to join the Roman army', 'He told them to build a fishing fleet', 'He left without speaking to them'], correct: 0, hint: 'He responded to the crowd by teaching.' },
	{ chapter: 'Ch 2: Christ and the Multitudes', prompt: 'How many baskets of leftovers were collected after the crowd ate?', options: ['Twelve', 'Three', 'Seven', 'Forty'], correct: 0, hint: 'The number matched the group Jesus had chosen as apostles.' },
	{ chapter: 'Ch 2: Christ and the Multitudes', prompt: 'Why did Jesus often teach the crowds using parables?', options: ['To explain lessons through stories and comparisons', 'To teach them Roman military commands', 'To help them learn a new language', 'To tell them where to build boats'], correct: 0, hint: 'A parable uses a familiar story to communicate a deeper lesson.' },
	{ chapter: 'Ch 2: Christ and the Multitudes', prompt: 'What did Jesus do when a storm threatened the boat on the lake?', options: ['He calmed the wind and waves', 'He asked the crowd to build a bridge', 'He sent the disciples to find a Roman soldier', 'He left the boat and walked to Jerusalem'], correct: 0, hint: 'The disciples were amazed when the storm became calm.' },
	{ chapter: 'Ch 3: Christ and the Sick (through page 43, including the leper)', prompt: 'What did the man with leprosy ask Jesus to do?', options: ['Make him clean', 'Give him a fishing boat', 'Appoint him a ruler', 'Help him leave Galilee'], correct: 0, hint: 'He believed Jesus could heal him if he was willing.' },
	{ chapter: 'Ch 3: Christ and the Sick (through page 43, including the leper)', prompt: 'How did Jesus respond to the man with leprosy?', options: ['He healed him and told him to show himself to the priest', 'He sent him to join the disciples', 'He asked him to collect taxes', 'He told him to return to Rome'], correct: 0, hint: 'Jesus showed compassion, touched the man, and told him to follow the law.' },
	{ chapter: 'Ch 3: Christ and the Sick (through page 43, including the leper)', prompt: 'What did Jesus do when friends lowered a paralysed man through a roof?', options: ['Forgave his sins and told him to get up and walk', 'Asked him to collect taxes', 'Sent him to find a new house', 'Told the crowd to leave Galilee'], correct: 0, hint: 'Jesus first addressed the man’s sins, then healed him.' },
	{ chapter: 'Ch 3: Christ and the Sick (through page 43, including the leper)', prompt: 'Who did Jesus call while he was sitting at the tax booth?', options: ['Levi', 'Herod', 'Caiaphas', 'Barabbas'], correct: 0, hint: 'He was also known as Matthew in other Gospel accounts.' },
	{ chapter: 'Ch 3: Christ and the Sick (through page 43, including the leper)', prompt: 'What did Jesus tell the paralysed man after forgiving him?', options: ['Get up, take your mat, and go home', 'Return to the tax booth', 'Travel to Rome immediately', 'Wait beside the lake for seven days'], correct: 0, hint: 'The man got up, took his mat, and left in front of everyone.' },
	{ chapter: 'Ch 3: Christ and the Sick (through page 43, including the leper)', prompt: 'Why were some teachers of the law upset when Jesus forgave the paralysed man?', options: ['They thought only God could forgive sins', 'They wanted him to become a fisherman', 'They thought the man should join the army', 'They believed the roof needed repair'], correct: 0, hint: 'They questioned Jesus’ authority to forgive sins.' },
	{ chapter: 'Making choices and the consequences: Abraham, Lot, David, and Solomon', prompt: 'What did Lot choose when he and Abraham separated?', options: ['The well-watered plain near Sodom', 'The wilderness of Sinai', 'The hills of Galilee', 'The land beside the Jordan’s source'], correct: 0, hint: 'He chose the fertile-looking land near the cities of the plain.' },
	{ chapter: 'Making choices and the consequences: Abraham, Lot, David, and Solomon', prompt: 'What did Solomon ask God for when he became king?', options: ['Wisdom to govern the people', 'A longer list of soldiers', 'A palace in Egypt', 'A fleet of fishing boats'], correct: 0, hint: 'He asked for understanding so he could judge fairly.' },
	{ chapter: 'Making choices and the consequences: Abraham, Lot, David, and Solomon', prompt: 'How did David respond after Nathan confronted him about his wrongdoing?', options: ['He admitted that he had sinned', 'He blamed Solomon', 'He left Jerusalem immediately', 'He denied knowing Nathan'], correct: 0, hint: 'David acknowledged his wrongdoing rather than denying it.' },
	{ chapter: 'Making choices and the consequences: Abraham, Lot, David, and Solomon', prompt: 'What did David use to defeat Goliath?', options: ['A sling and a stone', 'A bronze chariot', 'A spear from Saul’s armour', 'A bow borrowed from Jonathan'], correct: 0, hint: 'David chose the familiar tool he used while caring for sheep.' },
	{ chapter: 'Making choices and the consequences: Abraham, Lot, David, and Solomon', prompt: 'What did Abraham do when God called him to leave his country?', options: ['He set out for the land God would show him', 'He chose to stay in Egypt', 'He asked Lot to go alone', 'He returned to Ur immediately'], correct: 0, hint: 'Abraham trusted God’s direction and left his home.' },
	{ chapter: 'Making choices and the consequences: Abraham, Lot, David, and Solomon', prompt: 'What promise did God make to Abraham about his descendants?', options: ['They would become a great nation', 'They would rule Egypt the next day', 'They would never travel again', 'They would build a city on the sea'], correct: 0, hint: 'God promised Abraham many descendants and a special land.' },
	{ chapter: 'Making choices and the consequences: Abraham, Lot, David, and Solomon', prompt: 'What choice did David make when he had the opportunity to harm Saul?', options: ['He spared Saul’s life', 'He took Saul’s crown and fled', 'He asked Goliath to decide', 'He surrendered to the Philistines'], correct: 0, hint: 'David refused to harm the king, even though Saul was pursuing him.' },
	{ chapter: 'Memory Verses (KJV)', prompt: 'Complete Romans 3:23: “For all have sinned, and come short of the ___ of God.”', options: ['glory', 'wisdom', 'kingdom', 'image'], correct: 0, hint: 'The verse says people fall short of God’s glory.' },
	{ chapter: 'Memory Verses (KJV)', prompt: 'Complete Romans 6:23: “For the wages of sin is death; but the gift of God is ___ through Jesus Christ our Lord.”', options: ['peace', 'eternal life', 'forgiveness', 'wisdom'], correct: 1, hint: 'The verse contrasts death with God’s gift of eternal life.' },
	{ chapter: 'Memory Verses (KJV)', prompt: 'Complete 1 John 3:4: “...for sin is the ___ of the law.”', options: ['transgression', 'fulfilment', 'teaching', 'beginning'], correct: 0, hint: 'The KJV describes sin as breaking or transgressing the law.' },
	{ chapter: 'Memory Verses (KJV)', prompt: 'Complete Mark 1:38: “...that I may preach there also: for therefore ___.”', options: ['I am your king', 'I came to heal', 'came I forth', 'the kingdom is near'], correct: 2, hint: 'Jesus explains why he came to preach in other towns.' },
	{ chapter: 'Memory Verses (KJV)', prompt: 'Complete Mark 2:17: “I came not to call the righteous, but sinners to ___.”', options: ['repentance', 'Galilee', 'judgment', 'service'], correct: 0, hint: 'Jesus compares his mission to a physician caring for the sick.' },
	{ chapter: 'Memory Verses (KJV)', prompt: 'Complete Mark 10:45: “...and to give his life a ___ for many.”', options: ['lesson', 'prayer', 'ransom', 'sign'], correct: 2, hint: 'The verse says the Son of man came to serve and give his life.' },
	{ chapter: 'Ch 1: The Beginning of the Gospel of Mark', difficulty: 2, prompt: 'In Mark 1, what did Jesus say was the reason he had come to preach in nearby towns?', options: ['“For therefore came I forth.”', '“I must become king in Jerusalem.”', '“The crowds have chosen me.”', '“I came to collect taxes.”'], correct: 0, hint: 'Recall Jesus’ reply when the disciples found him praying.' },
	{ chapter: 'Ch 1: The Beginning of the Gospel of Mark', difficulty: 2, prompt: 'What did the unclean spirit call Jesus in the synagogue at Capernaum?', options: ['The Holy One of God', 'The son of the high priest', 'The king of Rome', 'The prophet of Egypt'], correct: 0, hint: 'The spirit recognised Jesus’ identity.' },
	{ chapter: 'Ch 1: The Beginning of the Gospel of Mark', difficulty: 3, prompt: 'In Mark 1, what sequence follows Jesus’ baptism?', options: ['The Spirit drives him into the wilderness, where he is tempted', 'He immediately enters Jerusalem and meets Pilate', 'He appoints Levi and visits the temple', 'He feeds five thousand people by the sea'], correct: 0, hint: 'Mark describes the wilderness before Jesus begins preaching in Galilee.' },
	{ chapter: 'Ch 1: The Beginning of the Gospel of Mark', difficulty: 3, prompt: 'After healing Simon’s mother-in-law, what did Jesus do early the next morning?', options: ['Went to a solitary place to pray', 'Returned to Nazareth to become a carpenter', 'Met Herod in Jerusalem', 'Sent the disciples to collect taxes'], correct: 0, hint: 'Simon and the others searched for Jesus and found him alone.' },
	{ chapter: 'Ch 2: Christ and the Multitudes', difficulty: 2, prompt: 'Why did Jesus say the Sabbath was made for humankind?', options: ['To explain that the Sabbath serves people, rather than people serving it', 'To announce that the Sabbath belonged only to the disciples', 'To say that people should never rest', 'To make the Sabbath a Roman festival'], correct: 0, hint: 'Jesus was responding to criticism about what his disciples did on the Sabbath.' },
	{ chapter: 'Ch 2: Christ and the Multitudes', difficulty: 2, prompt: 'In Mark’s account of feeding the five thousand, what did Jesus tell the disciples to do before distributing the food?', options: ['Have the people sit down in groups on the green grass', 'Send everyone to Jerusalem', 'Ask each person to bring a coin', 'Build a shelter from the boats'], correct: 0, hint: 'Mark describes the crowd sitting in organized groups.' },
	{ chapter: 'Ch 2: Christ and the Multitudes', difficulty: 3, prompt: 'After feeding the five thousand, what did Jesus do while the disciples crossed the lake?', options: ['Went up a mountain to pray', 'Returned to the crowd to collect money', 'Travelled to Rome', 'Stayed in the boat with the disciples'], correct: 0, hint: 'Mark says Jesus dismissed the crowd before going up the mountain.' },
	{ chapter: 'Ch 2: Christ and the Multitudes', difficulty: 3, prompt: 'What misunderstanding did the disciples show after the feeding miracles, according to Mark 8?', options: ['They focused on having no bread and did not understand the significance of the loaves', 'They believed the loaves had been made of stone', 'They thought Jesus had sent them to Egypt', 'They refused to get into the boat'], correct: 0, hint: 'Jesus asked them about their hardened hearts and reminded them of the baskets collected.' },
	{ chapter: 'Ch 3: Christ and the Sick (through page 43, including the leper)', difficulty: 2, prompt: 'In Mark 2:17, whom did Jesus compare to people who need a physician?', options: ['Sinners', 'Roman soldiers', 'Fishermen', 'The healthy'], correct: 0, hint: 'Jesus said he came to call these people to repentance.' },
	{ chapter: 'Ch 3: Christ and the Sick (through page 43, including the leper)', difficulty: 2, prompt: 'What did Jesus tell the healed man with leprosy to do as a testimony?', options: ['Show himself to the priest and offer what Moses commanded', 'Return to the wilderness and tell no one', 'Become a tax collector', 'Take the place of a disciple'], correct: 0, hint: 'Jesus instructed him to follow the purification practice in the law of Moses.' },
	{ chapter: 'Ch 3: Christ and the Sick (through page 43, including the leper)', difficulty: 3, prompt: 'When Jesus forgave the paralysed man, what question did the scribes raise in their hearts?', options: ['“Who can forgive sins but God only?”', '“Why has he crossed the sea?”', '“Where are the five loaves?”', '“Who will rule in Rome?”'], correct: 0, hint: 'They considered Jesus’ words blasphemous because of who they believed could forgive sins.' },
	{ chapter: 'Ch 3: Christ and the Sick (through page 43, including the leper)', difficulty: 3, prompt: 'Why did Jesus heal the paralysed man after saying his sins were forgiven?', options: ['To show that the Son of man had authority on earth to forgive sins', 'To prove that the man could become a Roman official', 'To show that the scribes could heal the sick', 'To demonstrate how to build a house'], correct: 0, hint: 'Jesus explicitly connected the visible healing with his authority.' },
	{ chapter: 'Making choices and the consequences: Abraham, Lot, David, and Solomon', difficulty: 2, prompt: 'Why did Abraham and Lot separate their households?', options: ['Their possessions were so great that the land could not support them together', 'Lot wanted to become a king in Egypt', 'Abraham was ordered to leave by Pharaoh', 'They disagreed about which city had a temple'], correct: 0, hint: 'Their herdsmen were quarrelling because the land could not support all their livestock.' },
	{ chapter: 'Making choices and the consequences: Abraham, Lot, David, and Solomon', difficulty: 2, prompt: 'What did Nathan’s story about a poor man’s lamb help David recognize?', options: ['His own wrongdoing in taking Uriah’s wife', 'That Goliath had returned', 'That Solomon had lost the throne', 'That Abraham had left Canaan'], correct: 0, hint: 'Nathan used the story to confront David about Bathsheba and Uriah.' },
	{ chapter: 'Making choices and the consequences: Abraham, Lot, David, and Solomon', difficulty: 3, prompt: 'What reason did David give for refusing to kill Saul when he had the chance?', options: ['He would not harm the Lord’s anointed', 'He had lost his sword', 'Saul had already surrendered the throne', 'Jonathan had forbidden him to travel'], correct: 0, hint: 'David treated Saul’s anointing as a reason not to strike him.' },
	{ chapter: 'Making choices and the consequences: Abraham, Lot, David, and Solomon', difficulty: 3, prompt: 'In Solomon’s judgment between the two women, what revealed the true mother?', options: ['She was willing to give up the child rather than see him harmed', 'She remembered the child’s birth date', 'She brought a witness from Egypt', 'She asked the king to divide the child'], correct: 0, hint: 'Her compassion showed that she would rather the child live, even if she lost him.' },
	{ chapter: 'Memory Verses (KJV)', difficulty: 2, prompt: 'Which reference teaches that sin is the transgression of the law?', options: ['Romans 3:23', '1 John 3:4', 'Mark 1:38', 'Mark 10:45'], correct: 1, hint: 'It is the verse in 1 John.' },
	{ chapter: 'Memory Verses (KJV)', difficulty: 2, prompt: 'Which two outcomes are contrasted in Romans 6:23?', options: ['The wages of sin and the gift of God', 'The law of Moses and the law of Rome', 'The sea and the wilderness', 'The loaves and the fishes'], correct: 0, hint: 'The verse contrasts what sin earns with what God gives.' },
	{ chapter: 'Memory Verses (KJV)', difficulty: 3, prompt: 'According to Romans 6:23, through whom is the gift of eternal life?', options: ['Jesus Christ our Lord', 'John the Baptist', 'Moses the lawgiver', 'King Solomon'], correct: 0, hint: 'The verse names Jesus Christ our Lord.' },
	{ chapter: 'Memory Verses (KJV)', difficulty: 3, prompt: 'Which pair of ideas is joined in Mark 10:45?', options: ['Serving others and giving his life as a ransom for many', 'Ruling Rome and collecting taxes', 'Building a temple and gathering an army', 'Fasting in the wilderness and calming the sea'], correct: 0, hint: 'The verse explains why the Son of man came.' },
	{ chapter: 'Ch 1: The Beginning of the Gospel of Mark', prompt: 'What was John the Baptist’s clothing made from?', options: ['Camel’s hair with a leather girdle', 'Fine linen from Egypt', 'Wool from the temple', 'Purple cloth from Rome'], correct: 0, hint: 'Mark describes his clothing and what he ate in the wilderness.' },
	{ chapter: 'Ch 1: The Beginning of the Gospel of Mark', prompt: 'What food did John the Baptist eat in the wilderness?', options: ['Locusts and wild honey', 'Fish and barley loaves', 'Dates and figs', 'Bread and olives'], correct: 0, hint: 'Mark names two simple foods found in the wilderness.' },
	{ chapter: 'Ch 2: Christ and the Multitudes', prompt: 'How many loaves were used to feed the five thousand?', options: ['Two', 'Five', 'Seven', 'Twelve'], correct: 1, hint: 'The meal also included two fish.' },
	{ chapter: 'Ch 2: Christ and the Multitudes', prompt: 'What did Jesus do before breaking the loaves to feed the crowd?', options: ['Looked up to heaven and blessed them', 'Asked the crowd to leave', 'Took a collection of coins', 'Sent the disciples to Jerusalem'], correct: 0, hint: 'Mark describes Jesus looking toward heaven before breaking the food.' },
	{ chapter: 'Ch 3: Christ and the Sick (through page 43, including the leper)', prompt: 'What did Jesus do when the man with leprosy approached him?', options: ['He was moved with compassion and touched him', 'He sent him to collect taxes', 'He asked him to command the crowd', 'He left the town without speaking'], correct: 0, hint: 'Jesus showed compassion despite the man’s illness.' },
	{ chapter: 'Making choices and the consequences: Abraham, Lot, David, and Solomon', prompt: 'Who did David defeat with a sling and a stone?', options: ['Goliath', 'Saul', 'Nathan', 'Abraham'], correct: 0, hint: 'He was a Philistine champion.' },
	{ chapter: 'Memory Verses (KJV)', prompt: 'Which verse says, “For all have sinned, and come short of the glory of God”?', options: ['Romans 3:23', 'Romans 6:23', 'Mark 2:17', '1 John 3:4'], correct: 0, hint: 'It is the earlier of the two Romans references in the memory list.' },
	{ chapter: 'Ch 1: The Beginning of the Gospel of Mark', difficulty: 2, prompt: 'In Mark 1, what did Jesus say to the leper after healing him?', options: ['Tell no one, but show yourself to the priest and offer what Moses commanded', 'Return to Capernaum and become a tax collector', 'Gather the crowds and choose a king', 'Travel to Rome and report to Caesar'], correct: 0, hint: 'Jesus directed him to follow the required testimony to the priest.' },
	{ chapter: 'Ch 2: Christ and the Multitudes', difficulty: 2, prompt: 'When Jesus saw the crowd in Mark 6, what comparison described their need?', options: ['Sheep without a shepherd', 'Soldiers without armour', 'Fishermen without nets', 'Builders without stones'], correct: 0, hint: 'The comparison explains why Jesus began teaching them.' },
	{ chapter: 'Ch 3: Christ and the Sick (through page 43, including the leper)', difficulty: 2, prompt: 'What did the people do when the paralysed man walked out carrying his bed?', options: ['They were amazed and glorified God', 'They asked him to return to the roof', 'They demanded that he become a ruler', 'They sent him to the sea'], correct: 0, hint: 'The crowd recognized that they had witnessed something extraordinary.' },
	{ chapter: 'Making choices and the consequences: Abraham, Lot, David, and Solomon', difficulty: 2, prompt: 'What did Lot see when he looked toward the plain of Jordan?', options: ['It was well watered', 'It was covered in snow', 'It was surrounded by the sea', 'It had no people or settlements'], correct: 0, hint: 'The land looked fertile before Lot chose it.' },
	{ chapter: 'Memory Verses (KJV)', difficulty: 2, prompt: 'Which reference says that Jesus came to call sinners to repentance?', options: ['Mark 2:17', 'Romans 3:23', 'Mark 10:45', '1 John 3:4'], correct: 0, hint: 'It is Jesus’ answer about people who need a physician.' },
	{ chapter: 'Ch 1: The Beginning of the Gospel of Mark', difficulty: 3, prompt: 'What does Mark’s opening description of the gospel connect Jesus with?', options: ['The promised beginning of good news and the prophets’ message', 'The Roman census and Caesar’s family', 'The rebuilding of Solomon’s palace', 'The feeding of the five thousand'], correct: 0, hint: 'Mark begins by referring to the prophets and a messenger preparing the way.' },
	{ chapter: 'Ch 2: Christ and the Multitudes', difficulty: 3, prompt: 'After the feeding of the five thousand, how many baskets of fragments were gathered?', options: ['Seven', 'Ten', 'Twelve', 'Forty'], correct: 2, hint: 'Mark records one basket for each of the twelve.' },
	{ chapter: 'Ch 3: Christ and the Sick (through page 43, including the leper)', difficulty: 3, prompt: 'In Mark 2, what was Jesus’ argument when he asked whether it was easier to say “thy sins be forgiven thee” or “arise, and take up thy bed, and walk”?', options: ['The visible healing would show his authority to forgive sins', 'The man needed to choose which house to visit', 'The scribes could decide who was healed', 'The Sabbath had ended before the man arrived'], correct: 0, hint: 'Jesus used the observable healing to demonstrate his authority.' },
	{ chapter: 'Making choices and the consequences: Abraham, Lot, David, and Solomon', difficulty: 3, prompt: 'What did Nathan tell David after David condemned the rich man in Nathan’s story?', options: ['“Thou art the man.”', '“Go and count the stars.”', '“Choose the well-watered plain.”', '“Build me a temple.”'], correct: 0, hint: 'Nathan directly applied the story to David.' },
	{ chapter: 'Memory Verses (KJV)', difficulty: 3, prompt: 'Which reference contains the phrase “came I forth” in the KJV?', options: ['Mark 1:38', 'Mark 10:45', 'Romans 6:23', 'Romans 3:23'], correct: 0, hint: 'Jesus uses this phrase when explaining why he came to preach elsewhere.' },
];

const questionPools = {
	computers: questions,
	scripture: scriptureQuestions,
};

const practiceOnlyBattleSubjects = new Set(['english', 'mathematics', 'business']);

for (const subject of SUBJECTS) {
	subject.battleAvailable = !practiceOnlyBattleSubjects.has(subject.id);
	if (!subject.battleAvailable) continue;
	if (!questionPools[subject.id]) {
		const difficultyByVariant = [1, 2, 3, 3];
		questionPools[subject.id] = grade9Practice[subject.id].questions.map((question, index) => ({
			chapter: question.chapter,
			difficulty: difficultyByVariant[index % difficultyByVariant.length],
			prompt: question.prompt,
			options: question.options,
			correct: question.correct,
			hint: question.hint,
		}));
	} else if (subject.id === 'computers') {
		const difficultyByVariant = [1, 2, 3, 3];
		questionPools.computers.push(...grade9Practice.computers.computerScienceQuestions.map((question, index) => ({
			chapter: question.chapter,
			difficulty: difficultyByVariant[index % difficultyByVariant.length],
			prompt: question.prompt,
			options: question.options,
			correct: question.correct,
			hint: question.hint,
		})));
	}
	subject.battleTopics = [...new Set(questionPools[subject.id].map((question) => question.chapter))];
}

const nextCorrectPosition = Object.fromEntries(SUBJECTS.map((subject) => [subject.id, 1]));

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
const npcs = Array.from({ length: MAX_NPC_LEVEL - 1 }, (_, index) => {
	const level = index + 2;
	const [id, name] = legacyNpcNames[level] || [
		`npc-level-${level}`,
		`${npcFirstNames[(level - 2) % npcFirstNames.length]} ${npcLastNames[Math.floor((level - 2) / npcFirstNames.length) % npcLastNames.length]}`,
	];
	return { id, name, level, ...combatStats(level), hp: MAX_HP };
});

function json(response, status, value) {
	response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
	response.end(JSON.stringify(value));
}

function readBody(request) {
	return new Promise((resolve, reject) => {
		let body = '';
		request.on('data', (chunk) => {
			body += chunk;
			if (body.length > 16_384) reject(new Error('Request body too large'));
		});
		request.on('end', () => {
			try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON')); }
		});
		request.on('error', reject);
	});
}

function getQuestion(subject, topic = null) {
	const questionPool = questionPools[subject];
	if (!questionPool) return null;
	const topicQuestions = questionPool.filter((question) => !topic || question.chapter === topic);
	if (!topicQuestions.length) return null;
	const question = topicQuestions[Math.floor(Math.random() * topicQuestions.length)];
	const correctPosition = nextCorrectPosition[subject];
	nextCorrectPosition[subject] = (correctPosition + 1) % question.options.length;
	const options = [...question.options];
	const [correctAnswer] = options.splice(question.correct, 1);
	options.splice(correctPosition, 0, correctAnswer);
	return { ...question, options, correct: correctPosition };
}

function getSoloPracticeQuestion(playerId, subjectId, topic = null) {
	const subject = grade9Practice[subjectId];
	if (!subject || (topic && !subject.practiceTopics.includes(topic))) return null;
	const availableQuestions = topic ? subject.questions.filter((question) => question.chapter === topic) : subject.questions;
	if (!availableQuestions.length) return null;
	const source = availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
	const correctPosition = Math.floor(Math.random() * source.options.length);
	const options = [...source.options];
	const [correctAnswer] = options.splice(source.correct, 1);
	options.splice(correctPosition, 0, correctAnswer);
	const question = {
		id: crypto.randomUUID(),
		chapter: source.chapter,
		prompt: source.prompt,
		options,
		correct: correctPosition,
		hint: source.hint,
	};
	const previous = soloPracticeSessions.get(playerId);
	soloPracticeSessions.set(playerId, {
		subject: subjectId,
		topic,
		question,
		answered: false,
		score: previous?.subject === subjectId ? previous.score : 0,
		attempts: previous?.subject === subjectId ? previous.attempts : 0,
	});
	const { correct, hint, ...publicQuestion } = question;
	return { question: publicQuestion, score: soloPracticeSessions.get(playerId).score, attempts: soloPracticeSessions.get(playerId).attempts };
}

function answerSoloPracticeQuestion(playerId, questionId, answer) {
	const session = soloPracticeSessions.get(playerId);
	if (!session || session.question.id !== questionId || session.answered) return null;
	const correct = Number(answer) === session.question.correct;
	session.answered = true;
	session.attempts += 1;
	if (correct) session.score += 1;
	return {
		correct,
		correctAnswer: session.question.options[session.question.correct],
		correctIndex: session.question.correct,
		selectedIndex: Number(answer),
		explanation: session.question.hint,
		score: session.score,
		attempts: session.attempts,
	};
}

function participant(battle, id) {
	return id.startsWith('npc-') ? battle.npc : players.get(id);
}

function aliveIds(battle, teamIndex) {
	return battle.teams[teamIndex].filter((id) => (participant(battle, id)?.hp || 0) > 0);
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

	Object.assign(player, combatStats(player.level));
	if (player.level === MAX_LEVEL) player.xp = 0;
}

function awardHomeworkXp(player, date = new Date().toISOString().slice(0, 10)) {
	if (player.homeworkRewardDate === date) return 0;
	addExperience(player, HOMEWORK_CHECK_XP);
	player.homeworkRewardDate = date;
	return HOMEWORK_CHECK_XP;
}

function damageFor(attacker, defender, multiplier = 1) {
	return Math.round(Math.max(4, BASE_HIT_DAMAGE + (attacker.attack - 10) - (defender.defence - 2)) * multiplier);
}

function questionDamageMultiplier(question, fastAnswer = false) {
	return (fastAnswer ? 2 : 1) * (question.difficulty === 3 ? 1.5 : 1);
}

function recordAnswerFeedback(battle, playerId, answer) {
	const question = battle.question;
	battle.answerFeedback.set(playerId, {
		questionId: battle.questionId,
		correct: answer === question.correct,
		selectedIndex: Number.isInteger(answer) && answer >= 0 && answer < question.options.length ? answer : null,
		selectedAnswer: Number.isInteger(answer) && answer >= 0 && answer < question.options.length ? question.options[answer] : null,
		correctIndex: question.correct,
		correctAnswer: question.options[question.correct],
	});
}

function isFastAnswer(questionStartedAt, answeredAt) {
	const elapsed = answeredAt - questionStartedAt;
	return elapsed >= 0 && elapsed <= FAST_ANSWER_WINDOW_MS;
}

function npcWinXp(npcLevel) {
	return NPC_WIN_XP + Math.max(0, npcLevel - 1) * 10;
}

function buildTurnOrder(teams, randomizeStartingTeam = false) {
	const firstTeam = randomizeStartingTeam && Math.random() < 0.5 ? 1 : 0;
	return Array.from({ length: Math.max(...teams.map((team) => team.length)) }, (_, index) => [
		teams[firstTeam][index],
		teams[1 - firstTeam][index],
	].filter(Boolean)).flat();
}

function isStudyRelatedMessage(message) {
	const unrelatedTerms = /\b(games?|gaming|politics?|political|dating|relationships?|movies?|films?|celebrities|gossip|parties|weekend plans|sports scores?)\b/i;
	return !unrelatedTerms.test(message);
}

function censorProfanity(message) {
	const profanity = /(?<![a-z0-9])(?:f[\W_]*u[\W_]*c[\W_]*k(?:[\W_]*(?:i[\W_]*n[\W_]*g|e[\W_]*d|e[\W_]*r[\W_]*s?|s))?|s[\W_]*h[\W_]*i[\W_]*t(?:[\W_]*t[\W_]*y|[\W_]*s)?|b[\W_]*i[\W_]*t[\W_]*c[\W_]*h(?:[\W_]*e[\W_]*s)?|d[\W_]*a[\W_]*m[\W_]*n|h[\W_]*e[\W_]*l[\W_]*l|c[\W_]*r[\W_]*a[\W_]*p|a[\W_]*s[\W_]*s[\W_]*h[\W_]*o[\W_]*l[\W_]*e|b[\W_]*a[\W_]*s[\W_]*t[\W_]*a[\W_]*r[\W_]*d|d[\W_]*i[\W_]*c[\W_]*k|p[\W_]*i[\W_]*s[\W_]*s(?:[\W_]*e[\W_]*d|[\W_]*i[\W_]*n[\W_]*g)?)(?![a-z0-9])/gi;
	return message.replace(profanity, (word) => '*'.repeat(Math.max(3, word.replace(/[^a-z]/gi, '').length)));
}

function getStudyRoomState(playerId) {
	const player = players.get(playerId);
	if (!player) return null;
	player.lastSeen = Date.now();
	const now = Date.now();
	for (const id of studyStatuses.keys()) {
		if (now - (players.get(id)?.lastSeen || 0) >= 45_000) studyStatuses.delete(id);
	}
	const studying = [...studyStatuses.entries()]
		.filter(([id, status]) => id !== playerId && status.studying && now - (players.get(id)?.lastSeen || 0) < 45_000)
		.map(([id, status]) => ({ id, name: players.get(id)?.name || 'Player', subject: status.subject }));
	return { studying, messages: studyMessages.slice(-MAX_STUDY_MESSAGES) };
}

function finishBattle(battle, winnerTeamIndex, resignedPlayerId = null) {
	if (battle.status === 'finished') return;
	battle.status = 'finished';
	battle.winnerTeamIndex = winnerTeamIndex;
	battle.winnerId = winnerTeamIndex === null ? null : battle.teams[winnerTeamIndex].length === 1 ? battle.teams[winnerTeamIndex][0] : null;
	battle.rewards = {};
	clearTimeout(battle.npcTimer);

	for (const id of battle.playerIds) {
		if (id.startsWith('npc-')) continue;
		const player = players.get(id);
		const teamIndex = battle.teams.findIndex((team) => team.includes(id));
		const isDraw = winnerTeamIndex === null;
		const didWin = !isDraw && winnerTeamIndex === teamIndex;
		if (id === resignedPlayerId) {
			player.xpBalance -= RESIGN_COST;
			player.xpSpent += RESIGN_COST;
			player.matches += 1;
			player.losses += 1;
			battle.rewards[id] = -RESIGN_COST;
			continue;
		}
		const xp = isDraw ? DRAW_XP : battle.mode === 'npc'
			? didWin ? npcWinXp(battle.npc?.level || 1) : NPC_LOSS_XP
			: didWin ? DUEL_WIN_XP : DUEL_LOSS_XP;
		addExperience(player, xp);
		player.matches += 1;
		if (isDraw) player.draws += 1;
		else if (didWin) player.wins += 1;
		else player.losses += 1;
		battle.rewards[id] = xp;
	}
	const winner = winnerTeamIndex === null ? null : battle.teams[winnerTeamIndex].map((id) => participant(battle, id)?.name || 'Player').join(' + ');
	battle.log.unshift({ text: winner ? `${winner} wins the match and earns XP.` : 'The match ends in a draw. XP awarded.', kind: 'info' });
	battle.log = battle.log.slice(0, 8);
	savePlayers(PLAYER_DATA_FILE, players);
}

function finishIfTeamIsDown(battle) {
	const firstAlive = aliveIds(battle, 0).length > 0;
	const secondAlive = aliveIds(battle, 1).length > 0;
	if (firstAlive && secondAlive) return false;
	finishBattle(battle, firstAlive === secondAlive ? null : firstAlive ? 0 : 1);
	return true;
}

function nextActor(battle, currentId) {
	const currentIndex = battle.turnOrder.indexOf(currentId);
	for (let offset = 1; offset <= battle.turnOrder.length; offset += 1) {
		const id = battle.turnOrder[(currentIndex + offset + battle.turnOrder.length) % battle.turnOrder.length];
		if ((participant(battle, id)?.hp || 0) > 0) return id;
	}
	return battle.turnOrder[0];
}

function chooseTarget(battle, teamIndex) {
	return aliveIds(battle, teamIndex)
		.map((id) => participant(battle, id))
		.sort((first, second) => first.hp - second.hp)[0];
}

function startTurn(battle, playerId) {
	battle.round += 1;
	battle.turnPlayerId = battle.mode === 'simultaneous' ? null : playerId;
	battle.questionId = crypto.randomUUID();
	battle.questionStartedAt = Date.now();
	battle.question = getQuestion(battle.subject, battle.topic);
	battle.deadline = battle.questionStartedAt + TURN_MS;
	battle.answers = new Set();
	battle.hints = new Map();
	if (battle.question.difficulty === 3 && battle.parryOpportunities.size) {
		const defenders = playerId ? [playerId] : [...battle.parryOpportunities.keys()];
		for (const defenderId of defenders) {
			const opportunity = battle.parryOpportunities.get(defenderId);
			if (!opportunity) continue;
			battle.parryOpportunities.delete(defenderId);
			battle.log.unshift({
				text: `${participant(battle, defenderId)?.name || 'The defender'}'s parry barrier shattered on a hard question.`,
				kind: 'parry-break',
				playerId: defenderId,
				targetId: opportunity.attackerId,
			});
		}
		battle.log = battle.log.slice(0, 8);
	}
	if (playerId?.startsWith('npc-')) {
		battle.npcTimer = setTimeout(() => {
			if (battle.status === 'active' && battle.turnPlayerId === playerId) {
				resolveTurn(battle, playerId, Math.random() < 0.68 ? battle.question.correct : -1, false);
			}
		}, 1_700);
	}
}

function resolveCorrectAnswer(battle, playerId, attacker, defender, fastAnswer) {
	const question = battle.question;
	const hardQuestion = question.difficulty === 3;
	const isNpc = playerId.startsWith('npc-');
	const damage = damageFor(attacker, defender, questionDamageMultiplier(question, fastAnswer && !isNpc));
	defender.hp = Math.max(0, defender.hp - damage);
	attacker.hp = Math.min(MAX_HP, attacker.hp + HIT_HEAL);

	const opportunity = battle.parryOpportunities.get(playerId);
	battle.parryOpportunities.delete(playerId);
	const reflectedDamage = parryDamageFor(attacker, opportunity, question, fastAnswer);
	const reflectedAttacker = reflectedDamage ? participant(battle, opportunity.attackerId) : null;
	if (reflectedAttacker) reflectedAttacker.hp = Math.max(0, reflectedAttacker.hp - reflectedDamage);
	if (defender.hp > 0) {
		battle.parryOpportunities.set(defender.id, { attackerId: playerId, damage, hardQuestion });
	}

	const parryMessage = reflectedAttacker
		? ` Parry reflected ${reflectedDamage} damage back at ${reflectedAttacker.name}!`
		: '';
	const kind = reflectedAttacker ? 'parry' : 'hit';
	const subject = battle.mode === 'simultaneous' ? 'answered first' : 'landed a correct answer';
	battle.log.unshift({
		text: `${attacker.name} ${subject}: ${damage} damage${hardQuestion ? ' (hard question +50%)' : ''}${fastAnswer && !isNpc ? ' (2× fast answer)' : ''}, +${HIT_HEAL} HP.${parryMessage}`,
		kind,
		playerId,
		targetId: reflectedAttacker?.id || defender.id,
		reflectedDamage,
	});
}

function resolveSimultaneousTurn(battle, playerId, answer, timedOut) {
	if (timedOut) {
		for (const id of battle.playerIds) {
			if (battle.answers.has(id) || (participant(battle, id)?.hp || 0) <= 0) continue;
			battle.parryOpportunities.delete(id);
			participant(battle, id).hp = Math.max(0, participant(battle, id).hp - 14);
			battle.log.unshift({ text: `${participant(battle, id).name} ran out of time and lost 14 HP.`, kind: 'miss', playerId: id });
		}
		if (!finishIfTeamIsDown(battle)) startTurn(battle, null);
		return;
	}

	if (battle.answers.has(playerId)) return;
	battle.answers.add(playerId);
	recordAnswerFeedback(battle, playerId, answer);
	const attacker = participant(battle, playerId);
	if (answer === battle.question.correct) {
		const defender = chooseTarget(battle, 1 - battle.teams.findIndex((team) => team.includes(playerId)));
		const fastAnswer = isFastAnswer(battle.questionStartedAt, Date.now());
		resolveCorrectAnswer(battle, playerId, attacker, defender, fastAnswer);
		battle.log = battle.log.slice(0, 8);
		if (!finishIfTeamIsDown(battle)) startTurn(battle, null);
		return;
	}

	battle.parryOpportunities.delete(playerId);
	attacker.hp = Math.max(0, attacker.hp - 14);
	battle.log.unshift({ text: `${attacker.name} missed the answer and lost 14 HP.`, kind: 'miss', playerId });
	battle.log = battle.log.slice(0, 8);
	if (finishIfTeamIsDown(battle)) return;
	const livingPlayers = battle.playerIds.filter((id) => (participant(battle, id)?.hp || 0) > 0);
	if (livingPlayers.every((id) => battle.answers.has(id))) startTurn(battle, null);
}

function resolveTurn(battle, playerId, answer, timedOut) {
	if (battle.mode === 'simultaneous') {
		if (battle.status === 'active') resolveSimultaneousTurn(battle, playerId, answer, timedOut);
		return;
	}
	if (battle.status !== 'active' || battle.turnPlayerId !== playerId) return;
	clearTimeout(battle.npcTimer);
	const attacker = participant(battle, playerId);
	const teamIndex = battle.teams.findIndex((team) => team.includes(playerId));
	const defender = chooseTarget(battle, 1 - teamIndex);
	if (!attacker || !defender) return finishBattle(battle, 1 - teamIndex);

	const correct = !timedOut && answer === battle.question.correct;
	if (!timedOut) recordAnswerFeedback(battle, playerId, answer);
	if (correct) {
		const fastAnswer = isFastAnswer(battle.questionStartedAt, Date.now());
		resolveCorrectAnswer(battle, playerId, attacker, defender, fastAnswer);
	} else {
		battle.parryOpportunities.delete(playerId);
		attacker.hp = Math.max(0, attacker.hp - 14);
		battle.log.unshift({ text: timedOut ? `${attacker.name} ran out of time and lost 14 HP.` : `${attacker.name} missed the answer and lost 14 HP.`, kind: 'miss', playerId });
	}
	battle.log = battle.log.slice(0, 8);
	if (finishIfTeamIsDown(battle)) return;
	startTurn(battle, nextActor(battle, playerId));
}

function publicBattle(battle, viewerId) {
	const current = battle.question;
	const winnerTeam = battle.winnerTeamIndex === null ? null : battle.teams[battle.winnerTeamIndex];
	return {
		id: battle.id,
		mode: battle.mode,
		subject: battle.subject,
		topic: battle.topic,
		status: battle.status,
		round: battle.round,
		bossFight: battle.bossFight,
		levelGap: battle.levelGap,
		questionId: battle.questionId,
		questionStartedAt: battle.questionStartedAt,
		parryReady: (participant(battle, viewerId)?.level || 1) >= PARRY_LEVEL
			&& battle.question.difficulty !== 3
			&& battle.parryOpportunities.has(viewerId),
		players: battle.playerIds.map((id) => {
			const player = participant(battle, id);
			return { id, name: player?.name || 'Disconnected player', hp: player?.hp ?? 0, npc: id.startsWith('npc-'), level: player?.level ?? 1, attack: player?.attack ?? 10, defence: player?.defence ?? 2, team: battle.teams.findIndex((team) => team.includes(id)) };
		}),
		teams: battle.teams.map((team) => team.map((id) => ({ id, name: participant(battle, id)?.name || 'Disconnected player' }))),
		turnPlayerId: battle.turnPlayerId,
		isYourTurn: battle.mode === 'simultaneous' ? participant(battle, viewerId)?.hp > 0 && !battle.answers.has(viewerId) : battle.turnPlayerId === viewerId,
		canAnswer: battle.status === 'active' && participant(battle, viewerId)?.hp > 0 && (battle.mode === 'simultaneous' ? !battle.answers.has(viewerId) : battle.turnPlayerId === viewerId),
		hasAnswered: battle.answers.has(viewerId),
		answerFeedback: battle.answerFeedback.get(viewerId) || null,
		answersReceived: battle.answers.size,
		question: battle.status === 'active' && participant(battle, viewerId)?.hp > 0 && (battle.mode === 'simultaneous' ? !battle.answers.has(viewerId) : battle.turnPlayerId === viewerId) ? {
			chapter: current.chapter,
			difficulty: current.difficulty || 1,
			prompt: current.prompt,
			options: current.options,
		} : null,
		deadline: battle.deadline,
		winnerId: battle.winnerId,
		winnerTeamIndex: battle.winnerTeamIndex,
		winnerName: winnerTeam ? winnerTeam.map((id) => participant(battle, id)?.name || 'Player').join(' + ') : null,
		xpEarned: battle.rewards?.[viewerId] ?? null,
		hint: battle.hints.get(viewerId) || null,
		hintUsed: battle.hints.has(viewerId),
		log: battle.log,
	};
}

function createBattle(mode, teams, npc = null, challengerId = null, subject = 'computers', topic = null) {
	const playerIds = teams.flat();
	const battle = {
		id: crypto.randomUUID(),
		mode,
		subject,
		topic,
		teams,
		playerIds,
		turnOrder: buildTurnOrder(teams, mode === 'online'),
		challengerId,
		npc,
		status: 'active',
		round: 0,
		answers: new Set(),
		answerFeedback: new Map(),
		winnerId: null,
		winnerTeamIndex: null,
		log: [{ text: mode === 'npc' ? `${npc.name} steps into the arena.` : 'A player duel begins.', kind: 'info' }],
		npcTimer: null,
		parryOpportunities: new Map(),
	};
	battle.levelGap = levelGapBetweenTeams(teams);
	battle.bossFight = mode === 'npc'
		? npc.level >= 50 || npc.level - (players.get(teams[0][0])?.level || 1) >= BOSS_FIGHT_LEVEL_GAP
		: battle.levelGap >= BOSS_FIGHT_LEVEL_GAP;
	battles.set(battle.id, battle);
	for (const id of playerIds) {
		const player = players.get(id);
		if (player) { player.hp = MAX_HP; player.battleId = battle.id; }
	}
	startTurn(battle, battle.turnOrder[0]);
	return battle;
}

function createChallenge(challenger, opponents, mode, format, subject, topic) {
	const teams = format === '2v2'
		? [[challenger.id, opponents[0].id], [opponents[1].id, opponents[2].id]]
		: [[challenger.id], opponents.map((member) => member.id)];
	const challenge = {
		id: crypto.randomUUID(),
		challengerId: challenger.id,
		opponentIds: opponents.map((opponent) => opponent.id),
		mode: mode === 'simultaneous' ? 'simultaneous' : 'online',
		format,
		subject,
		topic,
		levelGap: levelGapBetweenTeams(teams),
		acceptedIds: new Set([challenger.id]),
	};
	challenges.set(challenge.id, challenge);
	challenger.challengeId = challenge.id;
	for (const opponent of opponents) opponent.challengeId = challenge.id;
	return challenge;
}

function getOnlinePlayers(playerId, now = Date.now(), playerMap = players) {
	return [...playerMap.values()]
		.filter((player) => player.id !== playerId && now - player.lastSeen < 45_000)
		.map(({ id, name, level, attack, defence, battleId, challengeId }) => ({
			id,
			name,
			level,
			attack,
			defence,
			status: battleId ? 'in-match' : challengeId ? 'invited' : 'available',
		}));
}

function getPlayerState(playerId) {
	const player = players.get(playerId);
	if (!player) return null;
	player.lastSeen = Date.now();
	const battle = player.battleId && battles.get(player.battleId);
	if (battle?.status === 'active' && Date.now() >= battle.deadline) {
		resolveTurn(battle, battle.turnPlayerId, -1, true);
	}
	return {
		subjects: SUBJECTS,
		you: {
			id: player.id,
			name: player.name,
			username: player.username || '',
			hasPassword: Boolean(player.passwordHash),
			hp: player.hp,
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
		onlinePlayers: getOnlinePlayers(playerId),
		opponents: [...players.values()]
			.filter((opponent) => opponent.id !== playerId && !opponent.battleId && !opponent.challengeId && Date.now() - opponent.lastSeen < 45_000)
			.map(({ id, name, level, attack, defence }) => ({ id, name, level, attack, defence })),
		incomingChallenges: [...challenges.values()]
			.filter((challenge) => challenge.opponentIds.includes(playerId))
			.map((challenge) => ({ id: challenge.id, name: players.get(challenge.challengerId)?.name || 'Player', mode: challenge.mode, format: challenge.format, topic: challenge.topic, levelGap: challenge.levelGap, accepted: challenge.acceptedIds.size - 1, required: challenge.opponentIds.length, hasAccepted: challenge.acceptedIds.has(playerId) })),
		outgoingChallenges: [...challenges.values()]
			.filter((challenge) => challenge.challengerId === playerId)
			.map((challenge) => ({ id: challenge.id, name: challenge.opponentIds.map((id) => players.get(id)?.name || 'Player').join(', '), mode: challenge.mode, format: challenge.format, topic: challenge.topic, levelGap: challenge.levelGap, accepted: challenge.acceptedIds.size - 1, required: challenge.opponentIds.length })),
		npcs: getAvailableNpcs(player.level),
		battle: battle ? publicBattle(battle, playerId) : null,
	};
}

function handleApi(request, response, url) {
	if (request.method === 'POST' && url.pathname === '/api/import-local-account') {
		return readBody(request).then(({ format, account: value, password }) => {
			if (format !== 'ict-quattle-local-account-v1') {
				return json(response, 400, { error: 'Choose a valid ICT QUttle browser save file' });
			}
			const imported = validateImportedAccount(value);
			const existingPlayer = [...players.values()].find((candidate) => candidate.usernameKey === imported.usernameKey);
			if (existingPlayer) {
				if (!verifyPassword(password, existingPlayer)) {
					return json(response, 401, { error: 'That username already has a server account. Enter its server password to merge progress.' });
				}
				mergeImportedProgress(existingPlayer, imported);
				savePlayers(PLAYER_DATA_FILE, players);
				return json(response, 200, { ...getPlayerState(existingPlayer.id), migration: 'merged' });
			}

			const credentials = hashPassword(password);
			const playerId = crypto.randomUUID();
			const player = {
				id: playerId,
				name: imported.username,
				username: imported.username,
				usernameKey: imported.usernameKey,
				...credentials,
				xp: imported.xp,
				totalXp: imported.totalXp,
				xpBalance: imported.xpBalance,
				xpSpent: imported.xpSpent,
				level: imported.level,
				...combatStats(imported.level),
				matches: imported.matches,
				wins: imported.wins,
				losses: imported.losses,
				draws: imported.draws,
				homeworkRewardDate: imported.homeworkRewardDate,
				hp: MAX_HP,
				battleId: null,
				challengeId: null,
				lastSeen: Date.now(),
			};
			players.set(playerId, player);
			savePlayers(PLAYER_DATA_FILE, players);
			return json(response, 201, { ...getPlayerState(playerId), migration: 'imported' });
		}).catch((error) => json(response, 400, { error: error.message }));
	}

	if (request.method === 'POST' && url.pathname === '/api/register') {
		return readBody(request).then(({ username, password }) => {
			const account = normalizeUsername(username);
			if ([...players.values()].some((player) => player.usernameKey === account.usernameKey)) {
				return json(response, 409, { error: 'That username is already taken' });
			}
			const credentials = hashPassword(password);
			const player = {
				id: crypto.randomUUID(),
				name: account.username,
				...account,
				...credentials,
				hp: MAX_HP,
				xp: 0,
				totalXp: 0,
				xpBalance: 0,
				xpSpent: 0,
				level: 1,
				...combatStats(1),
				matches: 0,
				wins: 0,
				losses: 0,
				draws: 0,
				battleId: null,
				lastSeen: Date.now(),
			};
			players.set(player.id, player);
			savePlayers(PLAYER_DATA_FILE, players);
			return json(response, 201, getPlayerState(player.id));
		}).catch((error) => json(response, 400, { error: error.message }));
	}

	if (request.method === 'POST' && url.pathname === '/api/login') {
		return readBody(request).then(({ username, password }) => {
			let usernameKey;
			try {
				usernameKey = normalizeUsername(username).usernameKey;
			} catch {
				return json(response, 401, { error: 'Username or password is incorrect' });
			}
			const player = [...players.values()].find((candidate) => candidate.usernameKey === usernameKey);
			if (!player || !verifyPassword(password, player)) {
				return json(response, 401, { error: 'Username or password is incorrect' });
			}
			return json(response, 200, getPlayerState(player.id));
		}).catch((error) => json(response, 400, { error: error.message }));
	}

	if (request.method === 'POST' && url.pathname === '/api/account/setup') {
		return readBody(request).then(({ playerId, username, password }) => {
			const player = players.get(String(playerId || ''));
			if (!player) return json(response, 404, { error: 'Player session not found' });
			if (player.passwordHash) return json(response, 409, { error: 'This profile already has an account password' });
			const account = normalizeUsername(username);
			if ([...players.values()].some((candidate) => candidate.id !== player.id && candidate.usernameKey === account.usernameKey)) {
				return json(response, 409, { error: 'That username is already taken' });
			}
			Object.assign(player, account, hashPassword(password), { name: account.username });
			savePlayers(PLAYER_DATA_FILE, players);
			return json(response, 200, getPlayerState(player.id));
		}).catch((error) => json(response, 400, { error: error.message }));
	}

	if (request.method === 'POST' && url.pathname === '/api/account') {
		return readBody(request).then(({ playerId, currentPassword, username, password }) => {
			const player = players.get(String(playerId || ''));
			if (!player) return json(response, 404, { error: 'Player session not found' });
			if (!verifyPassword(currentPassword, player)) return json(response, 401, { error: 'Current password is incorrect' });
			const account = normalizeUsername(username);
			if ([...players.values()].some((candidate) => candidate.id !== player.id && candidate.usernameKey === account.usernameKey)) {
				return json(response, 409, { error: 'That username is already taken' });
			}
			const credentials = password ? hashPassword(password) : {
				passwordSalt: player.passwordSalt,
				passwordHash: player.passwordHash,
			};
			Object.assign(player, account, credentials, { name: account.username });
			savePlayers(PLAYER_DATA_FILE, players);
			return json(response, 200, getPlayerState(player.id));
		}).catch((error) => json(response, 400, { error: error.message }));
	}

	if (request.method === 'POST' && url.pathname === '/api/homework-check') {
		return readBody(request).then(({ playerId, completed }) => {
			const player = players.get(String(playerId || ''));
			if (!player) return json(response, 404, { error: 'Player session not found' });
			if (completed !== true) return json(response, 400, { error: 'Confirm that your homework is finished' });
			const xpAwarded = awardHomeworkXp(player);
			if (xpAwarded) savePlayers(PLAYER_DATA_FILE, players);
			return json(response, 200, { ...getPlayerState(player.id), xpAwarded });
		}).catch((error) => json(response, 400, { error: error.message }));
	}

	if (request.method === 'POST' && url.pathname === '/api/join') {
		return readBody(request).then(({ name, playerId }) => {
			const safeName = String(name || 'Player').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 18) || 'Player';
			let player = playerId && players.get(String(playerId));
			if (!player || player.passwordHash) return json(response, 409, { error: 'Use your account to join or change your username' });
			player.name = safeName;
			player.lastSeen = Date.now();
			savePlayers(PLAYER_DATA_FILE, players);
			return json(response, 200, getPlayerState(player.id));
		}).catch((error) => json(response, 400, { error: error.message }));
	}

	if (request.method === 'GET' && url.pathname === '/api/state') {
		const state = getPlayerState(url.searchParams.get('playerId'));
		return state ? json(response, 200, state) : json(response, 404, { error: 'Player session not found' });
	}

	if (request.method === 'GET' && url.pathname === '/api/study-room') {
		const room = getStudyRoomState(url.searchParams.get('playerId'));
		return room ? json(response, 200, room) : json(response, 404, { error: 'Player session not found' });
	}

	if (request.method === 'POST' && ['/api/study-status', '/api/study-chat', '/api/study-chat/clear', '/api/practice-question', '/api/practice-answer', '/api/battle', '/api/challenge', '/api/respond', '/api/answer', '/api/hint', '/api/resign', '/api/leave'].includes(url.pathname)) {
		return readBody(request).then(({ playerId, opponentId, opponentIds, answer, questionId, mode, format, challengeId, accepted, subject, topic, studying, message }) => {
			const player = players.get(String(playerId || ''));
			if (!player) return json(response, 404, { error: 'Player session not found' });

			if (url.pathname === '/api/study-chat/clear') {
				studyMessages.length = 0;
			} else if (url.pathname === '/api/study-status') {
				const selectedSubject = SUBJECTS.find((item) => item.id === subject)?.id;
				if (typeof studying !== 'boolean' || !selectedSubject) return json(response, 400, { error: 'Choose a valid study status and subject' });
				player.lastSeen = Date.now();
				if (studying) studyStatuses.set(player.id, { studying: true, subject: selectedSubject });
				else studyStatuses.delete(player.id);
			} else if (url.pathname === '/api/study-chat') {
				const text = censorProfanity(String(message || '').trim().slice(0, 240));
				const selectedSubject = SUBJECTS.find((item) => item.id === subject)?.id;
				if (!text || !selectedSubject) return json(response, 400, { error: 'Enter a message and choose a valid subject' });
				player.lastSeen = Date.now();
				studyMessages.push({
					id: crypto.randomUUID(),
					playerId: player.id,
					name: player.name,
					subject: selectedSubject,
					text,
					warning: !isStudyRelatedMessage(text),
					sentAt: Date.now(),
				});
				if (studyMessages.length > MAX_STUDY_MESSAGES) studyMessages.splice(0, studyMessages.length - MAX_STUDY_MESSAGES);
			} else if (url.pathname === '/api/practice-question') {
				const result = getSoloPracticeQuestion(player.id, subject, topic || null);
				if (!result) return json(response, 400, { error: 'Choose a valid subject and topic available in Solo Practice' });
				return json(response, 200, result);
			} else if (url.pathname === '/api/practice-answer') {
				const result = answerSoloPracticeQuestion(player.id, questionId, answer);
				if (!result) return json(response, 409, { error: 'That practice question has ended. Load the next question.' });
				const xpAwarded = result.correct ? SOLO_PRACTICE_XP : 0;
				if (xpAwarded) {
					addExperience(player, xpAwarded);
					savePlayers(PLAYER_DATA_FILE, players);
				}
				return json(response, 200, {
					...result,
					xpAwarded,
					progress: {
						xp: player.xp,
						totalXp: player.totalXp,
						xpBalance: player.xpBalance,
						level: player.level,
						attack: player.attack,
						defence: player.defence,
					},
				});
			} else if (url.pathname === '/api/battle') {
				if (player.battleId || player.challengeId) return json(response, 409, { error: 'Finish your current match or invitation first' });
				const selectedSubject = SUBJECTS.find((item) => item.id === subject)?.id;
				if (!selectedSubject) return json(response, 400, { error: 'Choose a Grade 9 subject' });
				const subjectInfo = SUBJECTS.find((item) => item.id === selectedSubject);
				if (subjectInfo?.battleAvailable === false) {
					return json(response, 409, { error: `${SUBJECTS.find((item) => item.id === selectedSubject).name} is available in Solo Practice. Switch to Solo Studies to practice this subject.` });
				}
				if (topic && !subjectInfo.battleTopics.includes(topic)) return json(response, 400, { error: 'Choose a valid topic for this battle' });
				const npc = npcs.find((item) => item.id === opponentId);
				if (!npc) return json(response, 400, { error: 'Choose an arena NPC' });
				if (!getAvailableNpcs(player.level).some((item) => item.id === npc.id)) {
					return json(response, 409, { error: 'Reach a higher level to unlock that arena rival' });
				}
				createBattle('npc', [[player.id], [npc.id]], { ...npc, hp: MAX_HP }, null, selectedSubject, topic || null);
			} else if (url.pathname === '/api/challenge') {
				if (player.battleId || player.challengeId) return json(response, 409, { error: 'Finish your current match or invitation first' });
				const selectedSubject = SUBJECTS.find((item) => item.id === subject)?.id;
				if (!selectedSubject) return json(response, 400, { error: 'Choose a Grade 9 subject' });
				const subjectInfo = SUBJECTS.find((item) => item.id === selectedSubject);
				if (subjectInfo?.battleAvailable === false) {
					return json(response, 409, { error: `${SUBJECTS.find((item) => item.id === selectedSubject).name} is available in Solo Practice. Switch to Solo Studies to practice this subject.` });
				}
				if (topic && !subjectInfo.battleTopics.includes(topic)) return json(response, 400, { error: 'Choose a valid topic for this battle' });
				const selectedFormat = ['1v1', '2v2', '1v2'].includes(format) ? format : '1v1';
				const expectedOpponents = selectedFormat === '2v2' ? 3 : selectedFormat === '1v2' ? 2 : 1;
				const selectedIds = [...new Set(Array.isArray(opponentIds) ? opponentIds.map(String) : opponentId ? [String(opponentId)] : [])];
				if (selectedIds.length !== expectedOpponents) return json(response, 400, { error: `${selectedFormat} requires ${expectedOpponents} invited player${expectedOpponents === 1 ? '' : 's'}` });
				const opponents = selectedIds.map((id) => players.get(id));
				if (opponents.some((opponent) => !opponent || opponent.id === player.id || opponent.battleId || opponent.challengeId || Date.now() - opponent.lastSeen > 45_000)) {
					return json(response, 409, { error: 'That player is no longer available' });
				}
				const teams = selectedFormat === '2v2'
					? [[player.id, opponents[0].id], [opponents[1].id, opponents[2].id]]
					: [[player.id], opponents.map((member) => member.id)];
				if (levelGapBetweenTeams(teams) > MAX_PVP_LEVEL_GAP) {
					return json(response, 409, { error: 'Player duels are disabled when opposing players are more than 10 levels apart' });
				}
				createChallenge(player, opponents, mode, selectedFormat, selectedSubject, topic || null);
			} else if (url.pathname === '/api/respond') {
				const challenge = challenges.get(String(challengeId || ''));
				if (!challenge || ![challenge.challengerId, ...challenge.opponentIds].includes(player.id)) {
					return json(response, 404, { error: 'Invitation not found' });
				}
				if (accepted && !challenge.opponentIds.includes(player.id)) return json(response, 403, { error: 'Only an invited player can accept' });
				const challenger = players.get(challenge.challengerId);
				if (!accepted) {
					challenges.delete(challenge.id);
					for (const id of [challenge.challengerId, ...challenge.opponentIds]) {
						const member = players.get(id);
						if (member?.challengeId === challenge.id) member.challengeId = null;
					}
				} else {
					challenge.acceptedIds.add(player.id);
					if (challenge.opponentIds.every((id) => challenge.acceptedIds.has(id))) {
						const opponents = challenge.opponentIds.map((id) => players.get(id));
						if (!challenger || !opponents.every((member) => member && !member.battleId)) return json(response, 409, { error: 'A player is no longer available' });
						const teams = challenge.format === '2v2'
							? [[challenger.id, opponents[0].id], [opponents[1].id, opponents[2].id]]
							: [[challenger.id], opponents.map((member) => member.id)];
						if (levelGapBetweenTeams(teams) > MAX_PVP_LEVEL_GAP) {
							challenges.delete(challenge.id);
							for (const member of [challenger, ...opponents]) {
								if (member.challengeId === challenge.id) member.challengeId = null;
							}
							return json(response, 409, { error: 'This duel was cancelled because opposing players are now more than 10 levels apart' });
						}
						challenges.delete(challenge.id);
						for (const member of [challenger, ...opponents]) member.challengeId = null;
						createBattle(challenge.mode, teams, null, challenger.id, challenge.subject, challenge.topic);
					}
				}
			} else if (url.pathname === '/api/answer') {
				const battle = player.battleId && battles.get(player.battleId);
				if (!battle || battle.status !== 'active' || player.hp <= 0 || (battle.mode === 'simultaneous' ? battle.answers.has(player.id) : battle.turnPlayerId !== player.id)) {
					return json(response, 409, { error: 'It is not your turn' });
				}
				if (questionId !== battle.questionId) return json(response, 409, { error: 'That question has already ended' });
				if (Date.now() >= battle.deadline) resolveTurn(battle, battle.mode === 'simultaneous' ? null : player.id, -1, true);
				else resolveTurn(battle, player.id, Number(answer), false);
			} else if (url.pathname === '/api/hint') {
				const battle = player.battleId && battles.get(player.battleId);
				const canAnswer = battle?.mode === 'simultaneous'
					? !battle.answers.has(player.id)
					: battle?.turnPlayerId === player.id;
				if (!battle || battle.status !== 'active' || player.hp <= 0 || !canAnswer) return json(response, 409, { error: 'Hints are only available on your active question' });
				if (battle.hints.has(player.id)) return json(response, 409, { error: 'You already used a hint on this question' });
				if (player.xpBalance < HINT_COST) return json(response, 400, { error: 'You need 20 XP to buy a hint' });
				player.xpBalance -= HINT_COST;
				player.xpSpent += HINT_COST;
				battle.hints.set(player.id, battle.question.hint);
			} else if (url.pathname === '/api/resign') {
				const battle = player.battleId && battles.get(player.battleId);
				if (!battle || battle.status !== 'active') return json(response, 409, { error: 'There is no active match to resign from' });
				if (player.xpBalance < RESIGN_COST) return json(response, 400, { error: 'You need 50 XP to resign' });
				const playerTeam = battle.teams.findIndex((team) => team.includes(player.id));
				finishBattle(battle, 1 - playerTeam, player.id);
				battle.log.unshift({ text: `${player.name} resigned and lost 50 XP.`, kind: 'miss' });
				battle.log = battle.log.slice(0, 8);
			} else if (url.pathname === '/api/leave') {
				const battle = player.battleId && battles.get(player.battleId);
				if (battle?.status === 'active') {
					const playerTeam = battle.teams.findIndex((team) => team.includes(player.id));
					finishBattle(battle, 1 - playerTeam);
					battle.log.unshift({ text: `${player.name} left the battle.`, kind: 'miss' });
				}
				player.battleId = null;
				player.hp = MAX_HP;
			}
			return json(response, 200, getPlayerState(player.id));
		}).catch((error) => json(response, 400, { error: error.message }));
	}

	json(response, 404, { error: 'Not found' });
}

const server = http.createServer((request, response) => {
	const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
	if (url.pathname.startsWith('/api/')) return handleApi(request, response, url);
	if (request.method !== 'GET' || (url.pathname !== '/' && url.pathname !== '/index.html')) {
		const assetPath = STATIC_ASSETS.get(url.pathname);
		if (request.method === 'GET' && assetPath) {
			return fs.readFile(assetPath, (error, content) => {
				if (error) {
					response.writeHead(500);
					return response.end('Game asset is missing');
				}
				response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
				response.end(content);
			});
		}
		response.writeHead(404);
		return response.end('Not found');
	}
	fs.readFile(INDEX, (error, content) => {
		if (error) {
			response.writeHead(500);
			return response.end('Game client is missing');
		}
		response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
		response.end(content);
	});
});

if (require.main === module) {
	server.listen(PORT, '0.0.0.0', () => {
		console.log(`ICT QUttle is live at http://localhost:${PORT}`);
	});
}

module.exports = {
	SUBJECTS,
	MAX_LEVEL,
	MAX_PVP_LEVEL_GAP,
	PARRY_LEVEL,
	addExperience,
	awardHomeworkXp,
	answerSoloPracticeQuestion,
	buildTurnOrder,
	censorProfanity,
	combatStats,
	damageFor,
	getQuestion,
	getSoloPracticeQuestion,
	getOnlinePlayers,
	getAvailableNpcs,
	levelGapBetweenTeams,
	parryDamageFor,
	isStudyRelatedMessage,
	loadSavedPlayers,
	hashPassword,
	mergeImportedProgress,
	normalizeUsername,
	validateImportedAccount,
	isFastAnswer,
	npcWinXp,
	questionDamageMultiplier,
	savePlayers,
	verifyPassword,
};
