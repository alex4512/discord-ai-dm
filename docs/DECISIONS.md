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

---

## D-005: Every registered player may save and roll back checkpoints

**Date:** 2026-11-09 · **Status:** accepted

**Context.** The handover flagged that any registered player can run
`/checkpoint save` and `rollback`. Only the draft creator can confirm their
own draft. *(Drafts and confirm were removed in D-011; every registered
player may save, undo and roll back.)*

**Decision.** Keep it that way. No extra approval step.

**Why.** The server is small and private: two trusted players and the DM.
Checkpoint changes are also restricted to `#main-adventure`, where everyone
can see them. Rollback is non-destructive (D-001: versions are append-only),
so a mistaken rollback is undone with another rollback.

**Revisit if** the group grows or players disagree about canon.

---

## D-006: Private events reach other channels as unattributed observable world state

**Date:** 2026-11-09 · **Status:** accepted · **Code:** `src/services/audience.js`

**Context.** After the D-004 revision, consequences of a private event only
reached the channel where they happened. If Kraavok smashes the chapel door
privately and Looming Shade later visits the chapel, the DM didn't know the
door was broken.

**Decision.** DM notes get `observable_world_state: [{ location, state }]`,
the physical state anyone arriving at that place could perceive. It's
**not** tagged by `known_by`, and it reaches every channel's prompt. The
*cause* stays in `world_truth` with `known_by` (D-004). The DM rule says to
describe the state when a character perceives the place, never who caused it.

**Guard in code (fails closed).** For players, an observable entry is dropped
if it mentions any registered character name or name part of 4+ letters
(`Kraavok`, `Looming`, `Shade`). Empty and old-format entries are also dropped.
This may occasionally drop a harmless entry, for example "a looming tower".
That's accepted. `#dm-testing` sees everything.

**Still model-dependent.** The model decides what is observable. It's
instructed to exclude hidden or carried things (items on a person, concealed
objects, conversations). A real-call test kept a hidden ruby out and recorded
only the broken door, unattributed. A careless description could still imply
a cause ("bootprints the size of a half-orc's"). Watch for it in play, and
roll back if it leaks (see OPERATIONS).

**Consequence.** Consequences now cross channels the way they would in the
world, and the shared checkpoint picks them up once they're perceived in
`#main-adventure`.

---

## D-007: NPCs as a versioned checkpoint partition, filtered per audience

**Date:** 2026-11-09 · **Status:** accepted, **revised same day** (see *Revision*) · **Migration:** `0004_npc_partition.sql` · **Code:** `src/services/worldService.js`, `registry.js`, `audience.js` (originally `npcService.js` / `npcRegistry.js`, generalized for D-009)

**Context.** The `campaign_npcs` table was empty, unversioned (a rollback
wouldn't restore NPC state) and went into every prompt whole, including
`secrets`. Characters' knowledge *about* NPCs had no structure.

**Decision.** NPCs live in a fourth partition, `npcs`, on the checkpoint rows,
so they are saved and rolled back with everything else (D-001). Each record:

| Field | Written by | Players' prompts and views |
|---|---|---|
| `role`, `appearance`, `personality` | model at save / seed | everyone, but dropped if it names a player character (D-006 guard) |
| `status`, `location` `{ value, known_by }` | model / seed | only if every reader is in `known_by` |
| `facts [{ fact, known_by }]` | model / seed | only if every reader is in `known_by` |
| `author_notes [string]` | **only the DM** (`/npc note`, import) | DM reply prompts only (labelled DM-only), **never** summarization inputs or `/npc` output to players |

- `/checkpoint save` runs one more isolated call that returns the complete NPC
  list. Code merges it: `author_notes` are always carried over (the model's
  schema can't write them), and NPCs the model omits are kept, never
  silently deleted.
- `/npc note <name>: <text>` (`#dm-testing` only) and `scripts/import-world.js` (originally `import-npcs.js`)
  append a new checkpoint version on the same timeline (boundary kept),
  so DM edits are rolled back like play. A pending draft becomes stale and
  must be saved again.
- `campaign_npcs` is left in place but no longer read.

**Trade-off (accepted).** `author_notes` reach every DM reply prompt, so the DM
can play NPCs consistently (motivations, secrets). Keeping them unsaid relies
on the model. This is a *spoiler* risk only, not a cross-player leak: author
notes come from the DM, never from a player's channel, and that provenance is
set in code. Everything learned in play is filtered by `known_by`.

**Canon (per the user, 2026-11-09).** The NPCs from Kraavok's legacy
history exist in the shared world. What Kraavok learned about them is his
knowledge only (`known_by: Kraavok`). Unsettled questions are DM author
notes, and the DM settles them in play, recorded at the next save.

**The repo is public.** NPC seed files hold canon and DM secrets, so they live
in `data/*.local.json` (gitignored). Never put NPC secrets in docs, commit
messages or tracked files.

### Revision (2026-11-09): NPCs exist for an audience only once they know them

**What happened.** In a pre-release check (real call, live prompt, nothing
posted), "What do we know about Voss?" asked in `#main-adventure` drew the
DM to paraphrase an author note ("connected in some way with …"). The
"DM-only" label didn't hold, the same pattern as D-004. Separately, a
Discord check showed the DM describing unknown NPCs as "just a name", which
was unhelpful.

**Change.** In a player audience, an NPC (and its author notes) is present
only if **every reader knows something** about them: a status, location or
fact with all readers in `known_by`. Today that means `#main-adventure` and
Looming Shade's channel see no NPCs, and `#kraavok-private` sees the NPCs
Kraavok knows. Once characters learn about an NPC in play, the next save
tags it, and the NPC (with author notes) joins that audience's prompt.

**Shared-channel answers.** The shared-channel description now tells the DM:
when something hasn't come up in shared play, say so, and point the player
to their private channel or to sharing it in character. Never describe it as
unknown or empty, and never deny what a character might know privately.

**Verified (real calls, live prompts):** `#main-adventure` answers
"hasn't come up in shared play…" for Voss and Edric with no leak. In
`#kraavok-private`, a direct "Is Voss working with anyone?" answered from
Kraavok's facts only, without revealing the author note.

**Remaining risk.** Author notes still reach prompts where their NPC is
known. A direct probe in that channel could draw out a spoiler, but only to
a player whose character knows that NPC. Watch for it, and roll back if it
matters.

**Gameplay consequence (accepted by the user, 2026-11-09, option A).** NPCs
the shared group hasn't met don't exist for `#main-adventure`:

- `/npc list` there is empty until the group meets someone in shared play.
- If an NPC first appears in a shared scene (e.g. Kraavok and Looming meet
  Voss together), the DM doesn't know him there and improvises. The next
  save records what happened, tagged for both characters, and from then on
  the NPC, with author notes, is part of the main channel's prompts.
- A player can bring their character's knowledge in by saying it in
  character, which makes it shared.

Alternatives considered and deferred: (B) show unmet NPCs' public face
(role, appearance, personality) in shared channels; (C) per-NPC memory, so an
NPC can bring up past events with a character in-world.

---

## D-009: Locations registry and append-only chronicle

**Date:** 2026-11-09 · **Status:** accepted · **Migration:** `0005_locations_chronicle.sql` · **Code:** `src/services/registry.js`, `worldService.js`, `audience.js`

**Context.** Places existed only as prose inside checkpoints and DM notes.
The shared checkpoint is re-summarized at every save, so old events can
quietly drop out of it.

**Decision.**
- **Locations** are a registry partition with the same rules as NPCs (D-007
  and its revision): `description` is shared perception (name-guarded),
  `state` and `facts` are tagged with `known_by`, and `author_notes` are
  DM-only. A player audience sees a place only once every reader knows
  something about it.
- **Chronicle** is an append-only partition: `[{ event, location, known_by,
  version }]`. Entries are never rewritten. `version` is the checkpoint that
  added them (0 = imported history from before the shared campaign).
- **One world-update call** at `/checkpoint save` replaces the NPC update. It
  returns the complete NPC and location registries plus only the *new*
  events. That keeps the number of AI calls the same as before. Code merges
  it: author notes are always carried over (the model's schema can't write
  them), omitted entries are kept, and duplicate events are skipped.
- **Prompts.** Each DM reply gets the locations and the most recent 30
  chronicle events its channel's readers may know. Summarizer inputs get the
  same views without author notes. The world-update and DM-notes calls see
  everything.
- **Commands.** `/location list|show|note` (same as `/npc`) and
  `/chronicle` (the last 20 events this channel may know).
- **Import.** `scripts/import-world.js` takes
  `{ npcs, locations, chronicle }` from a gitignored `data/*.local.json`.

**Consequences.** Today `#main-adventure` knows only Dunmere and no events.
Kraavok's channel knows his places and his legacy events. Everything else
joins a channel as the characters learn it in play.

**Pitfall found while building this.** node-pg sends JavaScript arrays as
Postgres arrays, not JSON, so the chronicle failed to save. All partitions
are now serialized with `JSON.stringify` explicitly
(`src/db/partitions.js`).

---

## D-008: Scene images on first arrival and on request

**Date:** 2026-11-09 · **Status:** accepted · **Migration:** `0006_scene_images.sql` · **Code:** `src/services/imageService.js`, `src/ai/images.js`

**Context.** The user wanted generated images when the scene changes (a new
area or map), not on every reply. Image generation costs much more per call
than a text turn.

**Decision (agreed with the user, option 3).**
- **Arrival trigger.** DM rule 15: when a reply moves the scene to a
  different named place, the DM ends it with a hidden `[[SCENE: <place>]]`
  line. The bot strips it before posting and before storing history, so
  there's no extra AI call per turn.
- **Once per place and audience.** On the first arrival of a channel's
  audience at a place on the current timeline (`scene_arrivals`), the bot
  posts one establishing image after the reply. Images are stored per
  place and per audience (`scene_images`: shared, or character:\<name\>) and
  reused for free, for example after a rollback starts a new timeline.
- **`/image [what to show]`.** A picture of the current scene, or of the
  request, in that channel.
- **Images post only in the channel where the arrival or request happened**
  (user decision). Picture prompts use only that channel's material: the
  DM reply just posted there, its recent history, and the place's
  *visual* fields (description, state) as that audience knows them. Past
  facts and author notes are never used. A cheap text call writes the
  picture prompt, then the house style is prepended.
- **Cost controls.** One rolling 24-hour limit per server for arrivals and
  requests together (`IMAGE_DAILY_LIMIT`, default 10). Past it, arrivals
  are skipped silently and `/image` says so. Every generation is logged in
  `image_generations` with its prompt. Images run after the request lock is
  released, one at a time per server, and an image failure never fails the
  turn.
- **Style: one fixed house style for now** (user decision, to be tweaked
  later): `IMAGE_STYLE`, default "Painterly dark-fantasy illustration,
  muted earthy colours, atmospheric lighting, no text or lettering."
- **Model.** `IMAGE_MODEL`, default `gpt-image-1-mini`, `IMAGE_QUALITY` medium,
  `IMAGE_SIZE` 1536x1024, JPEG output (about 130 KB versus 2 MB as PNG). On
  2026-11-09 this account had no `gpt-image-1` or `dall-e-3`. It lists the
  `gpt-image-1-mini`, `-1.5`, `-2`, `-2.5-*` and `-2.6-*` models, so the
  DALL·E code path was removed. Check OpenAI's pricing before raising the
  model or quality.

**Not game state.** Images aren't versioned and aren't part of the story
history. A rollback resets arrivals (new timeline), and stored images are
reused.

## D-010: Private channels see recent main play; other characters' class and level stay hidden

**Date:** 2026-11-09 · **Status:** accepted · **Code:** `src/ai/prompts.js`, `src/services/dungeonMasterService.js`, `src/services/checkpointService.js`

**Problems seen in live play.**
1. A private channel's prompt had only that channel's history plus the last saved checkpoint. #main-adventure play since the last save didn't reach it, so after Kraavok and Looming met in main, neither private channel knew until someone saved.
2. The DM told Looming's player Kraavok's class and level. Every prompt listed every character's class and level, every stored player turn carried `Class:`/`Level:` lines, and the save step passed both into the shared checkpoint.

**Decisions.**
- **Recent main play in private prompts.** A private channel's prompt gets a "RECENT SHARED SCENE" block: #main-adventure messages since the checkpoint boundary, as a plain transcript ("Kraavok: …", "DM: …"), using up to half of `HISTORY_MAX_CHARS`. Every player can read #main-adventure in Discord, so nothing new is disclosed. The character knows what happened where they were present. Other private channels are never included.
- **Other characters by name only.** Outside #dm-testing, the prompt shows only the current player's own class and level; other player characters appear by name. #dm-testing keeps full summaries.
- **Stored player turns carry the name only** (`Character: X`, no class or level). Older stored turns are stripped when rendered into the transcript.
- **Saves.** The shared-checkpoint generator gets names only. The checkpoint and character-knowledge instructions forbid recording player characters' class, level or game statistics.

**Not done (user decision: fix forward only).** v16 still holds "Kraavok is a level 4 Barbarian" in the shared checkpoint and in Looming's knowledge, and older main turns keep their class/level lines. The next saves are instructed not to record class or level, so those entries should drop out, but this is not guaranteed.

## D-011: Saves go live directly, in the background; undo instead of cancel

**Date:** 2026-11-09 · **Status:** accepted · **Supersedes:** the draft/confirm/cancel flow (D-005's confirm rule) · **Code:** `src/services/checkpointService.js` (`saveCheckpoint`, `undoLastSave`), `src/discord/commands/checkpointCommand.js`

**Context.** Since the save reply became short, `confirm` was an extra step with nothing to review in the channel. A save also took 30–60 s (five parallel model calls; the slowest is the largest knowledge record). It blocked all play meanwhile, and failed outright if anyone wrote during it.

**Decisions.**
- **`/checkpoint save` creates the version directly.** It replies "Saving…" at once and "Saved as vN…" when done.
- **Play continues during a save.** The save runs after the request lock is released, with its own one-per-guild lock. It covers messages up to the high-water mark taken when it started. Messages that arrive meanwhile are simply after the new boundary and go into the next save; they no longer abort it. The save is aborted only if a version is created during generation (rollback, undo or DM edit). Undo and rollback are refused while a save runs.
- **`/checkpoint undo`** (user decision: keep both undo and rollback). It undoes the latest version if it is a save: the previous version's snapshot **and boundary** are restored as a new version on the **same timeline**, so no play is lost and the next save summarizes it again. `rollback` is unchanged: it goes back in the story on a new timeline, and later play is abandoned.
- **Removed:** `draft`, `confirm`, `cancel`. The drafts table stays (unused), so no migration is needed. Any leftover draft is cleared on save.

**Trade-off.** There is no review before a save goes live. A bad summary (e.g. a private fact in the shared part) is live until undone. Check with `/checkpoint show` in `#dm-testing` after saves that involved private play.

## D-012: XP awards computed in code; totals kept in Avrae

**Date:** 2026-11-09 · **Status:** accepted · **Code:** `src/services/xp.js`, DM rule 18 in `src/ai/prompts.js`, `/xp` in `src/discord/commands/registryCommand.js`

**Context.** The players roll dice in Avrae and report results to the DM themselves (they rejected automatic Avrae parsing). They want XP tracked. A model can't reliably count XP across a campaign, and our bot can't trigger Avrae: Avrae ignores bots and webhooks, and has no write API. A self-bot on a player's account would break Discord's terms.

**Decision.**
- **The DM judges, the code counts.** When a reply ends an encounter in the characters' favour, the DM ends it with a hidden tag: `[[XP: 4 goblin CR 1/4; 1 bugbear CR 1 | Kraavok, Looming Shade]]` (or a plain amount for non-combat achievements). The code computes XP from the 2014 Monster Manual CR table and splits it evenly among the named player characters. It floors the result and ignores names that aren't registered (e.g. NPC companions).
- **Output:** one line after the reply, e.g. "**XP:** 3 goblin (CR 1/4) = 150 XP → **+75 each** (Kraavok, Looming Shade). Avrae: `!cc XP +75`". The players run the command; Avrae keeps the totals and levels are updated on the sheet source.
- **Memory:** a short "(XP awarded: …)" note is appended to the stored DM reply, so saves record it.
- **`/xp <same syntax>`** awards by hand when the DM missed it. In campaign channels the note is stored in history.
- Not stored as totals in our database, so a rollback doesn't change Avrae. Re-sync by hand.

*Superseded in part by D-014: totals and levels are now kept by the bot, and the Avrae command is no longer shown.*

**Checked (2026-11-09, synthetic scene with placeholder data).** The tag was emitted in 5 of 5 runs once the rule was marked mandatory (1 of 2 before), and in 0 of 3 mid-fight runs (no false awards).

## D-013: The bot rolls monster and NPC dice

**Date:** 2026-11-09 · **Status:** accepted (user decision) · **Code:** `src/services/dice.js`, `roll_dice` tool in `src/ai/dungeonMaster.js`, DM rules in `src/ai/prompts.js`

**Context.** The DM must not invent dice. Players roll their own characters in Avrae and report results (D-012). Without another source, the DM asked the players to roll the monsters' attacks in Avrae too. The user prefers the bot to roll them.

**Decision.**
- The DM model gets one tool, `roll_dice({rolls: [{label, dice}]})`, for monsters, NPCs and the environment (attacks, damage, their saves, checks, initiative), using Monster Manual (2014) stats.
- Dice are rolled in code with `crypto.randomInt`, never by the model. Expressions: `1d20+4`, `2d6+2`, `2d20kh1+4` (advantage), `2d20kl1` (disadvantage), sums of terms. Up to 100 dice of up to 1000 sides per term.
- The model gets the results, then narrates. Up to 3 tool rounds, then it must answer.
- **Transparency:** every roll is shown above the narration, e.g. "🎲 Goblin 1 scimitar attack vs Kraavok: 1d20 [18] + 4 = **22**". The lines are stored with the reply, so later turns and saves see them.
- Player characters' dice are never rolled by the bot; the DM asks the player for the roll and waits. Without character sheets, the DM asks a player for their AC if it doesn't know it.

**Checked (2026-11-09).** Dice unit tests: ranges, keep-highest/lowest, invalid input, and the distribution of 20,000 d20 rolls. On a synthetic goblin ambush (3 real runs) the DM rolled attack and damage for each goblin, compared them with AC 15 correctly and did not ask the player to roll for monsters.

## D-014: XP and level kept by the bot, versioned with the story

**Date:** 2026-11-09 · **Status:** accepted (user decision) · **Migration:** `0007_xp_progress.sql` · **Code:** `src/services/progressService.js`, `src/db/repositories/xpRepository.js`, `src/discord/xpAnnounce.js`

**Context.** With D-012 the totals lived in Avrae. Players had to run `!cc` after every award, the totals ignored rollbacks, and the bot didn't know anyone's level. The user found this fragile and noted that Avrae adds little: players announce their rolls either way. Avrae becomes optional everywhere.

**Decision.**
- **Ledger + partition.** Each award is a row in `xp_awards`. Its `seq` comes from the **messages sequence**, so the checkpoint boundary covers awards and messages alike (the high-water mark is the maximum over both). A save folds awards in (previous boundary, new boundary] into a new snapshot partition, `progress` (`{ "<character>": { "xp": n } }`). Current XP = `progress` + awards on the active timeline after the boundary.
- **Rollback and undo work for free.** A rollback restores the target's `progress` on a new timeline, so later awards are left behind. An undo restores the previous `progress` *and* boundary on the same timeline, so the awards count again and no XP is lost.
- **Defaults.** A character with no saved XP starts at the minimum for their registered level (Kraavok L4 = 2,700, Looming Shade L1 = 0). Every save writes all registered characters.
- **Levels come from XP** (PHB 2014 table) everywhere the DM sees a level: prompts and save summaries. `campaign_players.character_level` is only the starting point.
- **Visibility (continues D-010).** Award lines (`+75 each`) appear where the award happened. Totals appear only in the owner's private channel and `#dm-testing`. Level-ups are announced in the levelling character's private channel. Test mode shows awards without recording them.
- **Commands.** `/xp` shows your own total (`#dm-testing`: everyone). `/xp <award>` records by hand. `/xp set <character> <total>` (`#dm-testing` only) records the difference as an award, so it is versioned too.
- **Dice wording.** Players roll however they like (Avrae, physical dice, any app) and report in any words. No format is required.

**Checked (2026-11-09).** A rolled-back test on the live DB covered: the defaults, awards, level-up detection, save folding, an undo after a save with a later award (no XP lost), a rollback (later XP gone), a DM tag inside a turn (recorded; Looming shown as level 2 in his prompt), the visibility of totals per channel, a level-up posted in the private channel, and `/xp`, `/xp set` and its channel restriction. 17/17 passed; 0 rows left behind.
