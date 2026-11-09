# Discord AI Dungeon Master

A Discord bot that runs a shared D&D 5e (2014 RAW) campaign using OpenAI.
Campaign memory lives in PostgreSQL. It uses versioned shared checkpoints
with timelines, so a rollback leaves the abandoned events stored but no
longer used as canon.

## Setup

1. Node.js 20+ and a PostgreSQL database.
2. `npm install`
3. `cp .env.example .env` and fill in the values.
4. `npm run migrate` to create or update the schema (see [Database](#database)).
5. `npm start` (or `npm run dev` for watch mode).

Upgrading a running campaign, backups and recovery are covered in
[docs/OPERATIONS.md](docs/OPERATIONS.md). Read it before every upgrade.

## Usage

Mention the bot (or the DM role) in an allowed channel. Only Discord
users registered in `campaign_players` get an answer. The bot handles
one request per server at a time; anyone who asks in the meantime is
told to retry.

- **#main-adventure**: the shared story. History before the checkpoint
  boundary is replaced by the checkpoint.
- **Private player channels**: only the owning player can talk to the DM there.
- **#dm-testing**: diagnostics only. Nothing is persisted and checkpoint
  commands are read-only.

### Checkpoint commands

A checkpoint has three parts, each shown only where its audience can
read it: the **shared world** (every channel), each character's **private
knowledge** (that character's private channel), and **DM notes**
(#dm-testing only). See [docs/DECISIONS.md](docs/DECISIONS.md).

| Command | Where | Effect |
| --- | --- | --- |
| `/checkpoint show` | all | Show the active checkpoint |
| `/checkpoint versions` | main, testing | List the last 20 versions |
| `/checkpoint save` | main | Summarize all channels since the last boundary into a new version, in the background (play continues; D-011) |
| `/checkpoint undo` | main | Undo the last save: previous summary restored, **all play kept** for the next save |
| `/checkpoint rollback <n>` | main | Go back in the story: restore version `n` (all parts, including NPCs) on a new timeline; later play is abandoned |

### World commands

NPCs, locations and the event chronicle are part of the checkpoint (D-007,
D-009). Each channel sees only what its characters know: an NPC or place
appears there once they've learned something about it.

| Command | Where | Effect |
| --- | --- | --- |
| `/npc list`, `/location list` | all | NPCs / places known in this channel |
| `/npc show <name>`, `/location show <name>` | all | One entry as this channel may see it (`#dm-testing`: everything) |
| `/npc note <name>: <text>`, `/location note <name>: <text>` | testing | Add DM-authored truth (creates the entry if new) as a new version |
| `/chronicle` | all | The last 20 events this channel may know |
| `/xp` | all | Your XP and level (`#dm-testing`: everyone) |
| `/xp <count> <creature> CR <cr>; ... \| <names>` | all | Award XP by hand, same syntax as the DM's tag |
| `/xp medium challenge: <what> \| <names>` | all | Award a non-combat challenge or milestone (easy, medium, hard, deadly) |
| `/xp set <character> <total>` | testing | Set a character's XP total |

**Experience (D-012, D-014, D-015).** XP is earned for overcoming
challenges: fights won, and non-combat obstacles (a trap disarmed, a
crucial negotiation, a puzzle) or major story milestones, rated easy to
deadly and priced per character level. A single ability check on its own
earns nothing. When it happens, the DM adds a hidden XP tag. The bot computes the award from the 2014 CR
table, splits it evenly, records it and posts e.g. "+75 each". Totals and
levels are kept by the bot, versioned with the story: a rollback removes
later XP, an undo keeps it. Totals show only in your private channel
(`/xp`) and `#dm-testing`; level-ups are announced in your private channel.

**Dice (D-013).** Players roll their own characters' dice however they like
(Avrae, physical dice, any app) and tell the DM in any words. The DM rolls for monsters and NPCs through a `roll_dice` tool. The
bot rolls real dice and shows each roll above the narration, e.g.
"🎲 Goblin 1 scimitar attack vs Kraavok: 1d20 [18] + 4 = **22**".

### Scene images

When the scene moves somewhere new for the first time, the DM posts one
establishing image in that channel. `@Dungeon Master /image [what to show]`
paints the current scene on request. Images are capped per server per day
(`IMAGE_DAILY_LIMIT`) and only use what that channel may see (D-008).

To import NPCs, locations and past events once, run
`node scripts/import-world.js data/<file>.local.json`.
Seed files hold canon and DM secrets, and the repo is public, so keep them in
`data/*.local.json` (gitignored).

## Project structure

```text
src/
├── index.js                  # Bootstrap: verify DB, start Discord client, shutdown
├── config.js                 # Env loading and validation (single source of config)
├── constants.js              # Static campaign constants
├── errors/
│   └── UserFacingError.js    # Expected errors whose message is shown to users
├── db/
│   ├── pool.js               # pg pool, guild-locked transactions, DB clock
│   ├── partitions.js         # The list of snapshot partitions (one place)
│   ├── migrator.js           # Applies migrations/*.sql, tracks schema_migrations
│   ├── schema.js             # Startup check: no pending migrations
│   └── repositories/         # One module per table group, SQL only
│       ├── stateRepository.js
│       ├── checkpointRepository.js
│       ├── messageRepository.js
│       ├── playerRepository.js
│       └── npcRepository.js
├── ai/
│   ├── openaiClient.js
│   ├── prompts.js            # DM rules, checkpoint instructions, prompt builders
│   ├── checkpointSchema.js   # Strict JSON schemas: shared, character, DM notes
│   ├── dungeonMaster.js      # OpenAI calls (DM reply, isolated checkpoint parts)
│   └── images.js             # Picture prompt + image generation
├── services/                 # Business logic; no Discord types
│   ├── audience.js           # Channel -> audience; per-audience filtering
│   ├── worldService.js       # Author notes, world import (new versions)
│   ├── imageService.js       # Arrival and /image pictures, daily cap
│   ├── registry.js           # Pure registry/chronicle merge helpers
│   ├── campaignService.js
│   ├── checkpointService.js
│   └── dungeonMasterService.js
└── discord/                  # Discord adapter layer
    ├── client.js
    ├── access.js             # Guild/channel/ownership checks, mention parsing
    ├── reply.js              # Chunked replies without pings
    ├── checkpointView.js     # Channel -> audience, audience-safe rendering
    ├── commands/checkpointCommand.js
    ├── commands/registryCommand.js  # /npc, /location, /chronicle
    └── handlers/messageCreate.js
migrations/                   # Numbered SQL schema migrations
scripts/migrate.js            # `npm run migrate` entry point
scripts/import-world.js       # One-time NPC/location/chronicle import from a local seed
docs/DECISIONS.md             # Design decision log
docs/OPERATIONS.md            # Upgrade, verify, recover
docs/SESSION_GUIDE_GR.md      # Player + admin session guide (Greek)
```

Dependencies only point downward: `discord` → `services` → `db` / `ai`.

## Database

Schema changes live in [`migrations/`](migrations/) as numbered SQL
files (`0001_baseline.sql`, `0002_...`). Applied migrations are recorded
in the `schema_migrations` table.

```bash
npm run migrate -- status   # list pending migrations
npm run migrate             # apply them, each in its own transaction
```

- The bot refuses to start while migrations are pending. It never runs
  them on its own.
- Migrations only move forward. To undo one, write a new migration that
  reverses it, and take a `pg_dump` backup before any migration that
  changes data.
- Run migrations as `dnd_bot`, the role that owns the tables, so no extra
  `GRANT`s are needed.
- `0001_baseline.sql` reproduces the schema from before migrations were
  tracked. On an existing database it changes nothing and is only
  recorded as applied.

Startup also requires that `campaign_players` contains both Kraavok and
Looming Shade.

## Caveats

- No character sheets yet (XP and level are tracked; HP, conditions and
  resources not yet). Players report their rolls to the DM.
- Adding a player is manual: `.env`, a SQL row, the Discord channel and
  code that names the characters. See *Player Onboarding* in
  [`AI_DM_CHECKLIST.md`](AI_DM_CHECKLIST.md), which also lists the next
  steps.
- Each DM reply only gets what its channel's audience may see (D-004).
  Character knowledge, DM notes and NPC facts are filtered in code. Only
  DM-authored NPC author notes rely on the model not revealing them (D-007).
- No usage or budget accounting.
- Treat model output as narrative, not as proof that data isolation has
  been audited.
