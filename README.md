# StudySprint

StudySprint opens with two paths:

- **Solo Studies** lets you practice with Prannoy, your topic-explaining study guide, battle subject-specific bots, or run a 25-minute focus / 5-minute break Pomodoro. Solo Practice questions have no timer. Battle-enabled subjects have independent XP and levels, with Danthecanman as their level-up rival. English, Mathematics, and Business Studies are practice-only and award lifetime XP without advancing battle-level progression. The study page includes a browser-generated ambient loop and a live list of other solo learners.
- **Online Multiplayer** keeps player challenges and team battles, and adds a study lounge with subject-based chat and off-topic reminders. Multiplayer questions have a server-enforced 20-second deadline; question and answer text is rendered as non-selectable canvas, while copy or tab-switch attempts forfeit the turn. Unlocked bots are kept out of the player list and can be challenged one at a time from a dropdown.

On a static host such as GitHub Pages, the app automatically switches to local browser mode after its startup health check confirms that no API server is present: account credentials (stored as PBKDF2 hashes), progress, practice XP, solo focus time, character icon, homework rewards, and solo bot battles are saved in that browser's `localStorage`. Temporary API or proxy errors do not switch a connected server session into local mode, and a server profile ID is kept when local mode is detected. Local accounts and usernames are not shared across browsers or devices, and changing browsers or clearing site data can lose that save. Because browser storage is controlled by the device owner, these local accounts are not suitable for protecting sensitive information; do not reuse an important password. Static mode cannot provide online multiplayer or shared study chat. Those features need the Node.js server described below. Existing server profiles are not automatically copied into browser storage.

Use **Settings** (the gear button in the top bar) to read about the founders, Bentin Nehemiah and Daniel Nelson, and to open **Personalise** or **Account**. Personalise lets you choose a character icon (temporary glyphs until the promised PNG artwork is available), a retro grid, classic, dark, blue, sage, lilac, sunset, mint, coral, golden-hour, or custom solid background. Optional correct-answer confetti, lobby music, and first-person battles are also available there. The character icon is saved on the player profile; visual preferences are saved in the current browser and do not change other players' displays. First-person battles show block-style rivals with mini health bars, your health bar, and an energy orb that launches at a rival and shrinks away on impact, or explodes when you run out of time. A defeated rival disappears in a small burst. Hard questions charge a yellow orb; the two-second fast-answer window enlarges it, combining into a large yellow orb on hard questions. Taking damage briefly flashes the screen red. Lobby music is generated locally and pauses during battles and Pomodoro. Reduced-motion preferences disable the confetti and battle animations. In the study lounge, **Clear my view** hides existing messages only in your browser; **Clear for everyone** empties the shared in-memory chat after confirmation.

The **Leaderboard** button shows the top 10 players by lifetime XP or recorded solo focus time. Focus time counts only while the Pomodoro is in its focus phase. Server leaderboards are shared by players on the same server; static mode ranks accounts saved in the current browser.

Solo Practice includes at least 200 original question variants for each of the 10 subjects, including a combined **Computers** subject for ICT and Computer Science. Global Perspectives is no longer included. Select a subject, then choose a chapter or keep **All chapters** selected; changing chapters loads a question from that chapter. Computers includes ICT syllabus sections 1.2, 1.3, 2.1, 2.3, 3, 6, 9, and 10 alongside Computer Science topics; Scripture practice covers all five listed Gospel, healing, choices, and memory-verse chapters. Correct answers award 1 XP toward that subject's level. Prannoy explains selected topics and gives supportive feedback after practice answers, and recent questions are avoided where possible. After 30 solo questions or 5 multiplayer battles in one subject, the game suggests another subject. Business Studies questions use brief mini-case scenarios. The questions are original practice material, not copied from the sources. Some syllabus references are broader than the exact school term plan, and English course variants can differ, so use the school plan as the authority for examinable content.

Curriculum references:

- [Cambridge IGCSE First Language English](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-first-language-english-0500/)
- [Cambridge IGCSE Mathematics](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-mathematics-0580/)
- [Cambridge IGCSE Physics](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-physics-0625/)
- [Cambridge IGCSE Chemistry](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-chemistry-0620/)
- [Cambridge IGCSE Biology](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-biology-0610/)
- [Cambridge IGCSE French](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-french-0520/) and [RFI French learning](https://francaisfacile.rfi.fr/fr/)
- [Cambridge IGCSE Hindi as a Second Language](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-hindi-as-a-second-language-0549/)
- [Cambridge IGCSE Business Studies](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-business-studies-0450/)
- Computers: [Cambridge IGCSE Computer Science](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-computer-science-0478/) and [Cambridge IGCSE Information and Communication Technology](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-information-and-communication-technology-0417/)
- [King James Version: Mark 1–3](https://www.biblegateway.com/passage/?search=Mark%201-3&version=KJV), [Genesis 12–13](https://www.biblegateway.com/passage/?search=Genesis%2012-13&version=KJV), and [1 Samuel 17](https://www.biblegateway.com/passage/?search=1%20Samuel%2017&version=KJV)

English is referenced as Cambridge First Language English and French as Foreign Language; verify those variants against the school’s course.

Online matches support 1v1, 2v2, and 1v2 formats, with turn-based or simultaneous questions. Choose a subject and optionally focus on a populated chapter; chapter choices carry through multiplayer invitations. Danthecanman is the subject level-up rival. Every fifth NPC level is a named subject boss: Stalin in Biology, Physics, and Business Studies; Joshua in Hindi and Mathematics; Prannoy in Chemistry, English, and French; Solomon in ICT/Computers; and Noah in Scripture. Prannoy is supportive with a little pride, Stalin uses tough teasing, Joshua boasts about himself, and Solomon adds silly sound effects to strong hits. English, Mathematics, and Business Studies are practice-only. Dialogue bubbles appear beside the relevant bot or rival. In 2v2, the inviter's first selected player is their teammate; in 1v2, the inviter faces both selected players. Simultaneous matches show both players the same question; the first correct answer resolves it. The lobby keeps active players visible and labels them as in a match or with an invite pending.

Every battle question has a 20-second server-enforced timer; Solo Practice questions are untimed. Online multiplayer question and answer text is drawn to non-selectable canvases; copy or switching tabs submits a wrong answer. Battle questions are randomly chosen from the selected subject and chapter without adjusting the pool for player level. A correct answer deals 15 base damage, modified by the attacker's Attack and the defender's Defence, and restores 3 HP. Hard questions deal 50% extra damage to whichever player answers correctly; the same rule applies to either side. Answer correctly within the first 2 seconds after a question appears to deal double damage (the bonuses combine). Each subject level adds 1 Attack and every two levels add 1 Defence. A wrong answer or timeout costs 14 HP. Online turn-based matches randomly choose which team takes the first turn. Player-versus-player duels are blocked when opposing players differ by more than 10 levels in the chosen subject; gaps of 5–10 levels warn players and switch to boss music. Each subject has its own roster: bots up to 10 levels above you are available, and bots 10 or more levels below you are hidden. Level 50 unlocks parrying: a fast correct answer reflects the previous hit, but a hard question shatters the barrier. The match ends when every player on a team reaches 0 HP.

Players earn XP from practice and completed matches: a correct Solo Practice answer awards 1 lifetime XP once; battle-enabled subjects also gain subject progression. Practice-only English, Mathematics, and Business Studies do not advance battle-level progression. NPC wins award 80 XP plus 10 XP for each NPC level above level 1 (for example, 170 XP for defeating a level 10 NPC), and an NPC loss awards 30 XP. Online wins award 100 XP, online losses 45 XP, and draws 30 XP, all toward the selected subject. Every battle-enabled subject level requires 100 more XP than the previous level, up to level 100; Danthecanman must be beaten to claim each level-up. Player levels, subject XP, match records, account credentials, profile icons, and solo focus time are saved automatically. Passwords are stored as salted hashes. Danthecanman and Redsto_1 have exclusive operator character icons. Current HP and active battles reset when the server restarts.

Browser-local saves can be moved to the server from the sign-in screen: enter the local username and password, choose **Export browser save**, then choose **Import browser save** on the server and select the downloaded JSON file. After signing in, you can export either a browser-local or server account from **Settings → Account → Export save** by re-entering your current password. The file contains player progress but no password hash; the password for the account creates a new server account. If the username already exists on the server, enter that account's server password when prompted; the server keeps its password and merges progress conservatively by retaining higher XP, level, and match totals. The export can fall back to the sign-in endpoint on servers that have not yet deployed the dedicated export route. Browser storage is isolated by site origin, so this file transfer is needed when moving a save from a different site or browser.

On opening the app, a homework check-in asks whether homework is finished. Confirming with **Yes, finished** earns 2 XP once per UTC day and displays the KJV verse of the day. Choosing **No, not yet** opens the Pomodoro and keeps navigation locked until **Finished** is pressed; completing that check-in also earns the XP and displays the verse. The pending check-in is remembered in the browser.

## Run locally

Requires Node.js 18 or newer. No packages are needed.

```sh
node server.js
```

Open [http://localhost:3000](http://localhost:3000). For online duels and study chat, players must connect to the same reachable server. Study presence expires after 45 seconds without activity. Study chat retains only the latest 50 messages in memory, filters common profanity and obfuscated abusive terms, and flags a small set of obvious off-topic keywords; these are basic filters, not comprehensive content moderation.

Server accounts are written atomically to `data/players.json` by default. Render deployments automatically use `/var/data/players.json`; in the Render Dashboard, attach a persistent disk to the web service with the mount path `/var/data` (Render persistent disks require a paid service plan). If the disk is mounted somewhere else, set `PLAYER_DATA_FILE` to a file under that mount. Render filesystems are otherwise ephemeral, so deploying this code alone does not preserve accounts unless the disk is attached. For other hosts, set `PLAYER_DATA_FILE` to a file on their persistent volume. Back up persistent data regularly. Without persistent storage, no app-level file save can guarantee recovery after the host deletes its filesystem.

Lo-fi-style audio, including its steady drum beat, and optional cinematic action-adventure lobby music with distorted, layered electric guitars are generated locally by the browser and do not stream music. The boss mix now drives at 164 BPM (180 BPM at critical health) with octave guitars, a new lead line, heavier bass, double-kick drums, and bigger cymbal crashes. Winning a boss NPC battle plays a dedicated victory fanfare; other wins retain the standard victory cue. **Settings → Personalise** has separate, saved volume sliders for lobby/Pomodoro music and battle/practice sound effects. Lobby music can be enabled there and is automatically stopped in battles and Pomodoro. Battle and practice sounds require a user gesture and can be disabled with the Sound toggle; battles include turn-start and final-five-seconds cues. The ambient loop can be stopped from the Pomodoro controls. The **Update log** in the top bar summarizes recent app changes. Audio/video calls are not implemented: they need WebRTC signaling and TURN infrastructure, which this standalone server does not include.

## Update log

### 22 November 2026 — Boss roster and operator icons

- Made Danthecanman the subject level-up rival instead of a boss character.
- Set named subject bosses to appear every fifth level: Stalin for Biology, Physics, and Business Studies; Joshua for Hindi and Mathematics; Prannoy for Chemistry, English, and French; and Solomon for ICT/Computers.
- Made English, Mathematics, and Business Studies practice-only modes.
- Added battle dialogue beside the named rival or bot portrait, plus unique-symbol operator icons for Danthecanman and Redsto_1.
- Kept Solo Practice untimed and made online multiplayer question/answer text non-selectable; copying or switching tabs forfeits the turn.
- Practice answers in those practice-only subjects award lifetime XP without triggering an unavailable battle level-up.

### 16 November 2026 — StudySprint: progress, rivals, and chat

- Added leaderboards for lifetime XP and solo focus time, tracked during Pomodoro focus blocks.
- Added saved character icons, with temporary glyph choices until the provided PNG artwork is ready.
- Renamed all subject rivals Danny and added subject-specific, competitive-but-respectful dialogue.
- Improved chat filtering to catch profanity and hateful terms written with punctuation, spacing, repeated characters, number substitutions, and common lookalike letters.
- Defaulted Render account saves to `/var/data/players.json` and documented the required persistent-disk mount.

### 1 November 2026 — Accounts and settings

- Added username and password sign-in so players can recover saved profiles after being logged out.
- Prompted existing players to secure their saved progress with a password, and added account editing under Settings.
- Moved Personalise into the Settings gear menu and kept usernames unique.
- Expanded progression to level 100 and unlocks a new arena opponent each level, with an unlock sound; players must beat level-matched Stalin before each level-up.
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

The app is suitable for small groups on one Node.js instance. Player activity, battles, challenges, and study chat are held in memory; player progression is written to `data/players.json` locally and `/var/data/players.json` on Render by default. Running the process on an always-on host can make the site available 24/7, but availability, backups, and persistent disk must be configured by the host. Multi-instance scaling requires shared storage and a real-time coordination service; those are not included.

## Tests

```sh
node --test server.test.js local-game.test.js
```

Battle question banks include easy, intermediate, and hard variants selected randomly across the chosen subject and populated chapter, regardless of participant level. Chapter choices are built from populated questions and validated by the server. Solo Practice provides 100 or more generated question variants for each syllabus subject, checks answers and awards XP on the server or locally in static mode, and shows curriculum references in the practice view. Questions are original practice material.
