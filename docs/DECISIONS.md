# Design decisions

A short log of architectural and canon-relevant decisions, newest last.
Each entry records what was decided, why, and what it costs, so later
changes can revisit it on purpose instead of by accident.

---

## D-001: Knowledge partitions stored as columns on checkpoint rows

**Date:** 2026-11-09 · **Status:** accepted · **Migration:** `0003_knowledge_partitions.sql`

**Context.** One shared checkpoint can't hold what only one character knows
or what only the DM knows. Private channels had no durable memory beyond
their raw message log, and a rollback didn't restore private knowledge
together with the shared state.

**Decision.** Each checkpoint row (`campaign_state`,
`campaign_checkpoint_versions`, `campaign_checkpoint_drafts`) holds three
partitions:

| Column | Audience | Content |
|---|---|---|
| `checkpoint` | everyone | Shared world: what all players may know |
| `character_knowledge` | that character's player | `{ "<character name>": {...} }`: what each character personally knows |
| `dm_notes` | DM only | World truth, secrets and who knows them, NPC developments, continuity warnings |

`/checkpoint save` produces each partition with a **separate model call
whose input contains only what that audience may know**:

| Partition | Input |
|---|---|
| shared | main channel + previous shared checkpoint + public NPC fields |
| character X | main channel + X's private channel + X's previous knowledge |
| DM notes | everything, including NPC secrets |

One `boundary_seq` high-water mark covers all three channels. A draft
summarizes exactly the messages in `(previous boundary_seq, draft boundary_seq]`
from every channel.

**Why.**
- *Atomic by construction.* A version is a single row, so save, confirm and
  rollback always move all partitions together. No cross-table consistency
  logic is needed.
- *Isolation is mechanical, not an instruction.* The shared call never
  receives private text, so it can't leak it into the shared checkpoint,
  whatever the model does. The handover warns against treating LLM
  instructions as a privacy boundary.
- At 2 players, separate tables would add joins and versioning logic with
  no benefit.

**Consequences.**
- About 4× the tokens per `/checkpoint save` (shared + DM + one per active character).
- Something that happens in a private channel and changes the world goes into
  `dm_notes` only. It enters the shared checkpoint when it plays out in the
  main channel.
- If the number of characters grows a lot, revisit whether to move the
  partitions to their own table.
- Versions saved before `0003` have NULL partitions. Rolling back to one
  restores "nothing recorded", which is correct, because nothing was
  recorded then.

---

## D-002: #dm-testing is the DM's debug view

**Date:** 2026-11-09 · **Status:** accepted

**Context.** Partitions must be inspectable somewhere, but never in a
channel the wrong player can read.

**Decision.** Channel → audience (`src/discord/checkpointView.js`):

| Channel | Readers | `/checkpoint show` and `draft` display |
|---|---|---|
| `#dm-testing` | DM only | everything: shared + all character knowledge + DM notes |
| private channel | its owner | shared + the owner's own knowledge |
| `#main-adventure` | all players | shared only |

`save`, `confirm`, `cancel` and `rollback` stay in `#main-adventure`.
`#dm-testing` is read-only for checkpoints, and private channels allow only
`show` and `draft`.

**Assumption.** `#dm-testing` is restricted to the DM in Discord's
permissions. The bot doesn't enforce who can read a channel. If that
changes, change this mapping.

---

## D-003: Character knowledge is created on first activity; Kraavok is seeded from his legacy checkpoint

**Date:** 2026-11-09 · **Status:** accepted

**Context.** At the time of this decision, no private-channel messages
existed on the active timeline. Kraavok has a legacy (pre-versioning) solo
checkpoint. Since v1 it wasn't used in any prompt.

**Decision.**
- A character gets a knowledge record only when there's something to
  record: new private-channel history, an existing record, or a legacy seed.
  Others keep no record until they start playing privately. Today that
  means Kraavok first, with Looming Shade following on first private play.
- Kraavok's legacy checkpoint seeds his **first** knowledge record as his
  *personal memories*, marked uncertain where uncertain. It's **not**
  promoted to shared canon. The shared checkpoint keeps the intentionally
  vague pre-meeting baseline.
- The DM notes always receive the legacy checkpoint as background.

**Consequences.** Kraavok's solo history is available again, in the right
partition, and can't leak to Looming Shade through the shared checkpoint.
