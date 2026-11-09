import { openai } from './openaiClient.js';
import { checkpointSchema } from './checkpointSchema.js';
import { CHECKPOINT_INSTRUCTIONS } from './prompts.js';
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

/** Summarizes campaign context into a checkpoint object matching the schema. */
export async function generateCheckpoint(context) {
  const result = await openai.responses.create({
    model: config.openai.model,
    instructions: CHECKPOINT_INSTRUCTIONS,
    input: [{ role: 'user', content: JSON.stringify(context) }],
    text: {
      format: {
        type: 'json_schema',
        name: 'campaign_checkpoint',
        strict: true,
        schema: checkpointSchema
      }
    },
    max_output_tokens: config.openai.checkpointMaxOutputTokens
  });

  if (!result.output_text) {
    throw new Error('OpenAI returned no checkpoint JSON');
  }

  return JSON.parse(result.output_text);
}
