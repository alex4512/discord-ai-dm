# Operations: upgrade, verify, recover

The campaign is live. The rule is that **no change may leave the game
broken**: every upgrade has a verification step and a documented way back.

## Upgrading to a new commit

```bash
# 1. Stop the bot (Ctrl+C or stop the service).

# 2. Back up the database (outside the repo; never commit dumps).
#    pg_dump reads PGHOST/PGUSER/PGPASSWORD/PGDATABASE from the environment.
pg_dump -Fc -f ../backups/dnd_campaign_$(date +%Y%m%d-%H%M%S).dump

# 3. Update code and dependencies.
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

1. Console shows `Database initialized successfully` and `Dungeon Master online as …`.
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

Commits that add no migration (for example the D-004 prompt change) only
need a restart. Roll them back with `git checkout <previous-commit>` and a
restart.

Pre-change backups taken during development live in `../backups/`
(outside the repo).

## Recovery

### Bad checkpoint (story went wrong, or a bad save)

Use the game's own rollback. It's non-destructive: old messages and
versions are kept, and all three parts (shared, character knowledge, DM
notes) are restored together.

```text
@Dungeon Master /checkpoint versions
@Dungeon Master /checkpoint rollback <n>
```

A pending draft you don't like: `@Dungeon Master /checkpoint cancel`.

### Bad deploy (bot crashes or misbehaves after an upgrade)

1. Stop the bot.
2. Go back to the last good code: `git checkout <last-good-commit>`.
3. If that commit is older than a migration you applied, it'll still run,
   because migrations are additive (see the table). You only need to
   restore the database if the data itself is damaged.
4. `npm start` and smoke test.

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
