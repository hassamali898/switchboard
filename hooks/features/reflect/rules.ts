// Reflect: which messages to check, the model's instructions, reading its answer, and writing a rule
// into CLAUDE.md. Pure.
// Ported from claude-reflect's mod (mod/hooks/register.tsx, v3.3.0), MIT License, Copyright (c) 2025
// Bayram Annakov: the trivial and secret checks, ordered word-pair similarity, `remember:`, the rule
// cleaning, the classifier prompt and the marked section. Changed: our markers, the rule written in
// the language the user used (BUILD_PLAN.md decision 8), and `this project` in a `remember:`.

/** Longer messages are task briefs and pastes, not corrections (unless they say "remember:"). */
export const MAX_PROMPT = 500
export const MAX_RULE = 200
/** Two rules this alike (ordered word pairs) are the same rule. */
export const SAME = 0.6
/** A bullet this alike already in CLAUDE.md: nothing is written. */
export const IN_FILE = 0.8

export const START = '<!-- switchboard: learned rules (edit freely) -->'
export const END = '<!-- end switchboard -->'

/** Your own messages: typed, or sent through Remote Control. Plugins, the SDK, peers and schedules aren't you. */
export const HUMAN = new Set(['composer', 'bridge'])

/** Acknowledgements and go-aheads: nothing to learn, so no model call. */
const TRIVIAL =
  /^(y|yes|yep|ok|okay|k|go|go on|go ahead|continue|proceed|next|done|thanks|thank you|ty|great|nice|cool|lgtm|sure|fine|da|да|ок|окей|ага|го|давай|дальше|продолжай|спасибо|отлично|sí|si|oui|ja|haan|han|theek|ٹھیک|جی|ہاں|\d{1,3})[\s.!)]*$/i

const SECRET = [
  /\b(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs]|glpat)[-_][A-Za-z0-9_-]{8,}/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // a JWT
  /(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}/, // a long token: letters and digits, no path or dots
  /(password|passwd|passphrase|secret|token|api[ _-]?key|пароль|токен|ключ)\s*(\bis\b|:|=)\s*\S{4,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]

export const looksSecret = (text: string) => SECRET.some(pattern => pattern.test(text))
export const isTrivial = (text: string) => TRIVIAL.test(text.trim())

/** `remember: <rule>`: the rule as typed, and whether it names this project. */
export function remembered(text: string): { rule: string; isProject: boolean } | undefined {
  const told = /^\s*remember\s*:\s*([\s\S]+)$/i.exec(text)?.[1]?.trim()
  if (told === undefined) return undefined
  const isProject = /\b(this|the) (project|repo|repository)\b/i.test(told)
  return { rule: told.replace(/\s*\(?\b(for |in )?(this|the) (project|repo|repository)\b\)?\s*$/i, '').trim() || told, isProject }
}

/** Whether a message you sent is worth checking at all (cheap, before any model call). */
export function isCandidate(text: string, origin: string): boolean {
  const trimmed = text.trim()
  return HUMAN.has(origin) && !trimmed.startsWith('/') && !isTrivial(trimmed) && !looksSecret(trimmed) &&
    (trimmed.length <= MAX_PROMPT || remembered(trimmed) !== undefined)
}

/** Ordered word pairs, short words kept: "pnpm, not npm" and "npm, not pnpm" share none. */
export function pairs(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}+#.\s]/gu, ' ').split(/\s+/).filter(Boolean)
  const out = new Set<string>()
  if (words.length === 1) out.add(words[0] ?? '')
  for (let i = 0; i + 1 < words.length; i++) out.add(`${words[i]} ${words[i + 1]}`)
  return out
}

/** Overlap of two rules' ordered word pairs: 1 the same, 0 nothing in common. */
export function similarity(a: string, b: string): number {
  const x = pairs(a)
  const y = pairs(b)
  if (!x.size || !y.size) return 0
  let both = 0
  for (const pair of x) if (y.has(pair)) both++
  return both / (x.size + y.size - both)
}

/** The one check every rule passes before it is kept or written, whoever wrote it. */
export function cleanRule(raw: string): string | undefined {
  const rule = raw.trim().replace(/^[-*]\s+/, '').replace(/^["“']|["”']$/g, '').trim()
  if (!rule || rule.length > MAX_RULE) return undefined
  if (/[\r\n\u0000-\u001f\u007f]/.test(rule) || rule.includes('<!--') || rule.includes('-->')) return undefined
  if (looksSecret(rule)) return undefined
  return rule
}

export type Verdict = { isRule: boolean; rule: string; scope: 'global' | 'project'; confidence: number }

const PROJECT_WORDS = /\s*\b(?:(?:in|for|on|of)\s+)?(?:this|the|our) (?:project|repo|repository|codebase|app)\b|\s+here\b|\s*\bin this folder\b/gi
const GLOBAL_WORDS = /\b(every|all|any) (project|repo|repositor(y|ies))s?\b|\beverywhere\b|\bglobally\b|\bin general\b/i

/** Sentences of a message, without trailing punctuation clutter. */
const sentences = (text: string) => text.split(/(?<=[.!;])\s+|\n+/).map(one => one.trim()).filter(Boolean)

/**
 * A standing rule in what you wrote, found on this computer with no model call (zero tokens): "always ...",
 * "never ...", "don't ...", "stop ...", "use X instead of Y", "prefer X over Y", "from now on ...".
 * Questions and one-off redirects ("wrong file", "try again") are left alone. You still approve every
 * rule on the card, so a miss costs a click, never a wrong rule.
 */
export function correction(text: string): Verdict | undefined {
  for (const raw of sentences(text)) {
    const sentence = raw.replace(/^[-–—*\s]+/, '').replace(/^(no|nope|actually|wait|ok|okay|hey|please|pls)[-–—,!.\s]+/i, '').replace(/^please\s+/i, '').trim()
    if (sentence.endsWith('?') || sentence.length < 10) continue
    let rule = ''
    let match: RegExpExecArray | null
    if ((match = /^from now on,?\s+(.+)$/i.exec(sentence))) rule = match[1]!
    else if ((match = /(?:^|\b(?:we|you|i|to|should)\s+)(always|never)\s+(.{4,})$/i.exec(sentence))) rule = `${match[1]} ${match[2]}`
    else if ((match = /^(don't|do not|stop|avoid)\s+(.{4,})$/i.exec(sentence))) rule = `${match[1]!.toLowerCase() === 'stop' ? 'Stop' : match[1]} ${match[2]}`
    else if ((match = /^(?:use|run|call)\s+(.+?)\s+(?:instead of|not|rather than)\s+(.+)$/i.exec(sentence))) rule = `Use ${match[1]}, not ${match[2]}`
    else if ((match = /^prefer\s+(.+?)\s+(?:over|to)\s+(.+)$/i.exec(sentence))) rule = `Prefer ${match[1]} over ${match[2]}`
    if (!rule) continue
    const line = cleanRule(`${rule.charAt(0).toUpperCase()}${rule.slice(1)}`.replace(/[.!\s]+$/, '') + '.')
    if (!line || line.split(/\s+/).length < 3) continue
    const scope = GLOBAL_WORDS.test(sentence) ? 'global' : 'project'
    return { isRule: true, rule: line.replace(PROJECT_WORDS, '').replace(/\s{2,}/g, ' ').replace(/\s+\./, '.'), scope, confidence: 0.8 }
  }
  return undefined
}

/** The bullets a CLAUDE.md already has, anywhere in it. */
export const bulletsOf = (file: string) =>
  file.split('\n').filter(line => /^\s*[-*] /.test(line)).map(line => line.replace(/^\s*[-*]\s+/, ''))

export type Written = { kind: 'added' | 'already'; text: string } | { kind: 'broken'; line: number }

/**
 * The file with the rule added inside the marked section (a new section when there are no markers),
 * unchanged when a similar bullet is anywhere in it, or `broken` (with the line to fix) when the markers
 * are one without the other, repeated, or out of order: never guess where to write.
 */
export function withRule(file: string, rule: string): Written {
  if (bulletsOf(file).some(bullet => similarity(bullet, rule) >= IN_FILE)) return { kind: 'already', text: file }
  const starts = file.split(START).length - 1
  const ends = file.split(END).length - 1
  if (!starts && !ends) {
    const gap = file === '' || file.endsWith('\n\n') ? '' : file.endsWith('\n') ? '\n' : '\n\n'
    return { kind: 'added', text: `${file}${gap}${START}\n## Learned rules\n- ${rule}\n${END}\n` }
  }
  const start = file.indexOf(START)
  const end = file.indexOf(END)
  if (starts !== 1 || ends !== 1 || end < start) {
    const at = starts !== 1 ? (starts ? file.indexOf(START, start + 1) : end) : end
    return { kind: 'broken', line: file.slice(0, Math.max(0, at)).split('\n').length }
  }
  return { kind: 'added', text: `${file.slice(0, end)}- ${rule}\n${file.slice(end)}` }
}
