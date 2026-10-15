// What model calls cost, for Agents' per-agent "≈" figures and Cache Tax. USD per million tokens,
// from the Claude API price list (platform.claude.com/docs/en/about-claude/pricing), checked
// 2026-10-12. The engine reports tokens, not money: session totals come from `$.session.usage()`.

export type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/** Input, output, cache read, cache write (5-minute). */
type Price = [number, number, number, number]

/** Most specific first. `null`: not in the table, so the cost shows "?". */
const PRICES: [RegExp, Price][] = [
  [/fable-5-1|mythos-5-1/, [10, 50, 0.25, 12.5]],
  [/fable|mythos/, [10, 50, 1, 12.5]],
  [/opus-5-5/, [4, 20, 0.2, 5]],
  [/opus-(5|4-[5-8])(?!\d)/, [5, 25, 0.5, 6.25]],
  [/opus-4/, [15, 75, 1.5, 18.75]],
  [/sonnet-5-5/, [2, 10, 0.1, 2.5]],
  [/sonnet-5(?!-\d)/, [2, 10, 0.2, 2.5]],
  [/sonnet-4/, [3, 15, 0.3, 3.75]],
  [/haiku-4-5/, [1, 5, 0.1, 1.25]],
  [/haiku-3-5/, [0.8, 4, 0.08, 1]],
]

/** Haiku 5.5 costs more for prompts over 100,000 tokens. */
const HAIKU_5_5: { small: Price; large: Price } = { small: [0.1, 0.5, 0.01, 0.125], large: [0.5, 2.5, 0.05, 0.625] }

const promptTokens = (usage: Usage) =>
  (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)

export function priceOf(model: string, usage: Usage = {}): Price | null {
  const id = model.toLowerCase()
  if (/haiku-5-5|^haiku$/.test(id)) return promptTokens(usage) > 100_000 ? HAIKU_5_5.large : HAIKU_5_5.small
  return PRICES.find(([pattern]) => pattern.test(id))?.[1] ?? null
}

/** One request's cost, or null for a model the table doesn't know. */
export function costOf(model: string, usage: Usage): number | null {
  const price = priceOf(model, usage)
  if (!price) return null
  const [input, output, read, write] = price
  return ((usage.input_tokens ?? 0) * input + (usage.output_tokens ?? 0) * output +
    (usage.cache_read_input_tokens ?? 0) * read + (usage.cache_creation_input_tokens ?? 0) * write) / 1e6
}

/** Every token a request counted. */
export const tokensOf = (usage: Usage) => promptTokens(usage) + (usage.output_tokens ?? 0)

/** The context window, for "ctx %" (≈): Haiku 200k, the rest 1M. */
export const windowOf = (model: string) => (/haiku/i.test(model) ? 200_000 : 1_000_000)

/** "claude-opus-5-5" → "Opus 5.5". */
export function modelName(id: string): string {
  const match = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  const [, family = '', major = '', minor] = match ?? []
  if (!family) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '—'
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? `.${minor}` : ''}`
}

/**
 * Cache Tax's three rates for a model, USD per million tokens: input, a cache read, and a cache
 * write for the cache's lifetime (5 minutes: 1.25 × input; 1 hour: 2 × input). Null: unknown model.
 */
export function cacheRates(model: string, ttl: '5m' | '1h', usage: Usage = {}): { input: number; output: number; read: number; write: number } | null {
  const price = priceOf(model, usage)
  if (!price) return null
  const [input, output, read, write5m] = price
  return { input, output, read, write: ttl === '5m' ? write5m : input * 2 }
}
