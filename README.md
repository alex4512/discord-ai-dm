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
| `/checkpoint draft` | all | Show the pending draft |
| `/checkpoint versions` | main, testing | List the last 20 versions |
| `/checkpoint save` | main | Draft a new checkpoint from all channels since the last boundary |
| `/checkpoint confirm` | main | Promote your draft to the active checkpoint |
| `/checkpoint cancel` | main | Discard your draft |
| `/checkpoint rollback <n>` | main | Restore version `n` (all three parts) on a new timeline |

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
│   └── dungeonMaster.js      # OpenAI calls (DM reply, isolated checkpoint parts)
├── services/                 # Business logic; no Discord types
│   ├── campaignService.js
│   ├── checkpointService.js
│   └── dungeonMasterService.js
└── discord/                  # Discord adapter layer
    ├── client.js
    ├── access.js             # Guild/channel/ownership checks, mention parsing
    ├── reply.js              # Chunked replies without pings
    ├── checkpointView.js     # Channel -> audience, audience-safe rendering
    ├── commands/checkpointCommand.js
    └── handlers/messageCreate.js
migrations/                   # Numbered SQL schema migrations
scripts/migrate.js            # `npm run migrate` entry point
docs/DECISIONS.md             # Design decision log
docs/OPERATIONS.md            # Upgrade, verify, recover
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

- No Avrae result ingestion yet.
- DM replies in private channels still use the full active-timeline
  private history, not the checkpoint boundary plus character knowledge.
- No usage or budget accounting.
- Treat model output as narrative, not as proof that data isolation has
  been audited.
