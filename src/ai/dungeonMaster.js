import { openai } from './openaiClient.js';
import {
  characterKnowledgeSchema,
  checkpointSchema,
  dmNotesSchema,
  worldUpdateSchema
} from './checkpointSchema.js';
import {
  CHARACTER_KNOWLEDGE_INSTRUCTIONS,
  CHECKPOINT_INSTRUCTIONS,
  DM_NOTES_INSTRUCTIONS,
  MAP_INSTRUCTIONS,
  WORLD_UPDATE_INSTRUCTIONS
} from './prompts.js';
import { sceneMapSchema } from './mapSchema.js';
import { config } from '../config.js';
import { rollDice } from '../services/dice.js';

const EMPTY_RESPONSE = 'The Dungeon Master did not generate a response.';

// Monster/NPC dice (D-013): the model requests rolls, the code rolls them.
const ROLL_DICE_TOOL = {
  type: 'function',
  name: 'roll_dice',
  description:
    'Roll dice for monsters, NPCs and the environment (attacks, damage, ' +
    'saving throws, checks, initiative). Never use it for player characters; ' +
    'players roll their own dice. Returns real results.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      rolls: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description: 'Who and what, e.g. "Goblin 1 scimitar attack"'
            },
            dice: {
              type: 'string',
              description:
                'Dice expression with modifiers, e.g. "1d20+4", "1d6+2", ' +
                '"2d20kh1+4" (advantage), "2d20kl1+4" (disadvantage)'
            }
          },
          required: ['label', 'dice'],
          additionalProperties: false
        }
      }
    },
    required: ['rolls'],
    additionalProperties: false
  }
};

const MAX_TOOL_ROUNDS = 3;

function runRollCall(call) {
  let requested = [];
  try {
    requested = JSON.parse(call.arguments).rolls || [];
  } catch {
    // fall through with no rolls
  }

  return requested.map(({ label, dice }) => {
    try {
      return { label, ...rollDice(dice) };
    } catch (error) {
      return { label, expression: dice, error: error.message };
    }
  });
}

/**
 * Generates a narrative reply. The model may call `roll_dice` for monsters
 * and NPCs; each call is rolled here and fed back before it narrates.
 * Returns `{ id, text, rolls }`.
 */
export async function generateDmReply({ instructions, input }) {
  const conversation = [...input];
  const rolls = [];

  for (let round = 0; ; round++) {
    const result = await openai.responses.create({
      model: config.openai.model,
      instructions,
      input: conversation,
      tools: [ROLL_DICE_TOOL],
      // Last round: no more tools, so the model must narrate.
      tool_choice: round < MAX_TOOL_ROUNDS ? 'auto' : 'none',
      max_output_tokens: config.openai.maxOutputTokens
    });

    const calls = (result.output || []).filter(item => item.type === 'function_call');

    if (!calls.length) {
      return {
        id: result.id,
        text: result.output_text?.trim() || EMPTY_RESPONSE,
        rolls
      };
    }

    conversation.push(...result.output);

    for (const call of calls) {
      const results = call.name === 'roll_dice' ? runRollCall(call) : [];
      rolls.push(...results);
      conversation.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify({ results })
      });
    }
  }
}

/** One strict-JSON summarization call. `context` is serialized as input. */
async function generateStructured({ name, schema, instructions, context }) {
  const result = await openai.responses.create({
    model: config.openai.model,
    instructions,
    input: [{ role: 'user', content: JSON.stringify(context) }],
    text: {
      format: { type: 'json_schema', name, strict: true, schema }
    },
    max_output_tokens: config.openai.checkpointMaxOutputTokens
  });

  if (result.status === 'incomplete') {
    const reason = result.incomplete_details?.reason || 'unknown reason';
    throw new Error(
      `${name} was cut off (${reason}). ` +
      'Raise CHECKPOINT_MAX_OUTPUT_TOKENS and save again; nothing was saved.'
    );
  }

  if (!result.output_text) {
    throw new Error(`OpenAI returned no JSON for ${name}`);
  }

  return JSON.parse(result.output_text);
}

/** Shared checkpoint. Context must contain only shared-safe information. */
export function generateSharedCheckpoint(context) {
  return generateStructured({
    name: 'campaign_checkpoint',
    schema: checkpointSchema,
    instructions: CHECKPOINT_INSTRUCTIONS,
    context
  });
}

/** One character's private knowledge. Context: that character's view only. */
export function generateCharacterKnowledge(context) {
  return generateStructured({
    name: 'character_knowledge',
    schema: characterKnowledgeSchema,
    instructions: CHARACTER_KNOWLEDGE_INSTRUCTIONS,
    context
  });
}

/** DM-only notes. Context may contain everything. */
export function generateDmNotes(context) {
  return generateStructured({
    name: 'dm_notes',
    schema: dmNotesSchema,
    instructions: DM_NOTES_INSTRUCTIONS,
    context
  });
}

/** Scene sketch for /map (D-018). Context: the channel's own view only. */
export function generateSceneMap(context) {
  return generateStructured({
    name: 'scene_map',
    schema: sceneMapSchema,
    instructions: MAP_INSTRUCTIONS,
    context
  });
}

/**
 * World update at save: complete NPC + location registries and new events.
 * Context may contain everything. Returns { npcs, locations, events }.
 */
export function generateWorldUpdate(context) {
  return generateStructured({
    name: 'world_update',
    schema: worldUpdateSchema,
    instructions: WORLD_UPDATE_INSTRUCTIONS,
    context
  });
}
