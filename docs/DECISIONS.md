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

---

## D-004: DM reply prompts contain only what the channel's audience may see

**Date:** 2026-11-09 · **Status:** accepted, **revised same day** (see *Revision* below) · **Code:** `src/services/audience.js`

**Context.** Commit 3 stored character knowledge and DM notes, but DM replies
ignored them. Private channels also fed the model their entire raw history.

**Decision.** Each DM turn builds its prompt for the channel's audience (D-002):

| Channel | Shared checkpoint | Character knowledge | DM notes | History |
|---|---|---|---|---|
| `#main-adventure` | yes | **none** | filtered for *all* registered characters | main, since boundary |
| private channel | yes | **own only** | filtered for the owner | own channel, since boundary |
| `#dm-testing` | yes | all | all | none (nothing persisted) |

**Filtering DM notes.** A `dm_notes.secrets` entry is included only if
**every** reader of the channel appears in its `known_by` (matched exactly,
ignoring case and surrounding spaces). The filter fails closed: a secret with
a missing or misspelled `known_by` is dropped. This part is mechanical, so a
secret only Kraavok knows can't reach Looming Shade's prompt.

The other DM-notes fields (`world_truth`, `npc_developments`, `open_threads`,
`continuity_warnings`) are included and labelled *DM ONLY; never reveal
directly*. The DM needs them to keep the world consistent across channels.

**Trade-off (accepted).** Those other fields, and the NPC registry with
`secrets`, which was already in every prompt before this change, rely on the
model obeying the "don't reveal" instruction. They are **not** a mechanical
privacy boundary. If leaks show up in play, the next step is to also
classify world_truth entries by who knows them, the same way secrets are.

**Why no character knowledge in `#main-adventure`.** Its output is read by
every player. If a player wants their character to share something, they say
it in-game. That's also how knowledge transfers (it then gets summarized into
the other character's record at the next save).

**History boundary everywhere.** Private channels now start at the same
`boundary_seq` as main, because everything before it is summarized in the
character's knowledge record (D-001). This assumes private messages before a
boundary were summarized. That holds for every boundary set since D-001.
The only pre-D-001 boundary (v1) was abandoned by rollback, and the active
timeline at the time of this change had no boundary.

### Revision (2026-11-09): every DM-notes entry is filtered in code

**What happened.** In the first Discord test of D-004, Kraavok hid a bone
token in his private channel. In `#main-adventure` the DM was asked what was
in Kraavok's boot, and it **answered**. The secret filter had worked, but the
DM-notes call had also written the event into `world_truth` and
`continuity_warnings`. Those reached the main prompt labelled *DM ONLY*,
and the model ignored the label. The accepted trade-off above failed in
practice. Fixed by rolling back to v4.

**Change.** Every DM-notes list (`world_truth`, `secrets`,
`npc_developments`, `open_threads`, `continuity_warnings`, `notes`) is now a
list of `{ note | secret, known_by[] }`. In a player channel, an entry is
included only if **every** reader is in its `known_by`. Untagged entries,
old string-format entries (versions saved before this revision) and pure DM
background (`known_by: []`) are dropped for players and stay visible in
`#dm-testing`.

**Cost.** In player channels the DM no longer gets cross-channel hints such as
"the crypt door is open because Kraavok opened it". Shared consequences reach
other channels once they're established in the main adventure. This keeps
D-001's principle: privacy is enforced by what the prompt contains, not by
instructions.

**Still model-dependent.** The NPC registry (with `secrets`) is still in
every prompt, unchanged from before D-004. It's empty today. Filtering it the
same way is the next step if NPC secrets get populated.
