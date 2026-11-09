import { openai } from './openaiClient.js';
import {
  characterKnowledgeSchema,
  checkpointSchema,
  dmNotesSchema,
  npcUpdateSchema
} from './checkpointSchema.js';
import {
  CHARACTER_KNOWLEDGE_INSTRUCTIONS,
  CHECKPOINT_INSTRUCTIONS,
  DM_NOTES_INSTRUCTIONS,
  NPC_UPDATE_INSTRUCTIONS
} from './prompts.js';
import { config } from '../config.js';

const EMPTY_RESPONSE = 'The Dungeon Master did not generate a response.';

/** Generates a narrative reply. Returns `{ id, text }`. */
export async function generateDmReply({ instructions, input }) {
  const result = await openai.responses.create({
    model: config.openai.model,
    instructions,
    input,
    max_output_tokens: config.openai.maxOutputTokens
  });

  return {
    id: result.id,
    text: result.output_text?.trim() || EMPTY_RESPONSE
  };
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

/** Full NPC registry update. Context may contain everything. */
export async function generateNpcUpdate(context) {
  const result = await generateStructured({
    name: 'npc_update',
    schema: npcUpdateSchema,
    instructions: NPC_UPDATE_INSTRUCTIONS,
    context
  });
  return result.npcs;
}
