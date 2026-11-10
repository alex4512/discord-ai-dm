import { pool } from '../db/pool.js';
import { config } from '../config.js';

// USD per 1M tokens (input, cached input, output). From third-party price
// lists, 2026-11-10; check OpenAI's pricing page if they change. Unknown
// models are logged with a cost of 0 and a warning.
const PRICES = {
  'gpt-5.4': { input: 2.5, cached: 0.25, output: 15 },
  'gpt-5.4-mini': { input: 0.75, cached: 0.075, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, cached: 0.02, output: 1.25 }
};

const WARN_AT = [0.8, 1];

let notify = async () => {};

/** Where budget warnings go (set at startup: a message to #dm-testing). */
export function setBudgetNotifier(fn) {
  notify = fn;
}

function priceOf(model) {
  return PRICES[model] || PRICES[model.replace(/-\d{4}-\d{2}-\d{2}$/, '')] || null;
}

/** Estimated USD for one Responses API `usage` object. */
export function estimateCost(model, usage = {}) {
  const price = priceOf(model);
  if (!price) return 0;
  const input = usage.input_tokens || 0;
  const cached = usage.input_tokens_details?.cached_tokens || 0;
  const output = usage.output_tokens || 0;
  return ((input - cached) * price.input + cached * price.cached + output * price.output) / 1e6;
}

export async function monthToDate(guildId = config.discord.guildId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(est_usd), 0)::float AS usd FROM public.openai_usage
      WHERE guild_id = $1 AND created_at >= date_trunc('month', NOW())`,
    [guildId]
  );
  return rows[0].usd;
}

/**
 * Logs and stores one call's usage, then warns once when the month's
 * estimate crosses 80% and 100% of MONTHLY_BUDGET_USD. Play is never
 * blocked, and a failure here never fails the call that was tracked.
 */
export async function recordUsage({ kind, model, usage = {}, images = 0 }) {
  try {
    const guildId = config.discord.guildId;
    const estUsd = estimateCost(model, usage) + images * config.budget.imageCostUsd;
    const row = {
      input: usage.input_tokens || 0,
      cached: usage.input_tokens_details?.cached_tokens || 0,
      output: usage.output_tokens || 0,
      reasoning: usage.output_tokens_details?.reasoning_tokens || 0
    };

    if (!priceOf(model) && !images) console.warn(`[usage] no price for model ${model}; counted as $0`);
    console.log(
      `[usage] ${kind} ${model} in=${row.input} cached=${row.cached} out=${row.output}` +
      (row.reasoning ? ` reasoning=${row.reasoning}` : '') +
      (images ? ` images=${images}` : '') + ` ~$${estUsd.toFixed(4)}`
    );

    const before = await monthToDate(guildId);
    await pool.query(
      `INSERT INTO public.openai_usage
         (guild_id, kind, model, input_tokens, cached_tokens, output_tokens, reasoning_tokens, images, est_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [guildId, kind, model, row.input, row.cached, row.output, row.reasoning, images, estUsd]
    );

    const budget = config.budget.monthlyUsd;
    if (!budget) return;
    const after = before + estUsd;
    for (const share of WARN_AT) {
      if (before < budget * share && after >= budget * share) {
        await notify(
          `⚠️ OpenAI budget: about $${after.toFixed(2)} of $${budget} this month (${Math.round(share * 100)}%, bot's estimate). ` +
          'Play continues. Check the real bill on the OpenAI dashboard.'
        );
      }
    }
  } catch (error) {
    console.error('[usage] could not record usage:', error.message);
  }
}
