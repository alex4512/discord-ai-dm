# Discord AI Dungeon Master — Project Checklist

**Repository:** https://github.com/alex4512/discord-ai-dm  
**Stack:** Node.js · Discord.js · OpenAI Responses API · PostgreSQL · D&D 5e (2014 RAW)  
**Campaign:** Dunmere / Northern Marches · Kraavok & Looming Shade  
**Status:** Working MVP; multiplayer knowledge synchronization is the next priority.

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
- [x] Draft review before confirmation
- [x] Checkpoint save / confirm / cancel commands
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
- [ ] Explicit checkpoint editing workflow (beyond regenerate / cancel / confirm)

**Known limitation:** DM-authored NPC `author_notes` reach the prompts of channels whose characters know that NPC (spoiler risk only, D-007 revision). Everything learned in play is filtered per audience in code (D-004, D-007).

## 3. Multiplayer Synchronization & Character Knowledge — NEXT PRIORITY

- [x] Two independently registered characters in one campaign
- [x] Separate per-channel conversation histories
- [x] Define a durable shared-world state versus per-character knowledge model (D-001)
- [x] Persist discoveries, secrets, and observations per character (`character_knowledge`)
- [x] Allow the DM to account for events in both private channels — `dm_notes` in every DM prompt, secrets filtered per audience (D-004)
- [x] Prevent private knowledge from leaking into another player's narration — character knowledge and every DM-notes entry filtered by `known_by` in code (D-004 revision); NPC registry secrets still prompt-based
- [x] Synchronize world-changing private events with shared campaign state — unattributed `observable_world_state` reaches every channel (D-006)
- [ ] Transfer knowledge between characters only through appropriate in-game events
- [x] Make checkpoint previews / `show` safe for shared-channel visibility (D-002)
- [ ] Test: Looming discovers a clue that Kraavok does not know
- [ ] Test: Kraavok and Looming meet and exchange selected information
- [ ] Test: rollback preserves knowledge separation across channels

**Design goal:** One consistent world, two distinct player perspectives.

## 4. D&D Rules, Character Sheets & Avrae

- [x] D&D 5e (2014 RAW) specified in the DM instructions
- [x] Player agency: DM does not decide PC actions or dialogue
- [x] DM instructed not to invent dice results
- [ ] Import and persist authoritative character sheets for both PCs
- [ ] Track current/max HP, temporary HP, hit dice, and exhaustion
- [ ] Track Rage, spell slots, class features, and limited-use resources
- [ ] Track inventory, equipment, consumables, and currency
- [ ] Track conditions, rests, and level progression
- [ ] Parse or associate Avrae roll results with the correct actions
- [ ] Validate mechanical outcomes against character stats and rules
- [ ] Optional character-sheet export

**Current state:** Avrae is used separately for dice, and character facts appear in prompts/checkpoints, but there is no authoritative automated mechanics ledger yet.

## 5. Persistent World & NPCs

- [x] NPC registry as a versioned checkpoint partition (D-007, migration 0004)
- [x] DM reads NPCs filtered per audience; `/npc list`, `/npc show`, `/npc note`
- [x] Populate known Dunmere NPCs: import script with gitignored local seed (`data/*.local.json`)
- [x] Track NPC locations, statuses and facts with `known_by`; motivations as DM author notes
- [x] Protect NPC secrets and DM-only knowledge from player-facing output — author notes never in player output; still in DM prompts (D-007 trade-off)
- [x] Persist NPC state changes after significant events — NPC update call at each save
- [x] Maintain location and world-event records — locations registry + append-only chronicle (D-009)
- [x] Track unresolved mysteries, objectives, and consequences — shared checkpoint (`objectives`, `pending_decisions`, `unresolved_mysteries`), DM notes (`open_threads`, `world_truth`, `observable_world_state`), character knowledge (`private_objectives`)
- [ ] NPC own memory, so NPCs can raise past events with a character in shared scenes (D-007 option C, deferred)
- [x] Validate continuity between main and private scenes — DM notes `continuity_warnings` checked against chronicle and registries; review in `#dm-testing` drafts

## 6. Reliability, Security & Operations

- [x] Basic API/Discord error handling
- [x] Per-guild in-process concurrency guard
- [x] Database migrations and `dnd_bot` permissions applied — tracked in `migrations/`, `npm run migrate`
- [ ] OpenAI token usage and cost tracking (`api_usage` table exists)
- [x] Scene images: on first arrival + `/image`, per-server daily cap, every generation logged (D-008)
- [ ] API rate limits and spending safeguards
- [ ] PostgreSQL backup schedule and restore drill
- [ ] Structured logging and operational diagnostics
- [x] Checkpoint/rollback authorization and approval policy — every registered player may save/rollback; only the creator confirms a draft (D-005)
- [ ] Automated tests for draft, confirm, versions, and rollback
- [ ] Integration tests for private-channel isolation and knowledge leaks
- ⚠️ Graceful shutdown, reconnect behavior, and recovery tests — graceful shutdown done; recovery procedures in `docs/OPERATIONS.md`
- [ ] Concurrency testing around drafts and incoming messages

## Delivery Roadmap

### Milestone 1 — Reliable Campaign Memory

- [x] Shared checkpoint persistence and versioning
- [x] Main-channel history boundary
- [x] Initial Dunmere checkpoint
- [x] Basic rollback and timeline isolation verified manually
- [ ] Extended rollback test across private channels

### Milestone 2 — Multiplayer Knowledge & Synchronization **(next)**

- [x] Design per-character knowledge storage
- [x] Incorporate private-channel events into DM world awareness (D-004, D-006)
- [x] Build spoiler-safe prompt and checkpoint views (D-002, D-004)
- [x] Implement safe private-history checkpoint boundaries
- ⚠️ Run end-to-end secrecy and information-sharing tests — secrecy passed in Discord for Kraavok (token, Orren, Voss, rollback); Looming's side and in-game sharing pending the live test

### Milestone 3 — Character State & Avrae

- [ ] Authoritative character sheets and resource persistence
- [ ] Avrae roll/result integration
- [ ] Rules and resource validation

### Milestone 4 — Persistent World

- [x] Populate and maintain NPC registry (D-007)
- [x] World-state updates, locations, and consequences (D-006, D-009)
- ⚠️ Cross-scene consistency tests — mocked end-to-end test passes; live two-player check pending (Looming live test, step 4)

### Milestone 5 — Production Hardening

- [ ] Backups and restore verification
- [ ] Cost controls, logging, and monitoring
- [ ] Authorization, concurrency safety, and automated tests
- [ ] Always-on hosting

---

## Manual Regression Test: Checkpoint Rollback

1. In `#main-adventure`, mention the DM and run `/checkpoint save`.
2. Review the draft carefully; run `/checkpoint confirm`.
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
| 4 | `#main-adventure` | `/checkpoint save` | Shared world only; **discovery absent**; "Character knowledge records generated: Kraavok" |
| 5 | `#dm-testing` | `/checkpoint draft` | Shared + Kraavok knowledge (discovery present) + DM notes (discovery as secret, `known_by: Kraavok`) |
| 6 | `#kraavok-private` | `/checkpoint draft` | Shared + own knowledge; **no DM notes** section |
| 7 | `#main-adventure` | `/checkpoint confirm` | New version confirmed |
| 8 | `#main-adventure` | `/checkpoint show` | Boundary `message #N`; discovery absent |
| 9 | `#main-adventure` | `/checkpoint rollback <previous>` | New version + new timeline; all parts restored |
| 10 | `#kraavok-private` | `/checkpoint show` | Own knowledge back to the restored version's (e.g. nothing recorded yet) |
| 11 | `#dm-testing` | `/checkpoint versions` | Append-only history shows save + rollback |
| 12 | `#kraavok-private` | After a confirmed save containing the discovery: *(OOC) What is hidden in Kraavok's boot, and what does he remember about Mother Vael?* | Knows both (from the knowledge record, not raw history) |
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
| 2 | Anyone, `#main-adventure` | `/checkpoint save`, review, `/checkpoint confirm` | Save output in main has **no** trace of Looming's discovery |
| 3 | DM, `#dm-testing` | `/checkpoint show` | `Looming Shade: private knowledge` exists (first record, D-003); discovery entries are `known_by: ["Looming Shade"]`; any visible change is in `observable_world_state` **without names** |
| 4 | Kraavok, `#kraavok-private` | Asks about the place Looming changed, if he goes there | The DM describes the change, **not** who did it, and nothing of Looming's discovery |
| 5 | Kraavok, `#main-adventure` | Plays normally | No trace of Looming's discovery |
| 6 | Later, when they meet and Looming **tells** Kraavok in `#main-adventure`, then save + confirm | `#dm-testing` `/checkpoint show` | The told fact is now in the shared world, and its DM-notes entries list both characters |

**Command convention:** Send `@Dungeon Master /checkpoint ...` as an ordinary Discord message. Native slash commands are deliberately not enabled.
