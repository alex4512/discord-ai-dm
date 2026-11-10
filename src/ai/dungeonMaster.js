import { openai } from './openaiClient.js';
import {
  characterKnowledgeSchema,
  checkpointSchema,
  dmNotesSchema,
  worldUpdateSchema
} from './checkpointSchema.js';
import {
  CHAPTER_INSTRUCTIONS,
  CHARACTER_KNOWLEDGE_INSTRUCTIONS,
  CHECKPOINT_INSTRUCTIONS,
  DM_NOTES_INSTRUCTIONS,
  MAP_INSTRUCTIONS,
  STORY_INSTRUCTIONS,
  WORLD_UPDATE_INSTRUCTIONS
} from './prompts.js';
import { sceneMapSchema } from './mapSchema.js';
import { config } from '../config.js';
import { rollDice } from '../services/dice.js';
import { recordUsage } from '../services/usage.js';

const STORY_MAX_OUTPUT_TOKENS = 4000;
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

const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Words that make the character the target, not the roller: "Goblin attack vs Kraavok".
const TARGET_WORDS = /\b(vs\.?|versus|against|on|at|to|targets?|targeting|hits?)\b/i;

/**
 * True if a roll label is a player character's own roll (their check, save,
 * attack or damage). Players roll their own dice (D-013, D-027), so these are
 * refused in code. A character named only as the target is fine.
 */
export function isPlayerRoll(label, playerNames = []) {
  for (const name of playerNames) {
    const first = name.split(/\s+/)[0];
    const pattern = new RegExp(`\\b(${escapeRegExp(name)}|${escapeRegExp(first)})\\b`, 'i');
    const match = pattern.exec(label || '');
    if (match && !TARGET_WORDS.test(label.slice(0, match.index))) return true;
  }
  return false;
}

function runRollCall(call, playerNames) {
  let requested = [];
  try {
    requested = JSON.parse(call.arguments).rolls || [];
  } catch {
    // fall through with no rolls
  }

  return requested.map(({ label, dice }) => {
    if (isPlayerRoll(label, playerNames)) {
      return {
        label,
        refused: true,
        error: 'Not rolled: that is a player character\'s roll. Players roll their own dice. ' +
          'Ask the player for this roll (ability and skill, and the DC if relevant) and wait for their result.'
      };
    }
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
export async function generateDmReply({ instructions, input, playerNames = [] }) {
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
    await recordUsage({ kind: 'turn', model: config.openai.model, usage: result.usage });

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
      const results = call.name === 'roll_dice' ? runRollCall(call, playerNames) : [];
      // Refused player rolls go back to the model only; players never see them.
      rolls.push(...results.filter(r => !r.refused));
      for (const r of results.filter(r => r.refused)) console.log(`[dice] refused player roll: ${r.label}`);
      conversation.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify({ results })
      });
    }
  }
}

/** One strict-JSON summarization call. `context` is serialized as input. */
async function generateStructured({ name, schema, instructions, context, model = config.openai.checkpointModel }) {
  const result = await openai.responses.create({
    model,
    instructions,
    input: [{ role: 'user', content: JSON.stringify(context) }],
    text: {
      format: { type: 'json_schema', name, strict: true, schema }
    },
    max_output_tokens: config.openai.checkpointMaxOutputTokens
  });
  await recordUsage({ kind: name, model, usage: result.usage });

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
    context,
    model: config.openai.model
  });
}

/**
 * The story so far for /story (D-031). Plain prose on the turn model.
 * `lang` is 'gr' for Greek, otherwise English.
 */
export async function generateStory({ context, lang = 'en' }) {
  const model = config.openai.model;
  const language = lang === 'gr' ? 'Greek' : 'English';
  const result = await openai.responses.create({
    model,
    instructions: `${STORY_INSTRUCTIONS}\nWrite it in ${language}.`,
    input: [{ role: 'user', content: JSON.stringify(context) }],
    max_output_tokens: STORY_MAX_OUTPUT_TOKENS
  });
  await recordUsage({ kind: 'story', model, usage: result.usage });
  return result.output_text?.trim() || EMPTY_RESPONSE;
}

const chapterSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { title: { type: 'string' }, summary: { type: 'string' } },
  required: ['title', 'summary']
};

/** One chapter summary of consecutive chronicle events (D-033), on the save model. */
export function generateChapter(context) {
  return generateStructured({
    name: 'chronicle_chapter',
    schema: chapterSchema,
    instructions: CHAPTER_INSTRUCTIONS,
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
