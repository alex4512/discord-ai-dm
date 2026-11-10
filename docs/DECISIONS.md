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

*Option C was built later as D-016.*

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

## D-015: XP for challenges and milestones, not for single checks

**Date:** 2026-11-09 · **Status:** accepted (user: "any choice is fine, document it") · **Code:** `src/services/xp.js` (`THRESHOLDS`, `CHALLENGE`), DM rule 18 in `src/ai/prompts.js`

**Context.** The user asked whether XP comes only from fights, or also at key points and when an ability check passes.

**Rules followed (5e 2014).** XP is for *overcoming challenges*. The Dungeon Master's Guide values a non-combat challenge like a combat encounter of the same difficulty, and allows milestone awards for major story goals. There is no XP per ability check: it would inflate XP and reward rolling for everything.

**Decision.**
- **Overcome obstacles earn XP:** a trap disarmed, a crucial negotiation won, a puzzle solved, a dangerous crossing made. A single successful check counts when it is what overcomes a real obstacle. Routine checks and checks that find nothing never earn XP.
- **Milestones:** major story points (e.g. reaching the Bell) are tagged as hard or deadly.
- **The DM rates difficulty, the code prices it.** Tag: `[[XP: medium challenge: disarmed the trap | Kraavok, Looming Shade]]` (easy, medium, hard or deadly; `challenge` or `milestone`). The XP is the sum of each participant's DMG threshold at their current level (from D-014), split evenly like monster XP. Example: medium with Kraavok L4 (250) and Looming L1 (50) = 300, so +150 each.
- **`/xp medium challenge: <what> | <names>`** awards one by hand. Plain amounts (`/xp 100 <what> | <names>`) remain available.

**Checked (2026-11-09).** Parser: difficulty pricing by level, milestones, challenges mixed with monsters; monster and plain awards unchanged. Real model on synthetic scenes: a disarmed trap was tagged in 3/4 runs (1/3 before the clarification that a check which overcomes an obstacle counts), and an ordinary Perception check that finds nothing in 0/4. Earlier XP tests (D-012, D-014) still pass.

## D-016: NPC memory

**Date:** 2026-11-09 · **Status:** accepted (user chose option A) · **Code:** `memories` in the NPC schema (`src/ai/checkpointSchema.js`), `mergeUpdate` (`src/services/registry.js`), `npcMemoriesFor` (`src/services/audience.js`), DM rule 19 and the world-update instructions (`src/ai/prompts.js`)

**Context.** D-007 deferred option C: NPCs that remember their past scenes with a character and can raise them in-world. The user made it a priority.

**Decision.**
- **Data.** Each NPC record gets `memories: [{ with, memory, secret }]`, written from the NPC's point of view (e.g. "Kraavok rescued me when I was held prisoner…"). It lives inside the `npcs` partition, so it is versioned, rolled back and undone with everything else. No migration.
- **Written at save** by the world-update call, which sees every channel. Memories are **append-only**: `mergeUpdate` keeps any previous memory the model leaves out, so an NPC never forgets. On the first saves the model backfills memories from existing facts, the chronicle and the DM notes.
- **`secret`:** true when the NPC would keep it to themselves in front of others (a secret pact, a hidden item, something incriminating, or the character asked for discretion).
- **In DM replies:** for NPCs mentioned in the current message, the recent history of that channel, the recent main play (private channels) or the checkpoint scene, the DM gets an `NPC MEMORIES` block. Name matching is whole-word, case-insensitive, on the full name or a part of at least 3 letters; titles like "Brother" or "Mother" alone don't match. Capped at 8 per NPC and character.
  - **Private channel:** memories with that character, secret ones included (the NPC is alone with them).
  - **Shared channel (user option A):** non-secret memories with any reader. The NPC may raise them in front of others, as a real person would, and what it says becomes shared at the next save. Secret memories are left out entirely (fail closed).
  - **`#dm-testing`:** every memory of the mentioned NPCs.
- **Rejected option B:** only memories every reader already knows. It is safer, but NPCs would act as strangers in shared scenes.

**Checked (2026-11-09).**
- Logic tests: append-only merge with author notes kept, per-channel filtering (secret excluded in main, included in private), mention matching (title words, short names, no substring matches). 10/10 passed.
- Real model, placeholder NPC: in a shared scene the NPC recalled a non-secret memory out loud and never the secret (2/2). In the private channel it spoke discreetly about the secret (2/2).
- Real save on live data (rolled back): memories backfilled for Orren, Voss, Varek and Mother Vael (secret) after the backfill instruction was strengthened (only Brann, Derren and the stranger before). All five save calls were well within their caps.

## D-017: Bounded prompt size: compaction at save, scene-relevant registries

**Date:** 2026-11-09 · **Status:** accepted (user chose options 1 and 2; rejected a persistent typing indicator and shorter narration) · **Code:** `SIZE_BUDGETS` and `compaction()` in `src/ai/prompts.js`, `sizeBudget()` in `src/services/checkpointService.js`, `mentionedIn()` in `src/services/audience.js`, `sceneText` in `src/services/dungeonMasterService.js`

**Context.** Replies felt slower as the campaign went on. A rough analysis (2026-11-09) found:
- Database work is negligible (7–60 ms per turn), and message history is capped and resets at each save. Neither was the problem.
- The saved records sent with every reply grew at every save, because the instructions said to keep everything: character knowledge 20–23k chars, DM notes 19–29k, shared checkpoint 13k, NPCs and places 13–15k. Prompts reached 17k tokens in main and 23–25k in the private channels.
- A short reply took about 5 s (mostly a fixed model overhead; OpenAI already caches 90%+ of the prompt). Narration adds about 6–10 s, and fights add 1–2 sequential tool calls for monster dice (D-013).

**Decision.**
1. **Compaction at save.** The shared checkpoint, each character record and the DM notes each have a size budget (6,000 / 8,000 / 10,000 chars). Each generator gets `size_budget: { previous_chars, max_chars }` and is told to compact at every save, harder when over budget: merge overlapping entries, summarize older or resolved items into short lines, drop superseded details. It must never drop secrets and who knows them, open objectives and mysteries, or relationships. **DM-notes entries are merged only when their known_by lists are identical**, so compaction cannot widen who knows a secret.
2. **Scene-relevant registries.** A DM reply gets only the NPCs and places mentioned in the current message, the channel's recent history, the recent main play (private channels) or the checkpoint's current location, scene and party. It uses the same whole-word matching as NPC memories (D-016). `/npc` and `/location` commands are unchanged and still list everything known.

**Measured (2026-11-09, real save on live data, rolled back).**
- **Records:** checkpoint 12.8k → 7.1k chars; Kraavok's knowledge 20.2k → 9.9k; Looming Shade's knowledge 23.4k → 8.2k; DM notes 28.9k → 10.5k.
- **Privacy preserved:** Kraavok-only secrets 8 → 8; Looming-only secrets 2 → 1 (two merged, same known_by); no entry moved to a wider known_by.
- **Prompt per reply:** main 17k → 9k tokens; Kraavok's channel 25k → 13k; Looming's channel 23k → 11k. The NPC block went from about 9–11k chars to about 2k (only the NPCs in the scene).
- **Latency:** a short reply went from 5.2 s to 4.8 s. The gain per reply is modest because the fixed model overhead dominates. The main effect is that prompts **stop growing**, so replies no longer slow down as the campaign goes on. The remaining levers (narration length, monster-dice rounds, model choice) were not taken.

## D-018: Scene maps drawn by code

**Date:** 2026-11-09 · **Status:** accepted (user: text grid as an option, plus a drawn map) · **Code:** `src/ai/mapSchema.js`, `MAP_INSTRUCTIONS` in `src/ai/prompts.js`, `src/services/mapService.js`, `src/services/mapRender.js` · **Dependency:** `@resvg/resvg-js` 2.6.2 (SVG → PNG, prebuilt binaries)

**Context.** `/image` (D-008) is good for setting a scene but can't show who stands where. An image model doesn't keep positions, distances or battle order. A simple sketch does.

**Decision.**
- **`/map [focus]`** posts a drawn battle-map (PNG) with a text legend. **`/map text [focus]`** posts the same map as a monospace grid in a code block. On request only; never automatic.
- **Positions as data.** One structured model call (`scene_map`) returns a grid (4–24 squares a side, 1 square = 5 ft), terrain rectangles (wall, door, water, difficult, cover, tree, fire, pit, stairs, other) with short labels, and tokens (1–2 character id, name, party/ally/enemy/neutral, square). The code clamps sizes, drops out-of-range or overlapping tokens, and makes ids unique.
- **Drawn by code.** The PNG has coloured circles by side (party green, ally blue, enemy red, neutral grey), grid coordinates A… and 1…, and labelled terrain. The text grid uses symbols `# + ~ ^ o T * O = ?`. Both include a legend that names the labelled features.
- **Audience-safe input.** The map call gets only the shared checkpoint's location, scene and party, plus that channel's own recent messages on the active timeline (up to 8,000 chars). Private channels never see each other. In #dm-testing (nothing stored) it gets the checkpoint and the request.
- **It doesn't touch campaign state.** It runs after the request lock, one map at a time per server. It isn't stored in history and has no daily cap (it's a cheap text call).

**Checked (2026-11-09).** Rendering tests: clamping, unknown kinds dropped, token de-duplication, grid rows, PNG output. Real model on a synthetic courtyard fight: walls, door, well, cover and 3 skeletons placed as narrated. A read-only map of the live #main-adventure scene placed the party in the rear work area and muddy yard.

**Deferred in the same discussion:** graceful restart (drain in-flight work, `/restart`, catch-up of missed mentions). The user called it a luxury for now; it is noted in the checklist.

## D-019: Maps are stored in the channel's history

**Date:** 2026-11-09 · **Status:** accepted; **not yet validated in play** (the user will look for it during user testing) · **Code:** `compactMapNote()` in `src/services/mapRender.js`, `sceneMap()` in `src/services/mapService.js`, DM rule 20 and the `previous_map` rule in `MAP_INSTRUCTIONS` (`src/ai/prompts.js`)

**Context.** With D-018 a map was shown and then forgotten. The DM's next reply didn't know the positions the players had just seen, and each `/map` started from scratch, so positions could jump between two sketches of the same scene. The user asked whether the map should be saved in the current context.

**Decision.**
- **Stored as a short note.** After `/map`, a compact text note is stored in **that channel's** history as a DM message, under the `/map` command's message id. Size is about 300–600 chars. Example:
  `(Scene map: Dunmere Broad Low Building, 12×8, 1 square = 5 ft, columns A–L, rows 1–8. Tokens: K D4 Kraavok, L C4 Looming Shade, … Terrain: wall A1–L1 (north wall), door C5 (storage door), cover D6 (crates), ….)`
  The PNG and the full grid are not stored.
- **The DM uses it** (DM rule 20): a "(Scene map: …)" line is the sketch the players saw. The DM treats it as the current positions and keeps distances and narration consistent with it, unless creatures moved since.
- **The next `/map` updates it.** The channel's latest map note is passed as `previous_map`. If the scene is the same place, the model keeps the layout, size and terrain and moves only what changed. If the action moved elsewhere, it draws a new map. Creatures are never placed on wall squares.
- **It follows the story for free.** It is an ordinary message, so the next save summarizes it, a rollback abandons it with its timeline, and an undo keeps it. A map in a private channel stays in that channel (a map in #main-adventure also reaches private channels through recent main play, D-010, as all main play does). #dm-testing stores nothing.
- No migration.

**Checked (2026-11-09, rolled-back test on live data, real map calls).** Map 1 was stored as a DM note. After a narrated move ("Kraavok strides three squares north"), map 2 received map 1 as `previous_map`, kept the same 12×8 layout and terrain, moved Kraavok from D4 north, and left the other 4 tokens in place. The next DM turn had the note in its history and rule 20 in its instructions. A map in #dm-testing was not stored. 10/10 passed, 0 rows left. The model had put Kraavok on a wall square, which led to the "never on a wall" rule.

**What to look for in user testing.**
1. After a `/map`, ask the DM about distances ("how far is the door?"). The answer should match the map.
2. Move someone, then run `/map` again. The layout should stay and only the moved creatures should change.
3. Move to a different place, then run `/map`. It should be a new map, not the old layout.
4. Check that a map from a private channel never shows up in the other player's channel.

## D-020: Players and their private channels live in the database

**Date:** 2026-11-09 · **Status:** step 1 accepted and done; step 2 agreed, **not built** (no new player yet) · **Code:** `migrations/0008_player_channels.sql`, `src/services/roster.js`, `getRoster()` in `src/db/repositories/playerRepository.js`

**Context.** Adding a player meant editing `.env` (a channel and a user ID per player, plus `ALLOWED_CHANNEL_IDS`), code that named Kraavok and Looming Shade (startup check, config, DM rules), a SQL row and a Discord channel. No third player is joining yet, but the user wants the roster stored so that one can be added later without code changes.

**Decision, step 1 (done).**
- **Stored with the player.** `campaign_players.private_channel_id` (NULL = no private channel; the player still plays in `#main-adventure`). Unique per guild. Kraavok's and Looming's were copied once from `.env`, after a backup (`dnd_campaign_pre-0008_20261109-203739.dump`).
- **Loaded at startup** into `roster.js` and kept in memory, because access checks and audiences run on every message. Anything that changes the roster must call `loadRoster()` again.
- **Fixed channels stay in `.env`:** `MAIN_ADVENTURE_CHANNEL_ID`, `DM_TEST_CHANNEL_ID`. `KRAAVOK_*`, `LOOMING_*` and `ALLOWED_CHANNEL_IDS` are no longer read (kept in `.env` only for going back to older code).
- **Allowed channels = main + testing + registered private channels.** Fail closed: a channel missing from the database is ignored, never treated as a shared channel, so a private channel can't leak by being forgotten.
- **No names in logic.** Startup needs at least one player instead of exactly Kraavok and Looming. The DM rules point to the REGISTERED PLAYER CHARACTERS block. Saves say "every registered character". The v0 legacy checkpoint keeps its owner's name as historical data (`LEGACY_CHECKPOINT_CHARACTER`); it is only read at v0. Names remain only as examples in prompts and help text.

**Checked (2026-11-09, live data, mocked model, rolled back).** Roster 2 players / 2 channels, equal to the old `.env` values. Access unchanged: each private channel is owner-only, main and testing are open, an unknown channel and another guild are refused. Audiences unchanged (main shared, testing DM, each private channel its character). DM prompts: each private channel gets only its own character knowledge, main none. A save still makes one knowledge call per private channel (Kraavok, Looming Shade). 25 checks passed, no rows left.

**Plan, step 2 (agreed, build when a new player joins).** `/player add @user "Name" Class Level [#channel]`, run by the admin in `#dm-testing`:
- **Creates the private channel by default** (user's choice), named after the character, under the existing private channels' category. Visible only to that player and the bot (server admins see all channels anyway, as Discord works). Needs the bot's *Manage Channels* and *Manage Roles* permissions.
- **Or uses an existing channel** given as `#channel`, for when those permissions aren't granted.
- Registers the player, sets the starting XP for the level (D-015), reloads the roster (no restart), posts a welcome in the new channel.
- Later steps (separate designs): guided introduction (backstory → first knowledge record), story entry approved by the admin, `/player retire`, player guide in English and Greek.

## D-021: MVP declared complete; post-MVP roadmap adopted

**Date:** 2026-11-10 · **Status:** accepted (owner decision)

**Context.** Milestones 1–4 (memory, multiplayer knowledge, character progress and dice, persistent world) and onboarding step 1 (D-020) are built and in live play. The owner brought a feature summary for what comes next.

**Decision.**
- **The MVP is complete.** The ⚠️ items left in Milestones 1–4 are live validations (the Looming-only clue, the watchtower meeting in the shared record, stored maps), carried over as open items, not blockers.
- **Post-MVP roadmap** (`AI_DM_CHECKLIST.md`, section 8):
  - Phase 1 Reliability: Consistency Auditor, then DM Diagnostics.
  - Phase 2 Exploration: hidden objects, then passive and secret checks.
  - Phase 3 Immersion: voice narration, NPC voice profiles, hybrid text and voice.
  - Usage tracking and budget controls are built together with voice, not afterwards.
  - Visual fog of war is deferred.
- **Architectural principle:** PostgreSQL is the authoritative campaign state. The AI proposes narration and state changes; the application validates and persists them. Already true for saves, XP (D-014), dice (D-013) and maps (D-018). Every new feature follows it.
- **Each feature still gets its own design agreed before building.** Known conflicts are noted in section 8 so they are decided then, not discovered: inventory checks vs the XP-only decision, passive scores vs XP-only, and stored hidden objects vs maps that are redrawn each time.
- **Backlog, not scheduled:** onboarding step 2 (`/player add`, when a player joins) and hardening (Milestone 5). Cost tracking moves into feature 8.

## D-022: Loot and inventory kept by the bot; party by default

**Date:** 2026-11-10 · **Status:** accepted (user request; amends the XP-only decision of D-014 for items and coins) · **Migration:** `0009_inventory.sql` · **Code:** `src/services/loot.js`, `src/services/inventoryService.js`, `src/db/repositories/inventoryRepository.js`, DM rule 21 (`src/ai/prompts.js`), `/inventory` in `src/discord/commands/registryCommand.js`

**Context.** Before deciding how loot is shared, the group needs to know what it has. The owner wants a common inventory by default. An item goes to one character only when the story says so explicitly. Items were only free-text lines in the saved records (`inventory_and_resources`).

**Decision.**
- **Two kinds of holder.** The party (common, the default) and a single character (only when explicit). Coins are items (`cp`, `sp`, `ep`, `gp`, `pp`).
- **The DM proposes, the code decides** (D-021 principle). DM rule 21: whenever items or coins change hands, the reply ends with a hidden tag:
  - `[[LOOT: +2 healing potion; +35 gp]]` gains, to the party by default
  - `+1 silver dagger -> Kraavok` an explicit keep
  - `-1 healing potion from Kraavok (drank it)` a removal
  - `1 rope: party -> Looming Shade` a move
- **The code checks every change against what is held,** in order. It refuses to remove more than a holder has (so nothing is spent twice) and refuses unknown holders. Accepted changes are shown under the reply ("🎒 Loot: …"); refused ones as "⚠️ Not recorded: … (why)".
- **Built like XP (D-014).** An `inventory_events` ledger on the messages sequence. Each save folds events up to the boundary into the `inventory` partition, so rollback and undo restore it correctly. A loot note is stored with the DM reply.
- **Privacy.**
  - **Party items:** visible everywhere.
  - **Personal items:** secret when gained in a private channel (for example starting gear listed there), seen only by that character and `#dm-testing`. Taken in the open, they are visible to all.
  - **Private channels:** only that character's own items can change. Changes to the party or another character are refused, because the others would learn of them; they happen in `#main-adventure`.
  - **Prompts and save summaries** get the same filtered views (the DM-notes summary sees nothing extra).
- **Starting gear** is recorded on request, as private personal items. The player lists it to the DM in their private channel. Not required.
- **Saved records stop listing items:** the shared and character summaries get `tracked_inventory`, and `inventory_and_resources` now holds only resources and conditions.
- **Commands:**
  - `/inventory` (`/inv`) shows what the channel may see.
  - `/inventory <changes>` in `#dm-testing` makes hand corrections in the tag syntax; `(secret)` marks a private item there.
- **Backfill (2026-11-10, one-off, after a backup).** A model call turned the saved records' item lines into ledger events. Shared record: 8 party items and Kraavok's torch. Private records: nothing new. Events sit after the v32 boundary, so the next save folds them in. **That save must be made by the new code** (see OPERATIONS, 0009).

**Checked (2026-11-10).**
- **Logic test:** 22/22 pure tests: parsing, default holders, refusals, no double spend, private-channel limits, views, secret handover.
- **End-to-end** (real DM model, live data, rolled back): 16/16, no rows left.
  - Loot found together went to the party: 40 gp, 2 potions, the dagger.
  - "Kraavok keeps the dagger" moved it from the party to him, public.
  - Starting gear listed in Kraavok's private channel was recorded secret.
  - Looming's and main's prompts showed party loot and Kraavok's dagger but not his greataxe.
  - The save inputs got the right views, and nothing was saved.

**What to look for in play.**
1. After a find, the "🎒 Loot" line appears and `/inventory` matches.
2. "X keeps it" moves the item to X.
3. Using a potion removes it.
4. Nothing personal from a private channel ever shows in the other player's channel or in main.

## D-023: Canon corrections from an owner summary

**Date:** 2026-11-10 · **Status:** accepted (owner request) · **Versions:** v35, v36 · **Backup:** `dnd_campaign_pre-origins_20261110-072944.dump`

**Context.** The owner wrote a summary of Kraavok's origin story (before the current scene). Nothing stored contradicted it, but much was missing: people, places, NPC memories, the DM's background truth. Without it, NPCs and the DM couldn't act on what had happened.

**Decision.**
- **The method, reusable for later corrections:**
  1. Compare the summary read-only with what is stored, using only the views the owner may see (never another player's private record).
  2. Show the gaps and any conflicts; the owner decides.
  3. Back up the database.
  4. Write one canon correction as a new version (`amendActiveSnapshot`): same timeline and history boundary, so no play is lost, and XP and inventory are untouched. It can be reverted by another correction.
- **Where each kind of content goes:**
  - **Facts the character witnessed:** NPC and place facts with `known_by` that character, plus chronicle events at the start of the chronicle.
  - **What NPCs lived through:** NPC memories (D-016), so NPCs can bring it up in play.
  - **Background truth:** DM notes and NPC author notes.
  - **The character's own record:** a short summary in their knowledge record.
  - **How the character comes across in public:** the shared record (no class, level or inner secrets).
  - **Items:** the character's secret personal inventory (D-022).
- **The current scene is never changed** by a backstory summary.
- **Author notes reach the DM in every channel whose character knows that NPC** (D-007). They must not name things only another character knows; v36 reworded one note for this reason.

**Checked (real DM, rolled back).**
- **Kraavok's private channel:** the DM knows the added origin points, and the secret items show in its inventory.
- **Main:** NPCs recall shared past events; the public "how Kraavok comes across" line is there; no secret items or private names.
- **Looming's prompt:** none of the Kraavok-only names or items, except what the DM said aloud in main, which is public by design (D-010).

## D-024: Briefings to the DM are out of character, even unmarked

**Date:** 2026-11-10 · **Status:** accepted (owner) · **Code:** DM rule 22 (`src/ai/prompts.js`)

**Context.** The owner briefed the DM on past events in his private channel without `(OOC)`. A private channel is the character's own view of the current scene, and the shared record placed Brann, Derren and Ash in the room (rule 17). So the DM read the briefing as Kraavok telling the story aloud, and the NPCs reacted. The next save would have recorded that they heard all of it.

**Decision.**
- **DM rule 22:** a message addressed to the DM about the game counts as out of character even without the mark. That covers a recap or briefing, "here's what happened", a correction, or a question about rules or records.
  - NPCs never hear it, and nothing happens in the scene.
  - The DM acknowledges it briefly.
  - Only words the character says in the scene are heard by those present; when unsure, the DM asks.
- **The two messages of that briefing were moved to an archive timeline** (kept, not used), as a rollback would. Backup: `dnd_campaign_pre-archive-briefing_20261110-074025.dump`. The briefing's content was already added as canon (D-023).

**Checked (real DM, rolled back).** Three unmarked briefings (English, Greek, "just so you have it as DM") got short out-of-character acknowledgements with no NPC reaction. Kraavok speaking aloud to Brann still got Brann's answer.

## D-025: `/help` lists the commands per channel; one pinned message

**Date:** 2026-11-10 · **Status:** accepted (owner) · **Code:** `src/discord/commands/helpCommand.js`

**Context.** Players had no way to find out what the bot can do, apart from the guides. The DM's instructions don't describe the bot's commands, so asking the DM gives a guess.

**Decision.**
- **`/help` (English), `/help gr` or `/βοήθεια` (Greek).** These list the commands that work in the channel where you ask:
  - **#main-adventure:** save, undo and rollback, plus everything else.
  - **Private channels:** the same, without save, undo and rollback.
  - **#dm-testing:** also the DM tools.
- **The list lives in code next to the commands.** Add a line when a player-visible command ships, so it can't drift the way a pinned note would.
- **One short pinned message in #main-adventure, in Greek.** It covers how to play, `(OOC)`, loot going to the party, and private channels, and it points to `/help gr`. No notes per channel.
- **Declined:**
  - Release notes for players, since features change too often.
  - Teaching the DM the command list.

## D-026: Cheaper model for play, usage logging, budget warnings, smaller saves

**Date:** 2026-11-10 · **Status:** accepted (owner) · **Code:** `src/services/usage.js`, `src/config.js`, `WORLD_UPDATE_INSTRUCTIONS` · **Migration:** 0010

**Context.** The OpenAI budget ($15) was used up in two days.
- **Everything ran on gpt-5.4:** turns, saves, maps and image prompts.
- **Each turn sends about 12–17k tokens.** The fixed rules (about 8k characters) are cached by OpenAI. The checkpoint, knowledge, DM notes, NPCs, places and chronicle are not.
- **11-09 was heavy:** 174 replies and 32 saves.
- **Development test runs used the real model.** OpenAI bills those calls even though the database was rolled back.
- **The world update returned the complete NPC and place registries at every save.** That's about 11k output tokens, roughly $0.20 per save for that one call, and close to the 12k output cap, so a save would soon have failed.
- **Nothing tracked the spend.** `MONTHLY_BUDGET_USD` was in `.env`, but no code read it.

**Decision.**
- **Models.** Turns, maps and image prompts use `OPENAI_MODEL=gpt-5.4-mini` (about a third of the price). Saves use `CHECKPOINT_MODEL=gpt-5.4`, because they decide who knows what.
- **Usage logging.** Every call's tokens (input, cached, output, reasoning) and estimated cost go to the console and to `openai_usage`.
- **Budget warnings, never a pause.** A message goes to `#dm-testing` once at 80% and once at 100% of `MONTHLY_BUDGET_USD`.
- **The world update returns only what the history since the last save touches.** That means new or changed NPCs and places, each complete. Omitted entries are kept by `mergeUpdate`, and memories stay append-only. Player characters are never NPCs.
- **`CHECKPOINT_MAX_OUTPUT_TOKENS` default lowered from 12000 to 8000.** A save that doesn't fit still fails safely and saves nothing.
- **Tests from now on use a mocked model by default.** A real call is made only when the change needs one, and said so.
- **Declined for now:** pausing play at the budget, and trimming the prompt blocks (both cost the DM detail).

**Checked (rolled back; real calls on gpt-5.4 for the world update only).**
- **Mocked turn:** a usage row on gpt-5.4-mini with the right estimate.
- **Warnings:** each fires once at 80% and once at 100%, with no repeat.
- **World update with a made-up scene:**
  - **The old instruction** returned 12/12 NPCs and 13/13 places in 10,957 tokens ($0.20).
  - **The first new wording** returned nothing and missed an NPC memory.
  - **The final wording** returned only the NPC who was spoken to (fact and memory added, old facts kept) and the 2 new places, plus 2 events, in 433–753 tokens ($0.02–0.06). Nothing was lost in the merge.

## D-027: Players' dice refused in code; the DM picks the check

**Date:** 2026-11-10 · **Status:** accepted (owner) · **Code:** `isPlayerRoll` in `src/ai/dungeonMaster.js`, DM rules in `src/ai/prompts.js`

**Context.** Two problems in George's play after the switch to gpt-5.4-mini (D-026):
- **Dice:** the DM rolled a player character's dice itself, against the rule in the prompt and in the tool description.
- **Skills:** George named Perception for something that needed Investigation, and the DM went along with it.

**Decision.**
- **Dice are enforced in code, not only by the prompt.** A `roll_dice` request whose label makes a player character the roller is refused.
  - **Refused:** "Looming Shade Perception check", "Kraavok attack roll", "Perception check (Looming Shade)".
  - **Allowed:** a character named only as the target: "Goblin attack vs Kraavok", "Damage to Kraavok".
  - **What happens:** players never see the refused roll. The model is told to ask the player instead, and the console logs `[dice] refused player roll`.
- **Which check applies is the DM's call (PHB 2014, chapter 7).** When a player names a check that doesn't fit, the DM says so in one sentence and asks for the right one before resolving anything.
  - **Perception** is noticing with the senses.
  - **Investigation** is searching for and reasoning from clues.
  - **Insight** reads a person.
  - **No roll** when nothing is at stake.

**Checked.**
- **Label tests:** 10/10.
- **Mocked tool loop:** the player roll is hidden and the refusal is fed back.
- **Real gpt-5.4-mini in `#dm-testing`, nothing stored:**
  - "search the drawers… I use Perception" got "…is Intelligence (Investigation), not Perception: roll Investigation" (in English, and in Greek for a lock).
  - "stand watch… Perception?" was accepted.
  - No dice were rolled for the player in any case.

## D-028: A narration style rule for the DM

**Date:** 2026-11-10 · **Status:** accepted (owner) · **Code:** DM rules in `src/ai/prompts.js`

**Context.** After the switch to gpt-5.4-mini (D-026) play got fast, but the narration got thin. The DM rules said nothing about style or length, and gpt-5.4 had been rich on its own.

**Decision.** Add a narration style rule, and keep `OPENAI_MODEL=gpt-5.4-mini`.
- **On a scene change, or when something new comes into view:** two or three short paragraphs with sensory detail, what the NPCs are doing and how they speak, and one or two details worth interacting with.
- **Quick exchanges:** a few sentences. OOC answers stay brief.
- **Always:** no padding, never decide for the players, and end on what they can act on.

**Compared (same main-adventure turn, rolled back; samples shown to the owner).**

| Variant | Words | Cost per turn |
| --- | --- | --- |
| A. mini as before | 160 | about $0.01 |
| B. mini with the rule (chosen) | 205 | about $0.01, the same |
| C. gpt-5.6-luna with the rule | 112 | cheapest, plain |
| D. gpt-5.6-terra with the rule | 132 | about 3x |

- **A** was list-like.
- **B** had atmospheric sensory detail.
- **D** was the most evocative and asked for a check on its own.

If B feels thin after a session, change `OPENAI_MODEL=gpt-5.6-terra` and add its price to `src/services/usage.js`.

## D-029: Player characters' aliases are public names

**Date:** 2026-11-10 · **Status:** accepted (fix) · **Code:** DM rule 16 and the shared checkpoint instructions in `src/ai/prompts.js`

**Context.** A player character gave a cover name in shared play, and the other player kept using it. Asked about the character by that name in the main channel, the DM (gpt-5.4-mini) said the name "hadn't appeared publicly" and treated it as a secret. The save had stored it vaguely ("gave the name X during conversation"), and rule 12 (a shared channel only sees what everyone may know) pushed the model towards caution.

**Decision.**

- Rule 16 now says a name a character gives in play is a name others may call them by. A reference by that name means that character; never treat it as unknown or secret.
- The shared checkpoint keeps one plain known_fact per alias ("Known to the others as 'X'").

**Checked.** The same question replayed in the main channel (rolled back) was answered about the right character.

## D-030: A pacing rule for the DM

**Date:** 2026-11-10 · **Status:** accepted (owner asked) · **Code:** DM rules in `src/ai/prompts.js`

**Context.** On gpt-5.4-mini the DM ended most replies with a menu of options ("you can go on or stop and look") or chatbot offers ("if you want, I can write you a map"), asked whether to continue when nothing was at stake, and never followed up hints the players ignored. D-028's "end on what they can act on" made the menus worse.

**Decision.** That phrase is removed. A pacing rule now says:

- no options menus and no service offers; end on the situation, an NPC, or "What do you do?" when a real decision is pending;
- when nothing is at stake, move forward, compress uneventful travel and arrive somewhere that matters, inventing what lies ahead if it isn't established;
- an ignored hint either has its consequence narrated now or is dropped for good;
- never ask permission to continue.

**Checked.** Three chained "we press on" turns in the main channel (rolled back): no menus or offers. The DM moved on and reached a room by the third turn. Mini is still cautious about inventing; if it stays flat, the next step is a stronger model for turns (D-028).
