# ICT QUttle

ICT QUttle opens with two paths:

- **Solo Studies** lets you battle bots or run a 25-minute focus / 5-minute break Pomodoro. The study page includes a browser-generated ambient loop and a live list of other solo learners.
- **Online Multiplayer** keeps player challenges and team battles, and adds a study lounge with subject-based chat and off-topic reminders.

On a static host such as GitHub Pages, the app automatically switches to local browser mode: account credentials (stored as PBKDF2 hashes), progress, practice XP, homework rewards, and solo bot battles are saved in that browser's `localStorage`. Local accounts and usernames are not shared across browsers or devices, and changing browsers or clearing site data can lose that save. Because browser storage is controlled by the device owner, these local accounts are not suitable for protecting sensitive information; do not reuse an important password. Static mode cannot provide online multiplayer or shared study chat. Those features need the Node.js server described below. Existing server profiles are not automatically copied into browser storage.

Use **Settings** (the gear button in the top bar) to open **Personalise** or **Account**. Personalise lets you choose the retro grid or a classic, blue, sage, lilac, sunset, mint, coral, or golden-hour background, or pick a custom solid colour. Optional correct-answer confetti, lobby music, and first-person battles are also available there. These choices are saved in the current browser and do not change other players' displays. First-person battles show block-style rivals with mini health bars, your health bar, and an energy orb that launches at a rival and shrinks away on impact, or explodes when you run out of time. A defeated rival disappears in a small burst. Hard questions charge a yellow orb; the two-second fast-answer window enlarges it, combining into a large yellow orb on hard questions. Taking damage briefly flashes the screen red. Lobby music is generated locally and pauses during battles and Pomodoro. Reduced-motion preferences disable the confetti and battle animations. In the study lounge, **Clear my view** hides existing messages only in your browser; **Clear for everyone** empties the shared in-memory chat after confirmation.

Solo Practice includes at least 100 original question variants for each of the 11 subjects, including a combined **Computers** subject for ICT and Computer Science. Select a subject, then choose a chapter or keep **All chapters** selected; changing chapters loads a question from that chapter. Computers includes ICT syllabus sections 1.2, 1.3, 2.1, 2.3, 3, 6, 9, and 10 alongside Computer Science topics; Scripture practice covers all five listed Gospel, healing, choices, and memory-verse chapters. Answers are marked visibly, include an explanation, and award 2 XP for each correct question, once per question. Business Studies questions use brief mini-case scenarios. The questions are original practice material, not copied from the sources. Some syllabus references are broader than the exact school term plan, and English course variants can differ, so use the school plan as the authority for examinable content.

Curriculum references:

- [Cambridge IGCSE First Language English](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-first-language-english-0500/)
- [Cambridge IGCSE Mathematics](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-mathematics-0580/)
- [Cambridge IGCSE Physics](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-physics-0625/)
- [Cambridge IGCSE Chemistry](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-chemistry-0620/)
- [Cambridge IGCSE Biology](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-biology-0610/)
- [Cambridge IGCSE French](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-french-0520/) and [RFI French learning](https://francaisfacile.rfi.fr/fr/)
- [Cambridge IGCSE Hindi as a Second Language](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-hindi-as-a-second-language-0549/)
- [Cambridge IGCSE Global Perspectives](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-global-perspectives-0457/)
- [Cambridge IGCSE Business Studies](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-business-studies-0450/)
- Computers: [Cambridge IGCSE Computer Science](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-computer-science-0478/) and [Cambridge IGCSE Information and Communication Technology](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-information-and-communication-technology-0417/)
- [King James Version: Mark 1–3](https://www.biblegateway.com/passage/?search=Mark%201-3&version=KJV), [Genesis 12–13](https://www.biblegateway.com/passage/?search=Genesis%2012-13&version=KJV), and [1 Samuel 17](https://www.biblegateway.com/passage/?search=1%20Samuel%2017&version=KJV)

English is referenced as Cambridge First Language English and French as Foreign Language; verify those variants against the school’s course.

Online matches support 1v1, 2v2, and 1v2 formats, with turn-based or simultaneous questions. Choose a subject and optionally focus on a populated chapter; chapter choices carry through multiplayer invitations. Bot and player battles are available for every subject except English, Mathematics, and Business, which remain practice-only. In 2v2, the inviter's first selected player is their teammate; in 1v2, the inviter faces both selected players. Simultaneous matches show both players the same question; the first correct answer resolves it. The lobby keeps active players visible and labels them as in a match or with an invite pending.

Each question has a 20-second timer. Battle questions are randomly chosen from the selected subject and chapter without adjusting the pool for player level. A correct answer deals 15 base damage, modified by the attacker's Attack and the defender's Defence, and restores 3 HP. Hard questions deal 50% extra damage to whichever player answers correctly; the same rule applies to either side. Answer correctly within the first 2 seconds after a question appears to deal double damage (the bonuses combine). Each level adds 1 Attack and every two levels add 1 Defence. A wrong answer or timeout costs 14 HP. Online turn-based matches randomly choose which team takes the first turn. Player-versus-player duels are blocked when opposing players differ by more than 10 levels; gaps of 5–10 levels warn players and switch to boss music. Players unlock another bot with each level, with bots up to 10 levels above them available. Level 50 unlocks parrying: a fast correct answer reflects the previous hit, but a hard question shatters the barrier. The match ends when every player on a team reaches 0 HP.

Players earn XP from practice and completed matches: a correct Solo Practice answer awards 2 XP once, NPC wins award 80 XP plus 10 XP for each NPC level above level 1 (for example, 170 XP for defeating a level 10 NPC), and an NPC loss awards 30 XP. Online wins award 100 XP, online losses 45 XP, and draws 30 XP. Every level requires 100 more XP than the previous level, up to level 100. Player levels, XP, match records, and account credentials are saved automatically in `data/players.json` and survive server restarts. Sign in with a unique username and password to reconnect to your saved profile from another browser or after logging out. Existing profiles are prompted to add a password once; doing so preserves their progress. Account settings let you update your username and password, and usernames are case-insensitively unique. Passwords are stored as salted hashes. Current HP and active battles reset when the server restarts.

Browser-local saves can be moved to the server from the sign-in screen: enter the local username and password, choose **Export browser save**, then choose **Import browser save** on the server and select the downloaded JSON file. After signing in, you can export either a browser-local or server account from **Settings → Account → Export save** by re-entering your current password. The file contains player progress but no password hash; the password for the account creates a new server account. If the username already exists on the server, enter that account's server password when prompted; the server keeps its password and merges progress conservatively by retaining higher XP, level, and match totals. The export can fall back to the sign-in endpoint on servers that have not yet deployed the dedicated export route. Browser storage is isolated by site origin, so this file transfer is needed when moving a save from a different site or browser.

On opening the app, a homework check-in asks whether homework is finished. Confirming with **Yes, finished** earns 2 XP once per UTC day and displays the KJV verse of the day. Choosing **No, not yet** opens the Pomodoro and keeps navigation locked until **Finished** is pressed; completing that check-in also earns the XP and displays the verse. The pending check-in is remembered in the browser.

## Run locally

Requires Node.js 18 or newer. No packages are needed.

```sh
node server.js
```

Open [http://localhost:3000](http://localhost:3000). For online duels and study chat, players must connect to the same reachable server. Study presence expires after 45 seconds without activity. Study chat retains only the latest 50 messages in memory, censors common profanity, and flags a small set of obvious off-topic keywords; these are basic filters, not comprehensive content moderation.

Lo-fi-style audio, including its steady drum beat, and optional cinematic action-adventure lobby music with distorted, layered electric guitars are generated locally by the browser and do not stream music. The faster boss mix adds octave guitar layers, driving bass, double-kick drums, cymbal crashes, and a more intense low-health variation. Winning a boss NPC battle plays a dedicated victory fanfare; other wins retain the standard victory cue. **Settings → Personalise** has separate, saved volume sliders for lobby/Pomodoro music and battle/practice sound effects. Lobby music can be enabled there and is automatically stopped in battles and Pomodoro. Battle and practice sounds require a user gesture and can be disabled with the Sound toggle; battles include turn-start and final-five-seconds cues. The ambient loop can be stopped from the Pomodoro controls. The **Update log** in the top bar summarizes recent app changes. Audio/video calls are not implemented: they need WebRTC signaling and TURN infrastructure, which this standalone server does not include.

## Update log

### 1 November 2026 — Accounts and settings

- Added username and password sign-in so players can recover saved profiles after being logged out.
- Prompted existing players to secure their saved progress with a password, and added account editing under Settings.
- Moved Personalise into the Settings gear menu and kept usernames unique.
- Expanded progression to level 100 and unlocks a new bot each level, with an unlock sound.
- Blocked player duels across gaps greater than 10 levels and added warnings and boss music for gaps of 5 or more.
- Added level-50 fast-answer parrying, with hard questions breaking the shield.
- Added an original thrash-metal boss mix with driving bass, double-kick drums, and extra intensity at critical health.
- Intensified the generated metal soundtrack with layered guitars, faster drums, and cymbal crashes; added a boss-only victory fanfare.
- Added saved, separate volume controls for music and sound effects.

### 28 October 2026 — Audio and sound improvements

- Added a steady, softly mixed drum groove to the browser-generated lo-fi study loop.
- Added distinct sound cues for battle starts, hits, misses, victories, defeats, and correct or incorrect practice answers.
- Added an in-app update log in the top bar to keep recent changes visible.

### 29 October 2026 — Gameplay and personalisation

- Made battle question selection random across all difficulty levels.
- Added subtle battle animations with reduced-motion support.
- Added optional lobby music, disabled during battles and Pomodoro.
- Improved saved-profile reconnect handling and consolidated a duplicate player save.

The app is suitable for small groups on one Node.js instance. Player activity, battles, challenges, and study chat are held in memory; player progression is written to `data/players.json`. Running the process on an always-on host can make the site available 24/7, but availability, backups, and persistent disk must be configured by the host. Multi-instance scaling requires shared storage and a real-time coordination service; those are not included.

## Tests

```sh
node --test server.test.js local-game.test.js
```

Battle question banks include easy, intermediate, and hard variants selected randomly across the chosen subject and populated chapter, regardless of participant level. Chapter choices are built from populated questions and validated by the server. Solo Practice provides 100 or more generated question variants for each syllabus subject, checks answers and awards XP on the server or locally in static mode, and shows curriculum references in the practice view. Questions are original practice material.
