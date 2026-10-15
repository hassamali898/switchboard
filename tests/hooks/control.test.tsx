// The Switchboard pane and the commands, through the engine on both surfaces: what /switchboard
// opens, switching a feature off and on, and the menu hiding a feature's commands while it's off.

import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const

const PANE_PROPS = {
  title: 'Switchboard', isFocused: false, bodyColumns: 74, placement: 'dock',
  scroll: { offset: 0, bodyRows: 40, contentRows: 40 }, view: {},
} as const

/** Runs a slash command as the person typing it would. */
const RUN = (name: string) => ({
  command: name, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 },
}) as never

type Fake = {
  clock: ReturnType<typeof mock.clock>
  opened: { id: string; title?: string }[]
  registered: string[]
  panes: string[]
  invalidated: string[]
  store: Map<string, unknown>
  /** Files the plugin wrote or reads, by path. */
  files: Map<string, string>
  toasts: string[]
}

/** The engine beneath the plugin: surfaces, session id, panes, command registration. */
type Run = { exitCode: number; stdout: string }

/** `run` answers a process in place of "not a git repository" (measuring scripts, sleeps). */
function fakeEngine(on: On, surface: string, stored: Record<string, unknown> = {},
                    run?: (argv: readonly string[]) => Run | undefined | Promise<Run | undefined>): Fake {
  const fake = { opened: [], registered: [], panes: [], invalidated: [], store: new Map(Object.entries(stored)), files: new Map(), toasts: [] } as unknown as Fake
  on('store.get', (_$, e) => ({ value: fake.store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    fake.store.set(e.key, e.value)
    return { value: undefined } as never
  })
  on('ui.close', (_$, e) => {
    fake.panes = fake.panes.filter(id => id !== e.id)
    return { value: undefined } as never
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  // The app's own band beneath ours: an empty row.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="app-band" />
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.surfaces', () => ({ value: [surface] }) as never)
  on('session.id', () => ({ value: 'session-1' }) as never)
  fake.clock = mock.clock(on, { now: Date.parse('2026-10-11T15:50:00') })
  on('session.cwd', () => ({ value: '/work/project' }) as never)
  on('env.get', () => ({ value: '/home/me' }) as never)
  on('fs.exists', (_$, e) => ({ value: fake.files.has((e as { path: string }).path) }) as never)
  on('fs.read', (_$, e) => ({ value: fake.files.get((e as { path: string }).path) ?? '' }) as never)
  on('fs.write', (_$, e) => {
    fake.files.set(e.path, e.text)
    return { value: undefined } as never
  })
  on('session.root', () => ({ value: '/work/project' }) as never)
  on('command.list', () => ({ value: [] }) as never)
  on('fs.list', (_$, e) => ({ value: (e as { path?: string }).path === '/work/project/src'
    ? [{ name: 'app.ts', kind: 'file', size: 10, mtimeMs: 0, isLink: false }]
    : [{ name: 'src', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }, { name: 'README.md', kind: 'file', size: 5, mtimeMs: 0, isLink: false }] }) as never)
  on('process.run', async (_$, e) => {
    const answer = await run?.(e.argv)
    return { value: { exitCode: 128, stdout: '', stderr: 'not a git repository', ...answer, isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  on('command.register', (_$, e) => {
    fake.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', (_$, e) => {
    fake.opened.push({ id: e.id, title: e.title })
    if (!fake.panes.includes(e.id)) fake.panes.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('ui.panes', () => ({
    value: fake.panes.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })),
  }) as never)
  on('ui.toast', (_$, e) => {
    fake.toasts.push(String((e as { text?: unknown }).text ?? ''))
    return { value: undefined } as never
  })
  on('ui.invalidate', (_$, e) => {
    fake.invalidated.push(e.event)
    return { value: undefined } as never
  })
  return fake
}

/** Flips a feature's switch the way each surface does: a Button in the terminal, a Client press on the desktop. */
async function flip(ui: { press: (t: { key: string }) => Promise<unknown>; post: (d: never, s?: never) => Promise<void> },
                    surface: string, id: string) {
  if (surface === 'terminal') await ui.press({ key: `toggle:${id}` })
  else await ui.post({ press: `toggle:${id}` } as never, { in: 'features:hits' } as never)
}

describe('Switchboard pane', () => {
  for (const surface of SURFACES) {
    test(`/switchboard opens the one pane and lists every feature (${surface})`, async ($, on) => {
      const fake = fakeEngine(on, surface)
      await $.session.start({ cwd: '/tmp', surface, isInteractive: true })
      expect(fake.registered).toContain('switchboard')
      expect(fake.registered.every(name => name === 'switchboard' || name.startsWith('sb-'))).toBe(true)

      const ran = await $.command.run(RUN('switchboard'))
      expect(ran.text).toContain('Opened Switchboard')
      expect(fake.opened).toEqual([{ id: 'switchboard', title: 'Switchboard' }])

      const ui = await $.ui.mount({ plugin: 'switchboard', surface, component: 'Pane', requestId: 'switchboard', props: PANE_PROPS })
      if (surface === 'terminal') {
        // Real buttons in the terminal; Browser runs only there, so it has a switch.
        expect(await ui.find({ key: 'toggle:files' })).toBeDefined()
        expect(await ui.find({ key: 'toggle:browser' })).toBeDefined()
      } else {
        // On the desktop the switches are a picture with a see-through Client over it, and no app
        // Button anywhere (its hover box showed over the pictures).
        expect(await ui.find({ key: 'features' })).toBeDefined()
        expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
      }
    })

    test(`a switch turns a feature off, saves it, and hides its commands (${surface})`, async ($, on) => {
      const fake = fakeEngine(on, surface)
      await $.session.start({ cwd: '/tmp', surface, isInteractive: true })
      await $.command.run(RUN('switchboard'))
      const ui = await $.ui.mount({ plugin: 'switchboard', surface, component: 'Pane', requestId: 'switchboard', props: PANE_PROPS })

      await flip(ui, surface, 'files')
      const saved = fake.store.get('settings') as { features: Record<string, boolean> }
      expect(saved.features.files).toBe(false)
      expect(saved.features.replay).toBe(true)
      expect(fake.invalidated).toContain('command.describe')

      const off = await $.command.run(RUN('sb-files'))
      expect(off.text).toBe('Files is off. Turn it on in /switchboard.')

      await flip(ui, surface, 'files')
      const back = fake.store.get('settings') as { features: Record<string, boolean> }
      expect(back.features.files).toBe(true)
      expect((await $.command.run(RUN('sb-files'))).text).toBe('Opened Files: project.')
    })
  }

  test('settings survive a new session', async ($, on) => {
    fakeEngine(on, 'desktop', { settings: { features: { cache: false } } })
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    expect((await $.command.run(RUN('sb-cache'))).text).toBe('Cache Tax is off. Turn it on in /switchboard.')
    expect((await $.command.run(RUN('sb-inbox'))).text).toContain('No Inbox session yet')
  })

  test('/sb-browser explains itself outside the terminal; /sb-auto outside the Inbox session', async ($, on) => {
    fakeEngine(on, 'desktop')
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    expect((await $.command.run(RUN('sb-browser'))).text).toBe('/sb-browser only works in a kitty or Ghostty terminal.')
    expect((await $.command.run(RUN('sb-auto'))).text).toContain('works in the Inbox session')
  })

  for (const surface of SURFACES) {
    test(`/sb-files opens the Files tree; a folder row opens the folder (${surface})`, async ($, on) => {
      fakeEngine(on, surface)
      await $.session.start({ cwd: '/work/project', surface, isInteractive: true })
      expect((await $.command.run(RUN('sb-files'))).text).toBe('Opened Files: project.')
      const ui = await $.ui.mount({ plugin: 'switchboard', surface, component: 'Pane', requestId: 'switchboard', props: PANE_PROPS })
      if (surface === 'terminal') {
        expect((await ui.find({ text: 'Not a git folder' }))).toBeDefined()
        await ui.press({ key: 'row:src' })
        expect(await ui.find({ text: 'app.ts' })).toBeDefined()
      } else {
        expect(await ui.find({ key: 'tree:0' })).toBeDefined()
        expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
        await ui.post({ press: 'row:src' } as never, { in: 'tree:0:hits' } as never)
        const drawn = JSON.stringify(await ui.drawn())
        expect(drawn).toContain('app.ts') // the tree's text alternative lists the opened folder's file
      }
    })
  }
})

describe('Replay', () => {
  const patch = (from: string, to: string) => ({
    result: {
      filePath: '', oldString: from, newString: to, originalFile: from, userModified: false, replaceAll: false,
      structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [`-  \`${from}(name)\``, `+  \`${to}(name)\``] }],
    },
    text: 'ok',
  })

  for (const surface of SURFACES) {
    test(`a turn's edits become steps, stored, and stepped through with /sb-replay (${surface})`, async ($, on) => {
      const fake = fakeEngine(on, surface)
      on('tool.call', () => patch('greet', 'welcome') as never)
      await $.session.start({ cwd: '/work/project', surface, isInteractive: true })
      expect((await $.command.run(RUN('sb-replay'))).text).toContain('No edits to replay yet')

      await $.turn.start({ text: 'Rename greet to welcome', turnId: 't1' } as never)
      await $.tool.call({ tool: 'Edit', file_path: '/work/project/README.md', old_string: 'greet', new_string: 'welcome' } as never)
      await $.tool.call({ tool: 'Edit', file_path: '/work/project/src/greet.js', old_string: 'greet', new_string: 'welcome' } as never)
      await $.turn.complete({ reason: 'answer', answer: 'Renamed.', durationMs: 1, isAborted: false, turnId: 't1' })

      const stored = fake.store.get('replay') as { turns: { steps: { path: string; add: number; del: number }[] }[] }
      expect(stored.turns[0]?.steps.map(step => [step.path, step.add, step.del])).toEqual([['README.md', 1, 1], ['src/greet.js', 1, 1]])

      // No pop-up above the prompt: Replay opens only with /sb-replay.
      const band = await $.ui.mount({ plugin: 'switchboard', surface, component: 'AbovePrompt', props: {} as never })
      expect(await band.find({ key: 'band-replay' })).toBeUndefined()

      expect((await $.command.run(RUN('sb-replay'))).text).toBe('Opened Replay: 2 edits in 2 files.')
      const ui = await $.ui.mount({ plugin: 'switchboard', surface, component: 'Pane', requestId: 'switchboard', props: PANE_PROPS })
      if (surface === 'terminal') {
        expect(await ui.find({ text: 'EDIT 1 OF 2' })).toBeDefined()
        await ui.press({ key: 'next' })
        expect(await ui.find({ text: 'EDIT 2 OF 2' })).toBeDefined()
      } else {
        expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
        expect(JSON.stringify(await ui.drawn())).toContain('Edit 1 of 2')
        await ui.post({ key: 'n' } as never, { in: 'replay-nav:hits' } as never)
        expect(JSON.stringify(await ui.drawn())).toContain('Edit 2 of 2')
        await ui.post({ press: 'step:0' } as never, { in: 'replay-steps:hits' } as never)
        expect(JSON.stringify(await ui.drawn())).toContain('Edit 1 of 2')
      }

    })
  }

  test('a denied edit records nothing; Replay comes back in a new session from the store', async ($, on) => {
    const fake = fakeEngine(on, 'terminal', { replay: { version: 1, turns: [{ id: 't0', at: 1, prompt: 'x',
      steps: [{ path: 'a.js', isOutside: false, tool: 'Edit', note: '', lines: [{ op: '+', text: 'x' }], add: 1, del: 0, cut: 0,
        kind: 'edit', isUserModified: false, isAfterTurn: false, at: 1 }] }] } })
    on('tool.call', () => ({ deny: 'no' }) as never)
    await $.session.start({ cwd: '/work/project', surface: 'terminal', isInteractive: true })
    expect((await $.command.run(RUN('sb-replay'))).text).toBe('Opened Replay: 1 edit in 1 file.')
    await $.turn.start({ text: 'edit', turnId: 't1' } as never)
    await $.tool.call({ tool: 'Edit', file_path: '/work/project/b.js', old_string: 'a', new_string: 'b' } as never)
    await $.turn.complete({ reason: 'answer', answer: 'no', durationMs: 1, isAborted: false, turnId: 't1' })
    expect((fake.store.get('replay') as { turns: unknown[] }).turns).toHaveLength(1)
  })
})

describe('Blast Radius', () => {
  /** What the measuring script prints for `rm -rf build` (screen F5's sample). */
  const RM_OUT = ['T\t9\t292864\t1\t0', 'D\t6\t239616\t./build/assets', 'D\t1\t48128\t./build/assets/fonts',
    'F\t80896\t./build/assets/vendor.81d3aa.js', 'F\t64512\t./build/assets/app.4f9c2e.js', 'F\t48128\t./build/assets/fonts/inter-var.woff2',
    'G\t-1'].join('\n')
  const RM = { tool: 'Bash', command: 'rm -rf build', tool_use_id: 'call-1' } as never

  /** The engine; each quarter-second sleep of the hold loop waits on the mock clock. */
  function blastEngine(on: On, surface: string, sleepMs = 250) {
    const seen = { sleeps: 0, ran: 0 }
    const box: { fake?: Fake } = {}
    box.fake = fakeEngine(on, surface, {}, async argv => {
      if (argv[0] === 'sleep') {
        seen.sleeps++
        // A long step jumps the clock (minutes per sleep) rather than wait in 2,400 quarter seconds.
        if (sleepMs > 1_000) await box.fake!.clock.set(box.fake!.clock.now() + sleepMs)
        else await box.fake!.clock.sleep(sleepMs)
        return { exitCode: 0, stdout: '' }
      }
      if (argv[0] === 'bash' && argv.includes('build')) return { exitCode: 0, stdout: RM_OUT }
      if (argv[0] === 'bash' && argv.includes('missing')) return { exitCode: 0, stdout: 'T\t0\t0\t0\t0' }
      return undefined
    })
    on('tool.call', () => {
      seen.ran++
      return { result: { stdout: '', stderr: '', interrupted: false }, text: '' } as never
    })
    return { fake: box.fake, seen }
  }

  const said = (result: unknown) => {
    const out = result as { deny?: string; text?: string }
    return out.deny ?? out.text ?? ''
  }

  for (const surface of SURFACES) {
    test(`rm -rf build is held and measured; Delete runs it (${surface})`, async ($, on) => {
      const { fake, seen } = blastEngine(on, surface)
      await $.session.start({ cwd: '/work/project', surface, isInteractive: true })
      const call = $.tool.call(RM)
      await fake.clock.settle()
      expect(fake.opened[0]?.title).toBe('Blast Radius')
      const ui = await $.ui.mount({ plugin: 'switchboard', surface, component: 'Pane', requestId: 'switchboard', props: PANE_PROPS })
      const drawn = JSON.stringify(await ui.drawn())
      expect(drawn).toContain('9 files')
      expect(drawn).toContain('None of these are tracked by git')
      // An act settles only with the work it set going, the held call included: let the clock run first.
      const pressing = surface === 'terminal' ? ui.press({ key: 'blast:proceed' })
        : ui.post({ press: 'blast:proceed' } as never, { in: 'blast-actions:hits' } as never)
      await fake.clock.advance(500)
      const result = await call
      await pressing
      expect('deny' in result).toBe(false)
      expect(seen.ran).toBe(1)
      expect((await $.command.run(RUN('sb-blast'))).text).toContain('rm -rf build: ran')
    })
  }

  test('Cancel (key 2) refuses and tells Claude not to retry', async ($, on) => {
    const { fake, seen } = blastEngine(on, 'desktop')
    await $.session.start({ cwd: '/work/project', surface: 'desktop', isInteractive: true })
    const call = $.tool.call(RM)
    await fake.clock.settle()
    const ui = await $.ui.mount({ plugin: 'switchboard', surface: 'desktop', component: 'Pane', requestId: 'switchboard', props: PANE_PROPS })
    const pressing = ui.post({ key: '2' } as never, { in: 'blast-actions:hits' } as never)
    await fake.clock.advance(500)
    const text = said(await call)
    await pressing
    expect(text).toContain('the user pressed Cancel')
    expect(text).toContain('Do not retry it unless the user asks you to')
    expect(seen.ran).toBe(0)
  })

  test('the row above the prompt shows while held, and its Cancel answers it (the pane may be hidden)', async ($, on) => {
    const { fake, seen } = blastEngine(on, 'desktop')
    await $.session.start({ cwd: '/work/project', surface: 'desktop', isInteractive: true })
    const call = $.tool.call(RM)
    await fake.clock.settle()
    const band = await $.ui.mount({ plugin: 'switchboard', surface: 'desktop', component: 'AbovePrompt', props: {} as never })
    expect(JSON.stringify(await band.drawn())).toContain('Blast Radius is holding')
    const pressing = band.press({ key: 'blast:cancel' })
    await fake.clock.advance(500)
    expect(said(await call)).toContain('the user pressed Cancel')
    await pressing
    expect(seen.ran).toBe(0)
    expect(await band.find({ key: 'blast-row' })).toBeUndefined()
  })

  test('no answer in a minute runs it by itself; /sb-blast wait none waits until you choose', async ($, on) => {
    const { fake, seen } = blastEngine(on, 'terminal')
    await $.session.start({ cwd: '/work/project', surface: 'terminal', isInteractive: true })
    const call = $.tool.call(RM)
    await fake.clock.settle()
    await fake.clock.advance(30_000)
    const band = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', component: 'AbovePrompt', props: {} as never })
    expect(JSON.stringify(await band.drawn())).toContain('runs by itself in 0:30')
    await fake.clock.advance(31_000)
    expect('deny' in (await call)).toBe(false)
    expect(seen.ran).toBe(1)
    expect((await $.command.run(RUN('sb-blast'))).text).toContain('ran by itself after 1 min')

    expect((await $.command.run({ ...(RUN('sb-blast') as object), args: 'wait none' } as never)).text).toContain('never run by themselves')
    expect((fake.store.get('settings') as { blastWaitMs: unknown }).blastWaitMs).toBeNull()
    const second = $.tool.call(RM)
    await fake.clock.settle()
    await fake.clock.advance(70_000)
    expect(seen.ran).toBe(1) // past the old minute, still held
    const ui = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', component: 'Pane', requestId: 'switchboard', props: PANE_PROPS })
    const pressing = ui.press({ key: 'blast:cancel' })
    await fake.clock.advance(500)
    expect(said(await second)).toContain('the user pressed Cancel')
    await pressing
  })

  test('safe commands and ones that change nothing run without a hold; /sb-blast off pauses', async ($, on) => {
    const { fake, seen } = blastEngine(on, 'terminal')
    await $.session.start({ cwd: '/work/project', surface: 'terminal', isInteractive: true })
    await $.tool.call({ tool: 'Bash', command: 'ls -la' } as never)
    await $.tool.call({ tool: 'Bash', command: 'rm -rf missing' } as never)
    expect(fake.opened).toHaveLength(0)
    expect((await $.command.run({ ...(RUN('sb-blast') as object), args: 'off 30m' } as never)).text).toContain('paused until')
    await $.tool.call(RM)
    expect(fake.opened).toHaveLength(0)
    expect(seen.ran).toBe(3)
  })
})

describe('Agents', () => {
  /** Spawns answer with an id per call; `listed` is what `$.agent.list()` reports. */
  function agentsEngine(on: On, surface: string, listed: unknown[] = []) {
    const fake = fakeEngine(on, surface)
    const ids = { n: 0 }
    on('agent.spawn', (_$, e) => (e.description === 'denied'
      ? { deny: 'no' } : { model: 'claude-opus-5-5', agentId: `agent-${++ids.n}` }) as never)
    on('agent.list', () => ({ value: listed }) as never)
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [], cost: { usd: 0.33 } } }) as never)
    return fake
  }
  const spawn = (description: string) => ({ prompt: 'do it', description, subagentType: 'general-purpose' }) as never
  const done = (agentId: string, reason: string) =>
    ({ reason, answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId: `t-${agentId}`, agentId }) as never

  for (const surface of SURFACES) {
    test(`agents at work: the pane opens by itself, the band shows, end states show (${surface})`, async ($, on) => {
      const fake = agentsEngine(on, surface)
      await $.session.start({ cwd: '/work/project', surface, isInteractive: true })
      await $.turn.start({ text: 'Refactor the auth middleware. Then review it.', turnId: 't1' } as never)
      await $.agent.spawn(spawn('Move sessions to the store'))
      expect(fake.opened).toHaveLength(1) // one agent at work opens the pane
      await $.agent.spawn(spawn('Update the routes'))
      await $.agent.spawn(spawn('denied'))
      expect(fake.opened[0]?.title).toBe('Agents: Refactor the auth middleware.')

      const band = await $.ui.mount({ plugin: 'switchboard', surface, component: 'AbovePrompt', props: {} as never })
      expect(await band.find({ key: 'band-agents' })).toBeDefined()
      expect(JSON.stringify(await band.drawn())).toContain('0/2 done')

      await $.turn.complete(done('agent-1', 'answer'))
      await $.turn.complete(done('agent-2', 'aborted'))
      const ui = await $.ui.mount({ plugin: 'switchboard', surface, component: 'Pane', requestId: 'switchboard', props: PANE_PROPS })
      const drawn = JSON.stringify(await ui.drawn())
      expect(drawn).toContain('Move sessions to the store')
      expect(drawn).toContain('stopped')
      expect(drawn).not.toContain('denied')
      expect(await band.find({ key: 'band-agents' })).toBeUndefined() // nothing runs: no band row
    })
  }

  test('/sb-agents toggles the pane; a reload brings back what still runs', async ($, on) => {
    const fake = agentsEngine(on, 'terminal', [{ id: 'a9', type: 'Explore', description: 'Find the callers', status: 'running' }])
    await $.session.start({ cwd: '/work/project', surface: 'terminal', isInteractive: true })
    expect((await $.command.run(RUN('sb-agents'))).text).toBe('Opened Agents: 1 running.')
    const ui = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', component: 'Pane', requestId: 'switchboard', props: PANE_PROPS })
    expect(JSON.stringify(await ui.drawn())).toContain('Find the callers')
    expect((await $.command.run(RUN('sb-agents'))).text).toBe('Closed Agents.')
    expect(fake.opened).toHaveLength(1)
  })
})

describe('Reflect', () => {
  const VERDICT = '{"is_rule": true, "rule": "Use pnpm instead of npm for package management in this project.", "scope": "project", "confidence": 0.95}'
  function reflectEngine(on: On, surface: string) {
    const calls = { complete: 0 }
    // The lock and the move are bash scripts: they succeed; the move itself is left to the real shell.
    const fake = fakeEngine(on, surface, {}, argv => (argv[0] === 'bash' ? { exitCode: 0, stdout: '' } : undefined))
    on('model.classify', (_$, e) => ({ value: /\bno\b|always|never/i.test(e.text) ? 'correction' : 'other' }) as never)
    on('model.complete', () => {
      calls.complete++
      return { value: { isAnswered: true, text: VERDICT, usage: {} } } as never
    })
    on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
    on('classic.UserPromptSubmit', () => ({}) as never)
    return { fake, calls }
  }
  const say = (text: string) => ({ text, origin: { kind: 'composer' } }) as never

  for (const surface of SURFACES) {
    test(`"no, use pnpm not npm" twice: one card ×2 when idle; Save writes the project CLAUDE.md (${surface})`, async ($, on) => {
      const { fake, calls } = reflectEngine(on, surface)
      await $.session.start({ cwd: '/work/project', surface, isInteractive: true })
      await $.prompt.submit(say('no - in this repo we always use pnpm, not npm'))
      await $.prompt.submit(say('ok'))
      await fake.clock.settle()
      await $.prompt.submit(say('no, use pnpm not npm'))
      await fake.clock.settle()
      expect(calls.complete).toBe(0) // Reflect finds rules locally: no model calls

      const band = await $.ui.mount({ plugin: 'switchboard', surface, component: 'AbovePrompt', props: {} as never })
      const drawn = JSON.stringify(await band.drawn())
      expect(drawn).toContain('Always use pnpm, not npm')
      expect(drawn).toContain(surface === 'desktop' ? 'said 2 times' : '×2')

      if (surface === 'desktop') {
        // A tall band shows the full card and its buttons; a 12-row one, the compact card with the buttons inside.
        const tall = await $.ui.mount({ plugin: 'switchboard', surface, component: 'AbovePrompt', props: { maxRows: 40 } as never })
        expect(JSON.stringify(await tall.drawn())).toContain('reflect-buttons')
        expect(drawn).not.toContain('reflect-buttons')
      }
      if (surface === 'terminal') await band.press({ key: 'reflect:save:project' })
      else await band.post({ press: 'reflect:save:project' } as never, { in: 'reflect-card:hits' } as never)
      const written = [...fake.files.entries()].find(([path]) => path.startsWith('/work/project/CLAUDE.md.switchboard-'))
      expect(written?.[1]).toBe('<!-- switchboard: learned rules (edit freely) -->\n## Learned rules\n- Always use pnpm, not npm.\n<!-- end switchboard -->\n')
      expect(fake.toasts.some(text => text.startsWith('Saved to /work/project/CLAUDE.md'))).toBe(true)
      expect(await band.find({ key: 'reflect' })).toBeUndefined()

      // The saved rule goes to Claude once, with the next message (the system prompt, and its cache, stay as they were).
      const submit = () => $.classic.UserPromptSubmit({ hook_event_name: 'UserPromptSubmit', session_id: 'session-1', transcript_path: '',
        cwd: '/work/project', prompt: 'next' } as never) as unknown as Promise<{ additionalContext?: string[] }>
      expect((await submit()).additionalContext?.join('\n')).toContain('Always use pnpm, not npm')
      expect((await submit()).additionalContext ?? []).toEqual([])
    })
  }

  test('remember: skips the model; secrets and slash commands are never checked; /sb-reflect pause stops it', async ($, on) => {
    const { fake, calls } = reflectEngine(on, 'terminal')
    await $.session.start({ cwd: '/work/project', surface: 'terminal', isInteractive: true })
    await $.prompt.submit(say('remember: answer in short sentences'))
    await $.prompt.submit(say('no, the key is sk-abcdefghijklmnopqrstuvwxyz123456'))
    await $.prompt.submit(say('/sb-files'))
    await fake.clock.settle()
    expect(calls.complete).toBe(0)
    expect((await $.command.run(RUN('sb-reflect'))).text).toContain('1. answer in short sentences — all projects')
    expect((await $.command.run({ ...(RUN('sb-reflect') as object), args: 'pause' } as never)).text).toContain('paused')
    await $.prompt.submit(say('no, always use tabs'))
    await fake.clock.settle()
    expect(calls.complete).toBe(0)
  })
})

describe('Cache Tax', () => {
  const HOUR = 3_600_000
  const usage = (write: number, read = 0) =>
    ({ model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 40, cache_read_input_tokens: read, cache_creation_input_tokens: write })
  const turn = async ($: { turn: { start: (e: never) => Promise<unknown>; complete: (e: never) => Promise<unknown> } }, id: string, write: number, read = 0) => {
    await $.turn.start({ text: 'work', turnId: id } as never)
    await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1, isAborted: false, turnId: id, usage: usage(write, read) } as never)
  }
  function cacheEngine(on: On, surface: string, forks: unknown[] = []) {
    const fake = fakeEngine(on, surface)
    const seen = { sent: [] as { text: string; origin: string; asUser: boolean }[], logs: [] as string[], forks: 0 }
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, tokens: 120_000 }, rateLimits: [] } }) as never)
    on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
    on('store.delete', (_$, e) => {
      fake.store.delete((e as { key: string }).key)
      return { value: undefined } as never
    })
    on('model.fork', () => {
      seen.forks++
      return { value: forks.shift() ?? { isAnswered: false, reason: 'nothing-to-fork' } } as never
    })
    on('prompt.submit', (_$, e) => {
      seen.sent.push({ text: e.text, origin: e.origin.kind, asUser: !!(e.origin as { asUser?: true }).asUser })
      return { text: e.text } as never
    })
    on('ui.log', (_$, e) => {
      seen.logs.push(String((e as { text?: unknown }).text ?? ''))
      return { value: undefined } as never
    })
    return { fake, seen }
  }
  const say = (text: string) => ({ text, origin: { kind: 'composer' } }) as never

  for (const surface of SURFACES) {
    test(`a cold cache holds the message on the card; Pay and send sends it once; keep-warm stays off unless you ask (${surface})`, async ($, on) => {
      const { fake, seen } = cacheEngine(on, surface)
      await $.session.start({ cwd: '/work/project', surface, isInteractive: true })
      await turn($, 't1', 120_000)
      expect((await $.prompt.submit(say('quick follow-up')) as { drop?: string }).drop).toBeUndefined() // still warm

      await fake.clock.advance(2 * HOUR)
      const held = await $.prompt.submit(say('Where were we? Give me a 2 line recap.')) as { drop?: string }
      expect(held.drop).toContain('on hold')
      const band = await $.ui.mount({ plugin: 'switchboard', surface, component: 'AbovePrompt', props: {} as never })
      const drawn = JSON.stringify(await band.drawn())
      expect(drawn).toContain('Your message is on hold')
      expect(drawn).toContain('$0.96') // 120,000 tokens at the 1-hour write price, $8/MTok

      if (surface === 'terminal') await band.press({ key: 'cache:pay' })
      else await band.post({ press: 'cache:pay' } as never, { in: 'cache-card:hits' } as never)
      await fake.clock.advance(5)
      expect(seen.sent.filter(one => one.origin === 'plugin')).toEqual([{ text: 'Where were we? Give me a 2 line recap.', origin: 'plugin', asUser: true }])
      expect(await band.find({ key: 'cache' })).toBeUndefined()

      await turn($, 't2', 120_000)
      // A paid cold write is only reported: keep-warm never starts by itself (its pings cost tokens).
      expect(fake.toasts.some(line => line.includes('cold write of 120k tokens was paid'))).toBe(true)
      expect((await $.command.run(RUN('sb-cache'))).text).not.toContain('keep-warm   on')
    })
  }

  test('sending it again goes through; guard warn only shows the price', async ($, on) => {
    const { fake, seen } = cacheEngine(on, 'terminal')
    await $.session.start({ cwd: '/work/project', surface: 'terminal', isInteractive: true })
    await turn($, 't1', 120_000)
    await fake.clock.advance(2 * HOUR)
    expect((await $.prompt.submit(say('go on')) as { drop?: string }).drop).toContain('on hold')
    expect((await $.prompt.submit(say('go on')) as { drop?: string }).drop).toBeUndefined()
    await turn($, 't2', 120_000)
    await fake.clock.advance(2 * HOUR)
    expect((await $.command.run({ ...(RUN('sb-cache') as object), args: 'guard warn' } as never)).text).toContain('goes through')
    await $.command.run({ ...(RUN('sb-cache') as object), args: 'off' } as never)
    expect((await $.prompt.submit(say('next')) as { drop?: string }).drop).toBeUndefined()
    expect(seen.logs.some(line => line.startsWith('Cache Tax: the prompt cache went cold'))).toBe(true)
  })

  test('keep-warm pings 50 min after the last request; a ping that finds it cold stops it', async ($, on) => {
    const warm = { isAnswered: true, text: 'warm', usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 120_000, cache_creation_input_tokens: 30 } }
    const cold = { isAnswered: true, text: 'warm', usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 120_000 } }
    const { fake, seen } = cacheEngine(on, 'terminal', [warm, cold])
    await $.session.start({ cwd: '/work/project', surface: 'terminal', isInteractive: true })
    await turn($, 't1', 120_000)
    expect((await $.command.run({ ...(RUN('sb-cache') as object), args: 'warm 6h' } as never)).text).toContain('Keep-warm is on for 6h00m')
    await fake.clock.advance(50 * 60_000)
    expect(seen.forks).toBe(1)
    expect((await $.command.run(RUN('sb-cache'))).text).toContain('last ping read 120k')
    await fake.clock.advance(50 * 60_000)
    expect(seen.forks).toBe(2)
    expect(fake.toasts.some(text => text.startsWith('Cache Tax: keep-warm stopped, the ping read 0'))).toBe(true)
    expect((await $.command.run(RUN('sb-cache'))).text).toContain('keep-warm   stopped')
  })

  test('a resumed session past its cache lifetime holds the first message at the engine\'s own price', async ($, on) => {
    cacheEngine(on, 'terminal')
    on('classic.SessionStart', () => ({}) as never)
    await $.session.start({ cwd: '/work/project', surface: 'terminal', isInteractive: true })
    await $.classic.SessionStart({ hook_event_name: 'SessionStart', session_id: 'session-1', transcript_path: '', cwd: '/work/project',
      source: 'resume', model: 'claude-opus-5-5', seconds_since_last_response: 400, context_tokens: 90_000,
      prompt_cache_likely_expired: true, estimated_cache_write_usd: 0.45 } as never)
    const held = await $.prompt.submit(say('what next?')) as { drop?: string }
    expect(held.drop).toContain('up to $0.45')
  })
})

describe('Inbox', () => {
  const NOW = Date.parse('2026-10-11T15:50:00')
  const item = (id: string, source: string, name: string, title: string, level: string, extra: Record<string, unknown> = {}) =>
    ({ id, num: 4, source, kind: source === 'gmail' ? 'mail' : 'dm', from: { name, handle: '', email: '' }, title, body: title,
      url: '', thread: { id: 't', count: 1 }, level, received_at: new Date(NOW - 120_000).toISOString(), read: false, excluded: false, via: 'demo', ...extra })
  const LINES = [
    { type: 'hello', mode: 'demo' },
    { type: 'snapshot', items: [item('gmail:1', 'gmail', 'Changelog digest', 'newsletter', 'quiet')] },
    { type: 'source', source: 'slack', state: 'live', message: 'Demo' },
    { type: 'item', new: true, item: item('slack:4', 'slack', 'Ahmed Raza', 'Can you review PR #482 before 5pm?', 'critical') },
  ]
  const DRAFTS = '{"short": "On it, I will review it by 4.", "detailed": "Yes, I will look at #482 this afternoon.", "ask_label": "Ask a question", "ask": "Is the migration the only change?"}'

  function inboxEngine(on: On, surface: string, stored: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
    const calls: string[] = []
    const models = { complete: 0 }
    const fake = fakeEngine(on, surface, stored, argv => {
      if (argv[0] === '/bin/sh') return { exitCode: 0, stdout: '/usr/bin/python3\n' }
      if (argv[2] !== 'watcher.cli') return undefined
      calls.push(argv[3] ?? '')
      const answers: Record<string, unknown> = {
        target: { target: 'Slack · DM with Ahmed Raza' }, thread: { messages: [{ from: 'Ahmed Raza', is_me: false, text: 'Can you review PR #482 before 5pm?', at: '' }] },
        read: { marked: 1 }, send: { ok: true, action_id: 7, target: 'Slack · DM with Ahmed Raza', undo: { type: 'slack_delete' } },
        drafts_get: { drafts: null }, ...extra,
      }
      return { exitCode: 0, stdout: `${JSON.stringify(answers[argv[3] ?? ''] ?? { ok: true })}\n` }
    })
    on('process.spawn', async function* () {
      for (const line of LINES) yield { stream: 'stdout', text: `${JSON.stringify(line)}\n` } as never
      await fake.clock.sleep(24 * 3_600_000)
      return { code: 0, signal: null } as never
    })
    on('model.complete', () => {
      models.complete++
      return { value: { isAnswered: true, text: DRAFTS, usage: { input_tokens: 800, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
    })
    on('store.delete', () => ({ value: undefined }) as never)
    on('prompt.fill', () => ({ isFilled: true }) as never)
    return { fake, calls, models }
  }

  for (const surface of SURFACES) {
    test(`a coding session: a Critical message shows the needs-you card and the bell; Dismiss takes the card down (${surface})`, async ($, on) => {
      const { fake } = inboxEngine(on, surface)
      await $.session.start({ cwd: '/work/project', surface, isInteractive: true })
      await fake.clock.advance(2_000)
      expect(fake.toasts.some(text => text.startsWith('Needs you: Ahmed Raza'))).toBe(true)
      const band = await $.ui.mount({ plugin: 'switchboard', surface, component: 'AbovePrompt', props: {} as never })
      const drawn = JSON.stringify(await band.drawn()).toLowerCase()
      expect(drawn).toContain('needs you now')
      expect(drawn).toContain('1 in inbox') // the quiet newsletter isn't counted
      if (surface === 'terminal') await band.press({ key: 'inbox:dismiss' })
      else await band.post({ press: 'inbox:dismiss' } as never, { in: 'inbox-needs-buttons:hits' } as never)
      await fake.clock.advance(5)
      const after = JSON.stringify(await band.drawn()).toLowerCase()
      expect(after).not.toContain('needs you now')
      expect(after).toContain('1 in inbox')
    })
  }

  test('a coding window: the message opens in the pane, the Inbox session drafts, no model call here', async ($, on) => {
    const { fake, calls, models } = inboxEngine(on, 'terminal', { settings: { inboxSessionId: 'inbox-1' } }, {
      lease_get: { lease: { owner: 'inbox-1', until: 9e12 } }, request: { ok: true, id: 'r1' }, request_get: { request: { status: 'done' } },
    })
    await $.session.start({ cwd: '/work/project', surface: 'terminal', isInteractive: true })
    await fake.clock.advance(2_000)
    await $.command.run(RUN('sb-inbox'))
    const pane = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', component: 'Pane', requestId: 'switchboard', props: PANE_PROPS })
    await pane.press({ key: 'inbox:open:slack:4' })
    await fake.clock.advance(5)
    expect(JSON.stringify(await pane.drawn())).toContain('Your Inbox session is drafting')
    expect(calls).toContain('request')
    expect(models.complete).toBe(0)
  })

  test('the Inbox session: open a message in the pane, three drafts from Haiku, Send after the 10 s Undo', async ($, on) => {
    const { fake, calls } = inboxEngine(on, 'terminal', { settings: { inboxSessionId: 'session-1' } })
    await $.session.start({ cwd: '/work/project', surface: 'terminal', isInteractive: true })
    await fake.clock.advance(2_000)
    await $.command.run(RUN('sb-inbox'))
    const pane = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', component: 'Pane', requestId: 'switchboard', props: PANE_PROPS })
    await pane.press({ key: 'inbox:open:slack:4' })
    await fake.clock.advance(5)
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('On it, I will review it by 4.')
    expect(drawn).toContain('Goes to Slack · DM with Ahmed Raza')
    expect(fake.toasts.some(text => text.includes('Replies are written in the Inbox session'))).toBe(false)
    expect(calls).toEqual(expect.arrayContaining(['read', 'target', 'thread']))

    await pane.press({ key: 'reply:opt:detailed' })
    await fake.clock.advance(5)
    await pane.press({ key: 'reply:send' })
    await fake.clock.advance(5)
    expect(JSON.stringify(await pane.drawn())).toContain('sending in 10 s')
    expect(calls).not.toContain('send')
    await fake.clock.advance(10_000)
    expect(calls).toContain('send')
    expect(fake.toasts).toContain('Sent to Slack · DM with Ahmed Raza.')
    expect(JSON.stringify(await pane.drawn())).toContain('Sent as you')
  })

  test('Undo during the 10 s stops the send; Improve rewrites the draft; Save draft keeps it', async ($, on) => {
    const { fake, calls } = inboxEngine(on, 'terminal', { settings: { inboxSessionId: 'session-1' } })
    await $.session.start({ cwd: '/work/project', surface: 'terminal', isInteractive: true })
    await fake.clock.advance(2_000)
    await $.command.run(RUN('sb-inbox'))
    const pane = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', component: 'Pane', requestId: 'switchboard', props: PANE_PROPS })
    await pane.press({ key: 'inbox:open:slack:4' })
    await fake.clock.advance(5)
    await pane.press({ key: 'reply:send' })
    await fake.clock.advance(3_000)
    await pane.press({ key: 'reply:undo' })
    await fake.clock.advance(10_000)
    expect(calls).not.toContain('send')
    expect(fake.toasts).toContain('Not sent.')
    await pane.press({ key: 'reply:improve' })
    await fake.clock.advance(5)
    await pane.press({ key: 'reply:improve:0' })
    await fake.clock.advance(5)
    expect(JSON.stringify(await pane.drawn())).toContain('Improved:')
    await pane.press({ key: 'reply:improve:use' })
    await fake.clock.advance(5)
    await pane.press({ key: 'reply:draft' })
    await fake.clock.advance(5)
    expect(calls).toContain('draft')
  })

  test('the Inbox chat reads the inbox through its tools; message text comes back fenced as data', async ($, on) => {
    const { fake } = inboxEngine(on, 'terminal', { settings: { inboxSessionId: 'session-1' } })
    const registered: string[] = []
    on('tool.register', (_$, e) => {
      registered.push((e as { name: string }).name)
      return { value: { tool: `mcp__switchboard__${(e as { name: string }).name}` } } as never
    })
    await $.session.start({ cwd: '/work/project', surface: 'terminal', isInteractive: true })
    await fake.clock.advance(2_000)
    expect(registered).toEqual(['inbox_list', 'inbox_read', 'inbox_open'])
    const listed = await $.tool.call({ tool: 'mcp__switchboard__inbox_list', needs_you: true } as never) as unknown as { result: string }
    expect(listed.result).toContain('slack:4 | slack | critical | Ahmed Raza')
    expect(listed.result).toContain('<inbox_data')
  })

  test('Inbox sources: every source with how it connects, alerts and checking', async ($, on) => {
    const { fake } = inboxEngine(on, 'terminal')
    await $.session.start({ cwd: '/work/project', surface: 'terminal', isInteractive: true })
    await fake.clock.advance(2_000)
    expect((await $.command.run({ ...(RUN('sb-inbox') as object), args: 'sources' } as never)).text).toContain('Opened Inbox sources')
    await fake.clock.advance(5)
    const pane = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', component: 'Pane', requestId: 'switchboard', props: PANE_PROPS })
    await fake.clock.advance(5)
    const drawn = JSON.stringify(await pane.drawn())
    for (const word of ['Slack', 'Gmail', 'Calendar', 'GitHub', 'Jira', 'Meeting card', 'Quiet hours', 'Restart checking']) expect(drawn).toContain(word)
    await pane.press({ key: 'sources:lead:10' })
    await fake.clock.advance(5)
    expect((fake.store.get('settings') as { alerts: { leadMin: number } }).alerts.leadMin).toBe(10)
  })
})

describe('Auto', () => {
  const NOW = Date.parse('2026-10-12T10:30:00') // a Monday, in work hours
  const message = { id: 'slack:9', num: 9, source: 'slack', kind: 'dm', from: { name: 'Sara Khan', handle: 'U0SARA1', email: '' },
    title: '', body: 'Can you send notes on slide 4 by Wednesday?', url: '', thread: { id: 't', count: 1 }, level: 'high',
    received_at: new Date(NOW - 60_000).toISOString(), read: false, excluded: false, via: 'direct' }
  const RULE = { id: 'r1', name: 'Replies', person: 'Sara Khan', sources: [], pairs: [{ when: 'question', whenText: 'Asks a question', do: 'reply', doText: 'Draft a reply' }],
    repos: [], workHours: false, cap: 5, mode: 'ask', isOn: true, instructions: '', createdAt: 0 }
  const DRAFTS = '{"short": "Will do, notes on slide 4 by Wednesday.", "detailed": "D", "ask_label": "Ask a question", "ask": "A"}'

  function autoEngine(on: On, label: string, stored: Record<string, unknown> = {}) {
    const calls: { command: string; request: Record<string, unknown> }[] = []
    const fake = fakeEngine(on, 'terminal', { settings: { inboxSessionId: 'session-1' }, 'auto.state': { rules: [RULE] }, ...stored }, async argv => {
      if (argv[0] === '/bin/sh') return { exitCode: 0, stdout: '/usr/bin/python3\n' }
      if (argv[2] !== 'watcher.cli') return undefined
      calls.push({ command: argv[3] ?? '', request: {} })
      const answers: Record<string, unknown> = {
        target: { target: 'Slack · DM with Sara Khan' }, thread: { messages: [] }, cap: { ok: true, used: 0, allowed: true },
        send: { ok: true, action_id: 11, target: 'Slack · DM with Sara Khan', undo: { type: 'slack_delete' } },
      }
      return { exitCode: 0, stdout: `${JSON.stringify(answers[argv[3] ?? ''] ?? { ok: true })}\n` }
    })
    on('process.spawn', async function* () {
      yield { stream: 'stdout', text: `${JSON.stringify({ type: 'hello', mode: 'watch' })}\n` } as never
      yield { stream: 'stdout', text: `${JSON.stringify({ type: 'snapshot', items: [] })}\n` } as never
      yield { stream: 'stdout', text: `${JSON.stringify({ type: 'item', new: true, item: message })}\n` } as never
      await fake.clock.sleep(24 * 3_600_000)
      return { code: 0, signal: null } as never
    })
    const classified: string[] = []
    on('model.classify', (_$, e) => {
      classified.push((e as { text: string }).text)
      return { value: label } as never
    })
    on('model.complete', (_$, e) => ({ value: { isAnswered: true, text: String((e as { prompt?: string }).prompt ?? '').includes('The description:')
      ? '{"name": "Ahmed Raza", "person": "Ahmed Raza", "sources": ["slack"], "pairs": [{"when": "pr_review", "whenText": "Asks for a PR review", "doText": "Review and post comments"}], "repos": [], "workHours": false, "cap": 5, "instructions": ""}'
      : DRAFTS, usage: { input_tokens: 500, output_tokens: 60 } } }) as never)
    on('tool.list', () => ({ value: [] }) as never)
    on('prompt.fill', () => ({ isFilled: true }) as never)
    return { fake, calls, classified }
  }

  test('a rule in Ask first: the message is classified, a reply drafted, held on the send check; Send uses the guarded path', async ($, on) => {
    const { fake, calls, classified } = autoEngine(on, 'asks the reader a question or for an answer')
    await fake.clock.set(NOW)
    await $.session.start({ cwd: '/work/project', surface: 'terminal', isInteractive: true })
    await fake.clock.advance(3_000)
    expect(classified[0]).toContain('<message source="slack"')
    const band = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', component: 'AbovePrompt', props: {} as never })
    const drawn = JSON.stringify(await band.drawn())
    expect(drawn).toContain('Will do, notes on slide 4 by Wednesday.')
    expect(drawn).toContain('nothing goes out until you say so')
    expect(calls.map(call => call.command)).not.toContain('send')
    await band.press({ key: 'auto:check:send' })
    await fake.clock.advance(5)
    expect(calls.map(call => call.command)).toContain('send')
    const pane = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', component: 'Pane', requestId: 'switchboard', props: PANE_PROPS })
    await $.command.run(RUN('sb-auto'))
    expect(JSON.stringify(await pane.drawn())).toContain('Replied to Sara Khan')
  })

  test('"unclear" leaves it a normal item; /sb-pause from any session stops matching', async ($, on) => {
    const { fake, calls } = autoEngine(on, 'unclear')
    await fake.clock.set(NOW)
    await $.session.start({ cwd: '/work/project', surface: 'terminal', isInteractive: true })
    await fake.clock.advance(3_000)
    expect(calls.map(call => call.command)).not.toContain('target')
    expect((await $.command.run({ ...(RUN('sb-pause') as object), args: '1h' } as never)).text).toContain('paused for 1h')
    expect(fake.store.get('auto.pausedUntil')).toBe(NOW + 3_000 + 3_600_000)
  })

  test('/sb-auto makes a rule card in Ask first; Save rule keeps it', async ($, on) => {
    const { fake } = autoEngine(on, 'unclear', { 'auto.state': { rules: [] } })
    await fake.clock.set(NOW)
    await $.session.start({ cwd: '/work/project', surface: 'terminal', isInteractive: true })
    await fake.clock.advance(2_000)
    expect((await $.command.run({ ...(RUN('sb-auto') as object), args: 'Ahmed Raza: if he asks for a PR review, review it' } as never)).text).toContain('Ask first')
    await fake.clock.advance(5)
    const band = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', component: 'AbovePrompt', props: {} as never })
    expect(JSON.stringify(await band.drawn())).toContain('Asks for a PR review → Review and post comments')
    await band.press({ key: 'auto:rule:save' })
    await fake.clock.advance(5)
    const saved = fake.store.get('auto.state') as { rules: { name: string; mode: string }[] }
    expect(saved.rules.map(rule => `${rule.name} ${rule.mode}`)).toEqual(['Ahmed Raza ask'])
    expect(JSON.stringify(await band.drawn())).toContain('Rule active')
  })
})
