# Discord AI Dungeon Master

A Discord bot that runs a shared D&D 5e (2014 RAW) campaign using OpenAI.
Campaign memory lives in PostgreSQL. It uses versioned shared checkpoints
with timelines, so a rollback leaves the abandoned events stored but no
longer used as canon.

## Setup

1. Node.js 20+ and a PostgreSQL database with the campaign schema applied
   (see [Database](#database)).
2. `npm install`
3. `cp .env.example .env` and fill in the values.
4. `npm start` (or `npm run dev` for watch mode).

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

Run these in #main-adventure (`show` and `versions` also work in #dm-testing):

| Command | Effect |
| --- | --- |
| `/checkpoint show` | Show the active checkpoint |
| `/checkpoint versions` | List the last 20 versions |
| `/checkpoint save` | Draft a new checkpoint from recent main-adventure history |
| `/checkpoint confirm` | Promote your draft to the active checkpoint |
| `/checkpoint cancel` | Discard your draft |
| `/checkpoint rollback <n>` | Restore version `n` on a new timeline |

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
│   ├── schema.js             # Startup schema verification
│   └── repositories/         # One module per table group, SQL only
│       ├── stateRepository.js
│       ├── checkpointRepository.js
│       ├── messageRepository.js
│       ├── playerRepository.js
│       └── npcRepository.js
├── ai/
│   ├── openaiClient.js
│   ├── prompts.js            # DM rules, checkpoint instructions, prompt builders
│   ├── checkpointSchema.js   # Strict JSON schema for checkpoints
│   └── dungeonMaster.js      # OpenAI calls (DM reply, checkpoint generation)
├── services/                 # Business logic; no Discord types
│   ├── campaignService.js
│   ├── checkpointService.js
│   └── dungeonMasterService.js
└── discord/                  # Discord adapter layer
    ├── client.js
    ├── access.js             # Guild/channel/ownership checks, mention parsing
    ├── reply.js              # Chunked replies without pings
    ├── commands/checkpointCommand.js
    └── handlers/messageCreate.js
```

Dependencies only point downward: `discord` → `services` → `db` / `ai`.

## Database

The bot does not create tables. At startup it checks that these tables
exist: `messages`, `campaign_players`, `campaign_npcs`,
`campaign_checkpoints`, `campaign_state`, `campaign_checkpoint_versions`
and `campaign_checkpoint_drafts`. It also checks for the timeline and
boundary columns. Startup also requires that `campaign_players` contains
both Kraavok and Looming Shade.

## Caveats

- No Avrae result ingestion yet.
- Private-channel checkpoints are not implemented. Private channels use
  their full active-timeline history.
- No usage or budget accounting.
- Treat model output as narrative, not as proof that data isolation has
  been audited.
