import { openai } from './openaiClient.js';
import { IMAGE_PROMPT_INSTRUCTIONS } from './prompts.js';
import { config } from '../config.js';

const MAX_PROMPT_TOKENS = 300;

/** Settings sent to the image API (gpt-image family). */
export function imageSettings() {
  const { model, size, quality } = config.images;
  return { model, size, quality };
}

/**
 * Turns audience-safe scene material into an image prompt (cheap text
 * call), then prepends the configured house style (D-008).
 */
export async function buildImagePrompt(material) {
  const result = await openai.responses.create({
    model: config.openai.model,
    instructions: IMAGE_PROMPT_INSTRUCTIONS,
    input: [{ role: 'user', content: JSON.stringify(material) }],
    max_output_tokens: MAX_PROMPT_TOKENS
  });

  const scene = result.output_text?.trim();
  if (!scene) throw new Error('OpenAI returned no image prompt');

  return `${config.images.style} ${scene}`;
}

/** Generates one JPEG image. Returns a Buffer. */
export async function generateImage(prompt) {
  const result = await openai.images.generate({
    ...imageSettings(),
    prompt,
    n: 1,
    output_format: 'jpeg'
  });

  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new Error('Image API returned no image data');

  return Buffer.from(b64, 'base64');
}
