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
- [ ] Safe checkpoint boundaries for both private histories
- [ ] Shared checkpoint generation that accounts for relevant events from all three channels
- [ ] Full rollback test with distinct events in main and both private channels
- [ ] Robust transactional consistency across multiple bot instances
- [ ] Explicit checkpoint editing workflow (beyond regenerate / cancel / confirm)

**Known limitation:** Private channels currently retain active-timeline history without applying the shared checkpoint boundary. The shared checkpoint draft generator reads main-adventure history, not both private histories.

## 3. Multiplayer Synchronization & Character Knowledge — NEXT PRIORITY

- [x] Two independently registered characters in one campaign
- [x] Separate per-channel conversation histories
- [ ] Define a durable shared-world state versus per-character knowledge model
- [ ] Persist discoveries, secrets, and observations per character
- [ ] Allow the DM to account for events in both private channels
- [ ] Prevent private knowledge from leaking into another player's narration
- [ ] Synchronize world-changing private events with shared campaign state
- [ ] Transfer knowledge between characters only through appropriate in-game events
- [ ] Make checkpoint previews / `show` safe for shared-channel visibility
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

- [x] PostgreSQL NPC registry schema
- [x] DM can read NPC registry records
- [ ] Populate known Dunmere NPCs (Voss, Brann, Derren, Mara, Orren, Varek, Mother Vael, etc.)
- [ ] Track NPC locations, relationships, motivations, and statuses
- [ ] Protect NPC secrets and DM-only knowledge from player-facing output
- [ ] Persist NPC state changes after significant events
- [ ] Maintain location and world-event records
- [ ] Track unresolved mysteries, objectives, and consequences
- [ ] Validate continuity between main and private scenes

## 6. Reliability, Security & Operations

- [x] Basic API/Discord error handling
- [x] Per-guild in-process concurrency guard
- [x] Database migrations and `dnd_bot` permissions applied
- [ ] OpenAI token usage and cost tracking (`api_usage` table exists)
- [ ] API rate limits and spending safeguards
- [ ] PostgreSQL backup schedule and restore drill
- [ ] Structured logging and operational diagnostics
- [ ] Checkpoint/rollback authorization and approval policy
- [ ] Automated tests for draft, confirm, versions, and rollback
- [ ] Integration tests for private-channel isolation and knowledge leaks
- [ ] Graceful shutdown, reconnect behavior, and recovery tests
- [ ] Concurrency testing around drafts and incoming messages

## Delivery Roadmap

### Milestone 1 — Reliable Campaign Memory

- [x] Shared checkpoint persistence and versioning
- [x] Main-channel history boundary
- [x] Initial Dunmere checkpoint
- [x] Basic rollback and timeline isolation verified manually
- [ ] Extended rollback test across private channels

### Milestone 2 — Multiplayer Knowledge & Synchronization **(next)**

- [ ] Design per-character knowledge storage
- [ ] Incorporate private-channel events into DM world awareness
- [ ] Build spoiler-safe prompt and checkpoint views
- [ ] Implement safe private-history checkpoint boundaries
- [ ] Run end-to-end secrecy and information-sharing tests

### Milestone 3 — Character State & Avrae

- [ ] Authoritative character sheets and resource persistence
- [ ] Avrae roll/result integration
- [ ] Rules and resource validation

### Milestone 4 — Persistent World

- [ ] Populate and maintain NPC registry
- [ ] World-state updates, locations, and consequences
- [ ] Cross-scene consistency tests

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

**Command convention:** Send `@Dungeon Master /checkpoint ...` as an ordinary Discord message. Native slash commands are deliberately not enabled.
