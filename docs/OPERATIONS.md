# Operations: upgrade, verify, recover

The campaign is live. The rule is that **no change may leave the game
broken**: every upgrade has a verification step and a documented way back.

## Upgrading to a new commit

```bash
# 1. Stop the bot (Ctrl+C or stop the service). Pick a moment when nobody
#    is waiting for a reply or a save: shutdown is immediate, so in-flight
#    work is cut off, and mentions sent while the bot is down get no answer.
#    A cut-off save is harmless (nothing is written); just save again.

# 2. Back up the database (outside the repo; never commit dumps).
#    pg_dump reads PGHOST/PGUSER/PGPASSWORD/PGDATABASE from the environment.
pg_dump -Fc -f ../backups/dnd_campaign_$(date +%Y%m%d-%H%M%S).dump

# 3. Update code and dependencies (needed when package.json changed,
#    e.g. @resvg/resvg-js for /map since D-018).
git pull
npm install

# 4. Apply schema changes.
npm run migrate -- status
npm run migrate

# 5. Start and verify.
npm start
```

On Windows, if `pg_dump` can't find credentials, export the `PG*` values
from `.env` in that shell first. Don't paste them anywhere else.

**Smoke test after every upgrade:**

1. Console shows `Database initialized successfully (2 players, 2 private channels)` and `Dungeon Master online as …`.
2. In `#dm-testing`: `@Dungeon Master /checkpoint show` returns the active version.
3. In `#dm-testing`: `@Dungeon Master are you there?` returns a reply. This
   channel doesn't persist messages.

If the bot refuses to start with *"pending migrations"*, run step 4. It
never applies migrations on its own.

## Migration log and compatibility

All migrations so far are **additive**. They only add tables or columns,
so a still-running older bot keeps working after them. Any future migration
that is not additive will be marked **STOP THE BOT FIRST** here and in its
commit message.

| Migration | What it does | Older bot still works after it? | Undo |
|---|---|---|---|
| `0001_baseline` | Records the existing schema; creates `schema_migrations` | yes (no-op) | not needed |
| `0002_message_seq` | `messages.seq` ordering; `boundary_seq` on state, versions, drafts | yes | restore backup, or drop the added columns |
| `0003_knowledge_partitions` | `character_knowledge`, `dm_notes` on state, versions, drafts | yes | restore backup, or drop the added columns |
| `0004_npc_partition` | `npcs` on state, versions, drafts | yes | restore backup, or drop the added columns |
| `0005_locations_chronicle` | `locations`, `chronicle` on state, versions, drafts | yes | restore backup, or drop the added columns |
| `0006_scene_images` | new tables `image_generations`, `scene_images`, `scene_arrivals` | yes | drop the three tables |
| `0007_xp_progress` | `progress` JSONB on state/versions/drafts; new table `xp_awards` (seq from the messages sequence) | yes | drop `xp_awards` and the three `progress` columns |
| `0010_openai_usage` | new table `openai_usage`: tokens and estimated cost per OpenAI call (D-026). Not story data: never versioned or rolled back | yes (older code ignores it) | drop `openai_usage` |
| `0009_inventory` | `inventory` JSONB on state/versions/drafts; new table `inventory_events` (seq from the messages sequence). Backfilled 2026-11-10 with 9 items from the shared record (D-022) | yes, but **restart before the next save**: a save by older code moves the boundary past the backfilled events without folding them, so they'd be lost (re-run the backfill then). Done 2026-11-10: v33 was saved by the new code | drop `inventory_events` and the three `inventory` columns |
| `0008_player_channels` | `campaign_players.private_channel_id` + unique index (D-020). Filled once for Kraavok and Looming from the old `.env` values (2026-11-09) | yes (older code still reads `.env`) | drop the column and index |

Commits that add no migration (for example the D-004 prompt change) only
need a restart. Roll them back with `git checkout <previous-commit>` and a
restart.

Pre-change backups taken during development live in `../backups/`
(outside the repo).

## Costs (D-026)

Every OpenAI call prints a line to the console, such as
`[usage] turn gpt-5.4-mini in=12000 cached=8000 out=300 ~$0.0050`, and is
stored in `openai_usage`. When the month's estimate crosses 80% and 100% of
`MONTHLY_BUDGET_USD`, a warning goes to `#dm-testing`. Play never stops.
The estimate only counts calls since 2026-11-10 (migration 0010) and uses a
fixed price table in `src/services/usage.js`. **OpenAI's dashboard is the
real bill:** set a budget limit there too.

This month so far, by kind of call:

```sql
SELECT kind, model, count(*), round(sum(est_usd), 2) AS usd
  FROM public.openai_usage
 WHERE created_at >= date_trunc('month', now())
 GROUP BY 1, 2 ORDER BY usd DESC;
```

Levers, cheapest first:

- **Models:** `OPENAI_MODEL` (turns, maps, image prompts) and
  `CHECKPOINT_MODEL` (saves) in `.env`, then restart.
- **Saves:** each save makes about 5 large calls. Save at the end of a
  session or a chapter, not after every scene.
- **History:** `HISTORY_MAX_CHARS` (per channel, since the last save). A
  save also resets it.
- **Images:** `IMAGE_DAILY_LIMIT`.
- **Testing:** `#dm-testing` turns cost the same as real ones.

## Recovery

### Bad checkpoint (story went wrong, or a bad save)

Use the game's own rollback. It's non-destructive: old messages and
versions are kept, and all three parts (shared, character knowledge, DM
notes) are restored together.

```text
@Dungeon Master /checkpoint versions
@Dungeon Master /checkpoint rollback <n>
```

A save whose **summary** came out wrong (missed something, mixed up who
knows what) but the play itself was fine: `@Dungeon Master /checkpoint undo`.
It restores the previous summary and keeps every message, so the next save
redoes it. Use `rollback` only to go back in the story (D-011).

### Private information leaked into #main-adventure

Anything the DM says in `#main-adventure` is stored in the main history. The
next `/checkpoint save` treats it as public, because every player could read
it. Prompt fixes don't remove it after the fact, so **the only undo is a
rollback** to a version from before the leak:

```text
@Dungeon Master /checkpoint rollback <n>      # last version before the leak
```

If the leak is only in a save's **summary** (e.g. a private fact in the
shared part) and not in anything the DM said in `#main-adventure`, use
`/checkpoint undo` instead: no play is lost. Saves go live immediately
(D-011), so check `/checkpoint show` in `#dm-testing` after a save when
private play happened.

Then fix the cause (see [DECISIONS.md](DECISIONS.md) D-004 revision for the
2026-11-09 incident) and replay the scene. Leaks in a private channel only
reach that channel's owner. Roll back there too if the owner shouldn't know.

### A few messages should never have happened (since the last save)

Example: a briefing to the DM that an NPC answered in character (D-024,
2026-11-10). When the messages are after the boundary and nothing else
depends on them, take just those out of play instead of rolling back.
Take a backup first, then move them to a fresh, unused timeline:

```sql
-- check first: the rows, plus any xp_awards / inventory_events with the same seq range
UPDATE public.messages SET timeline_id = gen_random_uuid()
 WHERE guild_id = '<guild id>' AND seq IN (<seq>, <seq>);
```

They stay stored but leave the history, the next save and every prompt.
If an XP award or loot event came with them, move or delete it the same
way. Deleting the messages in Discord is optional: it only tidies what
people see, since the bot reads its own database.

Wrong facts already in a saved version are corrected differently: a new
version on the same timeline with `amendActiveSnapshot` (D-023).

### Bad deploy (bot crashes or misbehaves after an upgrade)

1. Stop the bot.
2. Go back to the last good code: `git checkout <last-good-commit>`.
3. If that commit is older than a migration you applied, it'll still run,
   because migrations are additive (see the table). You only need to
   restore the database if the data itself is damaged.
4. `npm start` and smoke test.

Code from before D-020 reads the players' channels from `.env`
(`KRAAVOK_*`, `LOOMING_*`, `ALLOWED_CHANNEL_IDS`). Newer code ignores
those lines, so **keep them in `.env`** as long as you might go back.

### Restoring a backup from before 0008

`npm run migrate` adds the column empty. The bot then starts but ignores
the private channels (fail closed: never treated as shared). Fill them in
once, then restart:

```sql
UPDATE public.campaign_players SET private_channel_id = '<channel id>'
 WHERE guild_id = '<guild id>' AND discord_user_id = '<player id>';
```

The IDs are the old `KRAAVOK_*` / `LOOMING_*` values in `.env`.

### Restore the database from a backup (last resort)

This **replaces all campaign data** with the backup's contents.

```bash
# Stop the bot first.
pg_restore --clean --if-exists --no-owner -d "$PGDATABASE" ../backups/<file>.dump
npm run migrate -- status   # shows which migrations the restored DB is missing
```

Then check out the code that matches the restored schema, or run
`npm run migrate` to bring it forward.

## Where things are

- Design decisions and why: [DECISIONS.md](DECISIONS.md)
- Feature status: [../AI_DM_CHECKLIST.md](../AI_DM_CHECKLIST.md)
- Setup and commands: [../README.md](../README.md)
