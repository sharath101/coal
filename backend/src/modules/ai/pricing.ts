/**
 * What a model call costs, in US dollars per million tokens, by model family. ⚠ Starting values
 * (AI11): they set each person's daily budget and are never shown as a bill. Cached tokens are
 * counted as ordinary input, which overestimates a little: the budget errs on the safe side.
 */
const PER_MILLION = {
  haiku: { input: 1, output: 5 },
  sonnet: { input: 3, output: 15 },
  opus: { input: 5, output: 25 },
} as const;

export function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const family = /haiku/i.test(model) ? 'haiku' : /opus/i.test(model) ? 'opus' : 'sonnet';
  const price = PER_MILLION[family];
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
