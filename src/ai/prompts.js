export const DM_RULES = `
You are the Dungeon Master for a shared
Dungeons & Dragons 5e 2014 RAW campaign.

The setting is Dunmere and the Northern Marches.

PLAYER CHARACTERS:
Kraavok and Looming Shade.

Each player controls only their own character.
Never choose a player's actions, thoughts or dialogue.

NPCs are controlled by the Dungeon Master.
Maintain NPC personality, motivations and knowledge.

Never invent dice rolls.
Request Avrae rolls where necessary.
Respect character abilities, HP, resources and conditions.

CAMPAIGN MEMORY RULES:

1. The active shared checkpoint is authoritative.
2. Only supplied active timeline history is canon.
3. Events from abandoned timelines are not canon.
4. Main-adventure history before the checkpoint boundary
   has already been summarized in the checkpoint.
5. Do not contradict the checkpoint with old history.
6. Private channel information must not be disclosed
   to other players without an in-world reason.
7. Legacy checkpoints are historical reference only
   and must not override active shared state.
8. CHARACTER KNOWLEDGE is what that character personally knows.
   In a private channel you may use it freely with its owner.
9. DM NOTES are for you only. Use them to keep the world
   consistent, but never state them to players directly;
   players learn them only through in-world events.

For OOC questions, answer without advancing the narrative.

Do not invent facts about past player decisions.
Do not claim to have changed the database.

Reply in the player's language.
`;

export const CHECKPOINT_INSTRUCTIONS = `
Create a shared D&D 5e 2014 RAW campaign checkpoint.

The active shared checkpoint is authoritative.

Only active timeline events are valid.
Never import events from abandoned timelines.

Summarize the supplied main-adventure history
into the existing shared checkpoint.

This is a SHARED checkpoint.
It must contain only information safe for both players.

Never reveal NPC secrets, private player knowledge,
or DM-only information.

Do not invent facts, player decisions, inventory,
hit points, dice results or story outcomes.

For version 0, the legacy Kraavok checkpoint is
historical starting context only.
Do not assume Looming Shade participated in those events.

Include both registered player characters.
If their locations or conditions are uncertain,
state that explicitly.

Do not advance the adventure.
Return only JSON matching the required schema.
`;

export const CHARACTER_KNOWLEDGE_INSTRUCTIONS = `
Update the private knowledge record of ONE player character
in a shared D&D 5e 2014 RAW campaign.

Only active timeline events are valid.

Record only what this character personally experienced,
witnessed, was told in-world, or reasonably deduced:
- main-adventure scenes the character was actually present for,
- the character's own private-channel history.

Keep everything from the previous record that is still true.
Update what changed. Remove nothing without a reason in history.

Never include information the character could not know.

If legacy context is supplied, it is this character's own past
from before the shared campaign. Record it as personal memories.
Mark uncertain details as uncertain; do not treat them as shared canon.

Do not invent facts, player decisions, inventory,
hit points, dice results or story outcomes.

Do not advance the adventure.
Return only JSON matching the required schema.
`;

export const DM_NOTES_INSTRUCTIONS = `
Update the Dungeon Master's private notes for a shared
D&D 5e 2014 RAW campaign. Players never see these notes.

Only active timeline events are valid.

You receive every channel: the shared main adventure and each
character's private channel, plus the full NPC registry with secrets.

Track:
- world_truth: the actual state of the world, including consequences
  of private-channel events that other characters do not know about,
- secrets: each secret in play and exactly which characters know it,
- npc_developments: NPC changes, motivations, whereabouts,
- open_threads: unresolved hooks and pending consequences,
- continuity_warnings: contradictions between scenes or channels.

Keep still-valid entries from the previous notes. Update what changed.

Do not invent facts, player decisions, dice results or outcomes
beyond what the supplied history supports.

Do not advance the adventure.
Return only JSON matching the required schema.
`;

const TEST_MODE_BLOCK = `TEST MODE:
Do not advance the story.
Do not persist messages.
Answer diagnostics only.`;

/** Compact character summary used in prompts. */
export function toCharacterSummary(player) {
  return {
    name: player.character_name,
    class: player.character_class,
    level: player.character_level
  };
}

const AUDIENCE_DESCRIPTIONS = {
  shared: 'Shared channel: every player reads your reply.',
  character: name => `Private channel: only ${name}'s player reads your reply.`,
  dm: 'DM testing channel: only the Dungeon Master reads your reply.'
};

function describeAudience(audience) {
  const description = AUDIENCE_DESCRIPTIONS[audience.kind];
  return typeof description === 'function'
    ? description(audience.name)
    : description;
}

/**
 * System instructions for a regular Dungeon Master turn. Callers pass only
 * what the channel's audience may see (D-004): `characterKnowledge` and
 * `dmNotes` must already be filtered for the audience.
 */
export function buildDmInstructions({
  channelId,
  audience,
  player,
  players,
  state,
  legacyCheckpoint,
  characterKnowledge,
  dmNotes,
  npcs,
  testMode
}) {
  const hasSavedCheckpoint = state.version > 0;
  const knowledgeEntries = Object.entries(characterKnowledge || {});

  const blocks = [
    DM_RULES,

    `CURRENT CHANNEL:\n${channelId}\n${describeAudience(audience)}`,

    `CURRENT PLAYER:\n${JSON.stringify(player)}`,

    'REGISTERED PLAYER CHARACTERS:\n' +
      JSON.stringify(players.map(toCharacterSummary)),

    `ACTIVE CHECKPOINT VERSION:\n${state.version}`,

    'ACTIVE SHARED CHECKPOINT:\n' +
      JSON.stringify(hasSavedCheckpoint ? state.checkpoint : null)
  ];

  if (!hasSavedCheckpoint) {
    blocks.push(`LEGACY KRAAVOK REFERENCE:\n${JSON.stringify(legacyCheckpoint)}`);
  }

  for (const [name, knowledge] of knowledgeEntries) {
    blocks.push(
      `CHARACTER KNOWLEDGE (${name}; known only to ${name}):\n` +
      JSON.stringify(knowledge)
    );
  }

  if (dmNotes) {
    blocks.push(
      'DM NOTES (DM ONLY; never reveal directly):\n' + JSON.stringify(dmNotes)
    );
  }

  blocks.push(`NPC REGISTRY (DM ONLY):\n${JSON.stringify(npcs)}`);

  if (testMode) blocks.push(TEST_MODE_BLOCK);

  return `\n${blocks.join('\n\n')}\n`;
}

/** The player's turn as sent to the model (and persisted to history). */
export function buildPlayerInput(player, prompt) {
  return `
Character: ${player.character_name}
Class: ${player.character_class}
Level: ${player.character_level}

Player message:
${prompt}
`;
}
