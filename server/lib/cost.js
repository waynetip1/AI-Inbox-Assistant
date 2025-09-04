// server/lib/cost.js
/**
 * Estimate USD cost from prompt/completion tokens.
 * Env overrides (USD per 1K tokens):
 *  - PROMPT_COST_PER_1K (default 0.005)
 *  - COMPLETION_COST_PER_1K (default 0.015)
 *
 * @param {object} params
 * @param {number} params.promptTokens
 * @param {number} params.completionTokens
 * @returns {{ cost: number, unitPrices: { promptPer1K:number, completionPer1K:number } }}
 */
export function estimateCostUSD({ promptTokens = 0, completionTokens = 0 } = {}) {
  const promptPer1K = Number(process.env.PROMPT_COST_PER_1K ?? 0.005);
  const completionPer1K = Number(process.env.COMPLETION_COST_PER_1K ?? 0.015);

  if (!Number.isFinite(promptTokens)) promptTokens = 0;
  if (!Number.isFinite(completionTokens)) completionTokens = 0;

  const cost =
    (promptTokens / 1000) * promptPer1K +
    (completionTokens / 1000) * completionPer1K;

  return {
    cost: Math.round(cost * 10000) / 10000, // 4dp
    unitPrices: { promptPer1K, completionPer1K },
  };
}
