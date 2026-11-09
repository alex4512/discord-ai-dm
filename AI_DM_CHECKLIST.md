# Discord AI Dungeon Master — Project Checklist

**Owner:** Alexis Argyrakopoulos  
**Repository:** https://github.com/alex4512/discord-ai-dm  
**Stack:** Node.js · Discord.js · OpenAI Responses API · PostgreSQL · D&D 5e (2014 RAW)  
**Campaign:** Dunmere / Northern Marches · Kraavok & Looming Shade  
**Status (2026-11-09):** Two players live in one shared campaign. Memory with save/undo/rollback, per-character knowledge, the NPC/location/chronicle world with NPC memory, XP and levels, monster dice, scene images and scene maps all work. **Next:** player onboarding, then hardening (see *Next Steps*).

> **Status key:** `[x]` implemented or observed working · `[ ]` pending · `⚠️` partially implemented / needs validation.
>
> This checklist reflects the implementation and manual tests discussed so far. A successful manual test does not replace automated coverage.

## 1. Discord & Core Infrastructure

- [x] Discord server and DM bot configured
- [x] Main adventure channel
- [x] Kraavok private channel
- [x] Looming Shade private channel
- [x] DM testing channel
- [x] **Mention-based DM activation** (`@Dungeon Master`) — intentional design choice
- [x] Players can converse normally without triggering the DM
- [x] Discord user-to-character mapping
- [x] Bot-level private-channel authorization
- [x] Node.js / Discord.js / OpenAI Responses API integration
- [x] PostgreSQL persistence
- [ ] Always-on deployment / process supervision

**Explicitly out of scope for now:** Native Discord slash commands. Mention-based activation is preferred so players can talk in the same channel without invoking the bot.

## 2. Campaign Memory, Checkpoints & Rollback

- [x] Shared campaign state in PostgreSQL
- [x] Structured JSON checkpoint draft generation
- [x] Saves go live directly, in the background, while play continues; `/checkpoint undo` redoes a bad summary without losing play (D-011; replaced draft/confirm/cancel)
- [x] Checkpoint version history and inspection
- [x] Rollback to an earlier checkpoint
- [x] New timeline UUID after rollback
- [x] Preserve archived messages rather than deleting them
- [x] Filter history by active timeline
- [x] Checkpoint history boundary for `#main-adventure`
- [x] Initial pre-meeting Dunmere checkpoint saved
- [x] Manual rollback test restored the initial checkpoint content
- [x] Manual character-knowledge check: Kraavok does not know Looming Shade after rollback
- [x] Safe checkpoint boundaries for both private histories — one `boundary_seq` for all channels, in checkpoints and DM replies (D-004)
- [x] Checkpoint generation accounts for events from all three channels — shared from main; private events go to character knowledge and DM notes (D-001)
- ⚠️ Full rollback test with distinct events in main and both private channels — passed 2026-11-09 for main + Kraavok private (see manual test below); Looming private pending
- ⚠️ Robust transactional consistency across multiple bot instances — `messages.seq` high-water marks and advisory locks; the busy guard is still in-process only
- [ ] Explicit checkpoint editing workflow (beyond undo + save again)

**Known limitation:** DM-authored NPC `author_notes` reach the prompts of channels whose characters know that NPC (spoiler risk only, D-007 revision). Everything learned in play is filtered per audience in code (D-004, D-007).

## 3. Multiplayer Synchronization & Character Knowledge

- [x] Two independently registered characters in one campaign
- [x] Separate per-channel conversation histories
- [x] Define a durable shared-world state versus per-character knowledge model (D-001)
- [x] Persist discoveries, secrets, and observations per character (`character_knowledge`)
- [x] Allow the DM to account for events in both private channels — `dm_notes` in every DM prompt, secrets filtered per audience (D-004)
- [x] Prevent private knowledge from leaking into another player's narration — character knowledge and every DM-notes entry filtered by `known_by` in code (D-004 revision); NPC registry secrets still prompt-based
- [x] Synchronize world-changing private events with shared campaign state — unattributed `observable_world_state` reaches every channel (D-006)
- [x] Transfer knowledge between characters only through appropriate in-game events — in-character speech in `#main-adventure` is narrated and becomes shared (DM rule 16)
- [x] Private channels see `#main-adventure` play since the last save, so a meeting is known before anyone saves (D-010)
- [x] Other characters' class and level hidden outside `#dm-testing` (D-010)
- [x] The checkpoint scene decides who is present (DM rule 17); DM-authored scene setups via `amendActiveSnapshot`
- [x] Make checkpoint previews / `show` safe for shared-channel visibility (D-002)
- [x] Looming Shade's first private session: own knowledge record created, nothing leaked to Kraavok or main (live, 2026-11-09)
- ⚠️ Test: Looming discovers a clue that Kraavok does not know — not yet checked explicitly
- ⚠️ Test: Kraavok and Looming meet and exchange selected information — they met at the eastern watchtower and Kraavok told his story in character (live, 2026-11-09); check the shared record after the next save
- [ ] Test: rollback preserves knowledge separation across channels

**Design goal:** One consistent world, two distinct player perspectives.

## 4. D&D Rules, Character Sheets & Avrae

- [x] D&D 5e (2014 RAW) specified in the DM instructions
- [x] Player agency: DM does not decide PC actions or dialogue
- [x] DM instructed not to invent dice results; monster dice come from code (D-013)
- ~~Import and persist full character sheets~~ Not planned: XP only (user decision 2026-11-09); more only on request
- ~~Track HP, hit dice, exhaustion~~ On request only
- ~~Track Rage, spell slots, resources~~ On request only
- ~~Track inventory and currency~~ On request only
- [x] XP for non-combat challenges and story milestones, rated easy–deadly and priced per level from the DMG thresholds; never for a single check on its own (D-015)
- [x] XP and level kept by the bot: the DM tags resolved encounters, code computes XP from the CR table, records it in a ledger folded into each save; rollback/undo-safe; level-ups announced privately; `/xp`, `/xp set` (D-012, D-014)
- [x] Level progression from XP (D-014); conditions and rests on request only
- [x] Monster and NPC dice rolled by the bot: the DM calls a `roll_dice` tool, code rolls with a crypto RNG, every roll is shown above the narration (D-013). Players roll their own however they like (Avrae optional).
- [x] ~~Parse Avrae roll results automatically~~ Dropped (user decision): players roll in Avrae and tell the DM the result; that keeps their intent and avoids noise
- [ ] Validate mechanical outcomes against character stats and rules
- [ ] Optional character-sheet export

**Current state:** Avrae is used separately for dice; players type results to the DM. Character facts appear in prompts and checkpoints, but there is no authoritative mechanics ledger yet.

**Avrae constraints (to verify before building):**
- Avrae has no API another bot can read sheets from, as far as we know. Sheets come from what Avrae posts (e.g. `!sheet`) or from the same source the player imports into Avrae.
- Integration is one-way. Bots cannot command Avrae (it ignores bots), so the DM can only *ask* a player to run e.g. `!game hp -7`. After a rollback, Avrae is re-synced by hand.
- Reading roll results means parsing Avrae's embed messages in our channels. That needs the right channel permissions, and our handler currently ignores messages from bots.

## 5. Persistent World & NPCs

- [x] NPC registry as a versioned checkpoint partition (D-007, migration 0004)
- [x] DM reads NPCs filtered per audience; `/npc list`, `/npc show`, `/npc note`
- [x] Populate known Dunmere NPCs: import script with gitignored local seed (`data/*.local.json`)
- [x] Track NPC locations, statuses and facts with `known_by`; motivations as DM author notes
- [x] Protect NPC secrets and DM-only knowledge from player-facing output — author notes never in player output; still in DM prompts (D-007 trade-off)
- [x] Persist NPC state changes after significant events — NPC update call at each save
- [x] Maintain location and world-event records — locations registry + append-only chronicle (D-009)
- [x] Track unresolved mysteries, objectives, and consequences — shared checkpoint (`objectives`, `pending_decisions`, `unresolved_mysteries`), DM notes (`open_threads`, `world_truth`, `observable_world_state`), character knowledge (`private_objectives`)
- [x] NPC own memory: NPCs remember their dealings with each character and raise them in-world; secret ones only in private (D-016)
- [x] Validate continuity between main and private scenes — DM notes `continuity_warnings` checked against chronicle and registries; review in `#dm-testing` drafts

## 6. Reliability, Security & Operations

- [x] Basic API/Discord error handling
- [x] Per-guild in-process concurrency guard
- [x] Database migrations and `dnd_bot` permissions applied — tracked in `migrations/`, `npm run migrate`
- [ ] OpenAI token usage and cost tracking (`api_usage` table exists)
- [x] Prompt size kept bounded: saves compact records to size budgets; DM replies get only the NPCs and places of the current scene (D-017)
- [x] Checkpoint save output cap raised to 12000 tokens (`CHECKPOINT_MAX_OUTPUT_TOKENS`); a truncated response gives a clear error and saves nothing
- [x] Short `/checkpoint save` replies in the game channel ("Saving…", then "Saved as vN")
- [x] Scene images: on first arrival + `/image`, per-server daily cap, every generation logged (D-008)
- [x] Scene maps: `/map` (drawn PNG) and `/map text` (grid); positions as data from one model call, drawn by code (D-018)
- ⚠️ Maps stored in the channel's history; DM and the next `/map` build on them (D-019) — **to be validated in user testing**
- [ ] Graceful restart: drain in-flight replies/saves before exit, `/restart`, catch-up of mentions missed while down (proposed 2026-11-09; deferred by the user as a luxury)
- [ ] API rate limits and spending safeguards
- [ ] PostgreSQL backup schedule and restore drill
- [ ] Structured logging and operational diagnostics
- [x] Checkpoint/rollback authorization and approval policy — every registered player may save, undo and roll back (D-005, D-011)
- [ ] Automated tests for save, undo, versions, and rollback
- [ ] Integration tests for private-channel isolation and knowledge leaks
- ⚠️ Graceful shutdown, reconnect behavior, and recovery tests — graceful shutdown done; recovery procedures in `docs/OPERATIONS.md`
- [ ] Concurrency testing around drafts and incoming messages
- [ ] **Multiple bot instances (idea, not urgent; noted 2026-11-09).** Today the bot assumes **one** running instance:
  - **Duplicate handling.** Two instances logged in with the same token both receive every Discord message, so both would answer.
  - **In-process locks.** The request lock, the save lock and the image lock (`busyGuilds`, `savingGuilds`, `paintingGuilds`) live in process memory, so they don't protect across instances.
  - **Message ordering.** `messages.seq` is assigned when a row is inserted, not in Discord's order. With concurrent writers, a slower turn can get a later seq than a newer message, and turns could interleave on the same campaign state.
  - **Possible approaches:** one active instance via a Postgres advisory-lock leader (others on standby); per-guild locks in Postgres instead of memory; a per-guild work queue in the database; ordering by Discord snowflake (creation time) as a tie-breaker.
  - **Until then:** run exactly one instance.

## 7. Player Onboarding — NEW

Goal: a new player joins without code or `.env` changes and without SQL. Agreed plan in D-020; step 1 done, step 2 waits for an actual new player.

Adding a player today (after step 1): a SQL row in `campaign_players` with `private_channel_id`, the Discord channel and its permissions by hand, a restart, and the character's backstory and story entry by hand (as for Looming, scene amendments v12–v14).

- [x] Step 1: players and private channels stored in the database, not `.env`; access checks, audiences, saves and XP read the roster from there (D-020, migration 0008)
- [x] Step 1: hard-coded character names removed from logic (`REQUIRED_CHARACTERS`, DM rules, legacy-checkpoint naming). Names left only as examples in prompts and help text
- [ ] Step 2 (planned, D-020): `/player add @user "Name" Class Level [#channel]` in `#dm-testing`. Creates the private channel by default (needs *Manage Channels* and *Manage Roles*), or uses an existing one; sets starting XP; no restart
- [ ] Guided introduction in the new private channel: backstory, appearance and goals, seeding the first knowledge record.
- [ ] Bring the character into the story: the DM proposes how they arrive in the shared scene, and the admin confirms it as a scene amendment.
- [ ] Optional character-sheet import at registration (ties into Milestone 3).
- [ ] `/player retire` (character leaves the campaign; history and knowledge kept).
- [ ] Player guide in English and Greek (generalised from `docs/SESSION_GUIDE_GR.md`).

## Delivery Roadmap

### Milestone 1 — Reliable Campaign Memory

- [x] Shared checkpoint persistence and versioning
- [x] Main-channel history boundary
- [x] Initial Dunmere checkpoint
- [x] Basic rollback and timeline isolation verified manually
- [ ] Extended rollback test across private channels

### Milestone 2 — Multiplayer Knowledge & Synchronization

- [x] Design per-character knowledge storage
- [x] Incorporate private-channel events into DM world awareness (D-004, D-006)
- [x] Build spoiler-safe prompt and checkpoint views (D-002, D-004)
- [x] Implement safe private-history checkpoint boundaries
- ⚠️ Run end-to-end secrecy and information-sharing tests — secrecy passed in Discord for Kraavok (token, Orren, Voss, rollback); Looming's first private session passed live; in-game sharing in progress (meeting played; check after the next save)

### Milestone 3 — Character State & Dice

- [x] Character progress: XP and level kept by the bot, versioned with the story (D-014, D-015). Full sheets (HP, resources, items) are not planned; on request only
- [x] Dice: players roll however they like and report it (Avrae optional); monster and NPC dice rolled by the bot (D-013)
- ~~Avrae roll/result integration~~ Dropped (user decision)
- ~~Rules and resource validation~~ Not planned without full sheets

### Milestone 4 — Persistent World

- [x] Populate and maintain NPC registry (D-007)
- [x] World-state updates, locations, and consequences (D-006, D-009)
- ⚠️ Cross-scene consistency tests — mocked end-to-end test passes; live two-player check pending (Looming live test, step 4)

### Milestone 5 — Production Hardening

- [ ] Backups and restore verification
- [ ] Cost controls, logging, and monitoring
- [ ] Authorization, concurrency safety, and automated tests
- [ ] Always-on hosting
- [ ] Graceful restart (drain in-flight work, `/restart`, catch-up of missed mentions)
- [ ] Safe multi-instance operation, including message ordering

### Milestone 6 — Player Onboarding

- [x] Database-driven roster and private channels; no hard-coded characters (D-020 step 1)
- [ ] `/player add` with channel creation, guided introduction and story entry
- [ ] Player guides (English, Greek)

## Next Steps

Done on 2026-11-09:
- direct background saves with undo (D-011)
- XP and levels kept by the bot, including challenges and milestones (D-012, D-014, D-015)
- monster dice rolled by the bot (D-013)
- NPC memory (D-016)
- bounded prompt size (D-017)
- scene maps (D-018)

Decided against: Avrae roll reading (players report rolls in any words, Avrae optional) and full character sheets (XP only).

In order, each agreed as a design before building:

1. **Player onboarding** (Milestone 6). Add a player without config, SQL or hand-written scene setups.
2. **Hardening** (Milestone 5). Always-on hosting, scheduled backups, cost tracking, automated tests, graceful restart. Later: safe multi-instance operation, including message ordering (section 6).

Smaller open items:
- verify in live play that the watchtower meeting reached the shared record
- the Looming-only clue test
- watch NPC memories and compaction in live play after the next saves
- validate stored maps in play (D-019, *What to look for*)
- a LICENSE choice

---

## Manual Regression Test: Checkpoint Rollback

1. In `#main-adventure`, mention the DM and run `/checkpoint save`.
2. Wait for "Saved as vN"; review with `/checkpoint show` in `#dm-testing` (`/checkpoint undo` if the summary is wrong).
3. Use `/checkpoint show` and `/checkpoint versions` to verify persistence.
4. Advance the story with a clearly identifiable event, then save another checkpoint.
5. Run `/checkpoint rollback <target-version>`.
6. Verify that the active version increases, the timeline UUID changes, and the checkpoint content matches the target version.
7. Ask the DM about the abandoned event. It should not be treated as active canon.
8. Repeat with distinct private-channel discoveries once Milestone 2 is implemented.

## Manual Regression Test: Private Knowledge & Rollback

Last passed: **2026-11-09**, twice:
- checkpoint views: v2 → save v3 → rollback to v2 as v4 (steps 1–11);
- DM replies (D-004 revision): v6 → save v7, with the boot question asked in all channels (steps 12–14).

The first run of steps 12–14 **failed**: the token leaked into `#main-adventure` through untagged DM notes. Fixed in the D-004 revision, recovered by rollback (see `docs/OPERATIONS.md`).

| # | Channel | Send | Pass if |
| --- | --- | --- | --- |
| 1 | `#dm-testing` | `/checkpoint show` | Active version shown; all parts visible |
| 2 | `#kraavok-private` | A private discovery, e.g. *finds a carved bone token, hides it in his boot* | DM narrates it |
| 3 | `#main-adventure` | Any in-character question | Reply never mentions the private discovery |
| 4 | `#main-adventure` | `/checkpoint save` | "Saved as vN. Knowledge updated for: Kraavok" |
| 5 | `#dm-testing` | `/checkpoint show` | Shared + Kraavok knowledge (discovery present) + DM notes (discovery as secret, `known_by: Kraavok`) |
| 6 | `#kraavok-private` | `/checkpoint show` | Shared + own knowledge; **no DM notes** section |
| 7 | `#main-adventure` | — | (no confirm step since D-011) |
| 8 | `#main-adventure` | `/checkpoint show` | Boundary `message #N`; discovery absent |
| 9 | `#main-adventure` | `/checkpoint rollback <previous>` | New version + new timeline; all parts restored |
| 10 | `#kraavok-private` | `/checkpoint show` | Own knowledge back to the restored version's (e.g. nothing recorded yet) |
| 11 | `#dm-testing` | `/checkpoint versions` | Append-only history shows save + rollback |
| 12 | `#kraavok-private` | After a save containing the discovery: *(OOC) What is hidden in Kraavok's boot, and what does he remember about Mother Vael?* | Knows both (from the knowledge record, not raw history) |
| 13 | `#main-adventure` | *(OOC) What is hidden in Kraavok's boot?* | **Does not know.** Any mention is a leak: roll back immediately |
| 14 | `#dm-testing` | *What is hidden in Kraavok's boot?* | Knows |

All commands are sent as `@Dungeon Master <text>`.

## Live Test: Looming Shade's First Private Session (in production)

Step-by-step session guide for George and the admin, in Greek: `docs/SESSION_GUIDE_GR.md`.

Looming Shade's first private play happens in the real campaign. The DM
(`#dm-testing`) checks each step afterwards. Nothing extra is needed from the
players beyond normal play and one save. If any check fails, follow
*Private information leaked* in `docs/OPERATIONS.md` (roll back to the last
good version).

| # | Who / channel | Action | Check (in `#dm-testing`) |
|---|---|---|---|
| 1 | Looming, `#looming-private` | Plays normally, including at least one private discovery and, ideally, a visible change somewhere (a forced lock, a moved object) | — |
| 2 | Anyone, `#main-adventure` | `/checkpoint save` | `/checkpoint show` (in `#dm-testing`): the shared part has **no** trace of Looming's discovery |
| 3 | DM, `#dm-testing` | `/checkpoint show` | `Looming Shade: private knowledge` exists (first record, D-003); discovery entries are `known_by: ["Looming Shade"]`; any visible change is in `observable_world_state` **without names** |
| 4 | Kraavok, `#kraavok-private` | Asks about the place Looming changed, if he goes there | The DM describes the change, **not** who did it, and nothing of Looming's discovery |
| 5 | Kraavok, `#main-adventure` | Plays normally | No trace of Looming's discovery |
| 6 | Later, when they meet and Looming **tells** Kraavok in `#main-adventure`, then save | `#dm-testing` `/checkpoint show` | The told fact is now in the shared world, and its DM-notes entries list both characters |

**Command convention:** Send `@Dungeon Master /checkpoint ...` as an ordinary Discord message. Native slash commands are deliberately not enabled.
