// Renders the plugin's desktop pictures outside the app, for design checks against the canvas.
// Run with Node 22+ (it runs TypeScript directly):
//   node scripts/preview.ts > /tmp/pane.json
// Prints { light: Picture[], dark: Picture[] }: each picture forced to one theme, as a data: URI the
// way the desktop app draws an Svg (an image, so its <style> stays inside it).

import { controlModel, headerSvg, listSvg, sectionSvg, titleSvg, LIST_PAD, ROW_H } from '../hooks/features/control/pictures.ts'
import { defaultSettings, withFeature } from '../hooks/core/store.ts'

type Picture = { name: string; width: number; height: number; uri: string }

const force = (svg: string, theme: 'light' | 'dark') =>
  svg.replace('@media (prefers-color-scheme:dark)', theme === 'dark' ? '@media all' : '@media not all')

const uri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

/** The Switchboard pane at `width` px, as on the desktop with default settings. */
export function controlPane(theme: 'light' | 'dark', width = 560): Picture[] {
  const settings = withFeature(defaultSettings(), 'browser', true)
  const model = controlModel(settings, ['desktop'], {})
  const listHeight = LIST_PAD * 2 + model.rows.length * ROW_H
  return [
    { name: 'title', height: 40, svg: titleSvg(width) },
    { name: 'right-now', height: 98, svg: headerSvg(width, model) },
    { name: 'section', height: 26, svg: sectionSvg(width, 'FEATURES') },
    { name: 'features', height: listHeight, svg: listSvg(width, model.rows) },
  ].map(part => ({ name: part.name, width, height: part.height, uri: uri(force(part.svg, theme)) }))
}


// ---- Files (screens F2 reading, F3 done), with the design's sample project ----------------------

import { initialFiles, onCommit, onEditDone, onEditStart, onRead, onTurnEnd, toggleFolder, touchedRows, withChildren, withStatus } from '../hooks/features/files/model.ts'
import { footerSvg, statusSvg, touchedSvg, treeChunks } from '../hooks/features/files/pictures.ts'
import { buttonRow, sectionSvg as kitSection, titleSvg as kitTitle } from '../hooks/ui/kit.ts'
import { parseBranch } from '../hooks/features/files/git.ts'
import { addSteps, editStep, finishTurn, initialReplay } from '../hooks/features/replay/model.ts'
import { editSvg, headerSvg as replayHeaderSvg, navSvg, timelineSvg } from '../hooks/features/replay/pictures.ts'
import { parseRm, rmReport } from '../hooks/features/blast/measure.ts'
import { hold, initialBlast } from '../hooks/features/blast/model.ts'
import { actionsSvg, reportSvg } from '../hooks/features/blast/pictures.ts'
import { bandOf, initialAgents, onComplete, onSpawn, onUsage, ordered } from '../hooks/features/agents/model.ts'
import { bandSvg, headerSvg as agentsHeaderSvg, runSvg, sectionSvg as agentsSection } from '../hooks/features/agents/pictures.ts'

const NOW = new Date('2026-10-11T15:50:00').getTime()
const AT = new Date('2026-10-11T15:40:00').getTime()
const n = (path: string, isDir = false) => ({ path, name: path.split('/').pop()!, isDir, isHidden: path.split('/').pop()!.startsWith('.'), mtimeMs: AT, size: 0 })

function sampleFiles(stage: 'reading' | 'done') {
  const root = '/work/weather-app'
  let state = initialFiles(root)
  state = withChildren(state, '', [n('.git', true), n('docs', true), n('src', true), n('tests', true), n('.gitignore'), n('package.json')])
  state = withChildren(state, 'src', [n('src/api', true), n('src/components', true)])
  state = withChildren(state, 'src/api', [n('src/api/client.js'), n('src/api/stations.js')])
  state = withChildren(state, 'tests', [n('tests/client.test.js')])
  state = withStatus(state, { branch: parseBranch('## main'), files: {}, untrackedDirs: [] }, {})
  if (stage === 'reading') return onRead(toggleFolder(state, 'tests'), `${root}/tests/client.test.js`, NOW)
  state = toggleFolder(toggleFolder(toggleFolder(state, 'src'), 'src/api'), 'tests')
  for (const file of ['src/api/client.js', 'tests/client.test.js']) state = onEditDone(onEditStart(state, `${root}/${file}`, NOW), `${root}/${file}`, true, NOW)
  state = onCommit(onTurnEnd(state, NOW), 'a1c9e42d', ['src/api/client.js', 'tests/client.test.js'], { 'src/api/client.js': [1, 1], 'tests/client.test.js': [1, 1] })
  return state
}

export function filesPane(theme: 'light' | 'dark', stage: 'reading' | 'done', width = 560): Picture[] {
  const state = sampleFiles(stage)
  const out: { name: string; height: number; svg: string }[] = [{ name: 'title', height: 40, svg: kitTitle(width, 'Files: weather-app') }]
  const status = statusSvg(width, state)
  out.push({ name: 'status', height: status.height, svg: status.svg })
  if (stage === 'reading') {
    const tools = buttonRow(width, ['Refresh', 'Collapse all', 'Up a folder', 'Back to project', 'Hide hidden files'].map(label => ({ key: label, label })), '')
    out.push({ name: 'tools', height: tools.height, svg: tools.svg })
  }
  const touched = touchedSvg(width, touchedRows(state), '')
  out.push({ name: 'touched', height: touched.height, svg: touched.svg })
  out.push({ name: 'section', height: 26, svg: kitSection(width, 'All files', 'weather-app') })
  for (const chunk of treeChunks(width, state, '', NOW).chunks) out.push({ name: chunk.key, height: chunk.height, svg: chunk.svg })
  const footer = footerSvg(width, state)
  if (footer) out.push({ name: 'footer', height: footer.height, svg: footer.svg })
  return out.map(part => ({ name: part.name, width, height: part.height, uri: uri(force(part.svg, theme)) }))
}

/** Replay (F4) on the design's sample: "Rename greet to welcome" across 4 files. */
export function replayPane(theme: 'light' | 'dark', width = 560): Picture[] {
  const edit = (path: string, pairs: [string, string][]) => editStep('Edit', {
    structuredPatch: [{ lines: pairs.flatMap(([from, to]) => [`-${from}`, `+${to}`]) }],
  }, { path, isOutside: false }, 1)!
  let state = addSteps(initialReplay(), [
    edit('README.md', [['  `greet(name)`', '  `welcome(name)`']]),
    edit('src/greet.js', [['export function greet(name) {', 'export function welcome(name) {']]),
    edit('src/cli.js', [["import { greet } from './greet.js'", "import { welcome } from './greet.js'"], ['console.log(greet(arg))', 'console.log(welcome(arg))']]),
    edit('src/index.js', [["export { greet } from './greet.js'", "export { welcome } from './greet.js'"], ['greet,', 'welcome,']]),
  ], true)
  state = finishTurn(state, 't1', 'Rename greet to welcome', 1, false)
  const parts = [
    { name: 'header', ...replayHeaderSvg(width, state, '') },
    { name: 'section', svg: kitSection(width, 'The edits, in order'), height: 26 },
    { name: 'steps', ...timelineSvg(width, state.turns[0]!.steps, 0, '') },
    { name: 'edit', ...editSvg(width, state, '') },
    { name: 'nav', ...navSvg(width, state, '') },
  ]
  return parts.map(part => ({ name: part.name, width, height: part.height, uri: uri(force(part.svg, theme)) }))
}

/** Blast Radius (F5) holding `rm -rf build`: 9 files, 286 KB, none tracked. */
export function blastPane(theme: 'light' | 'dark', width = 560): Picture[] {
  const out = ['T\t9\t292864\t1\t0', 'D\t6\t239616\t./build/assets', 'D\t1\t48128\t./build/assets/fonts', 'D\t2\t5120\t./build',
    'F\t80896\t./build/assets/vendor.81d3aa.js', 'F\t64512\t./build/assets/app.4f9c2e.js', 'F\t35840\t./build/assets/vendor.81d3aa.js.map',
    'F\t29696\t./build/assets/styles.c07b1d.css', 'F\t26624\t./build/assets/app.4f9c2e.js.map', 'F\t48128\t./build/assets/fonts/inter-var.woff2',
    'G\t-1'].join('\n')
  const report = rmReport({ command: 'rm -rf build', where: 'in demo-app' }, parseRm(out))
  const held = { ...hold(initialBlast(), 'a', 'rm').held!, report, phase: 'waiting' as const }
  const parts = [{ name: 'report', ...reportSvg(width, held, 'rm', '') }, { name: 'actions', ...actionsSvg(width, held, 0, '') }]
  return parts.map(part => ({ name: part.name, width, height: part.height, uri: uri(force(part.svg, theme)) }))
}

/** Agents (F1): "Refactor auth", a reviewer running and three finished. */
export function agentsPane(theme: 'light' | 'dark', width = 560): Picture[] {
  const turn = { id: 't1', prompt: 'Refactor auth middleware' }
  const runs: [string, string, string, number][] = [
    ['Move sessions to the store', 'claude-opus-5-5', 'medium', 4], ['Update the routes', 'claude-haiku-5-5', 'low', 5],
    ['Write the tests', 'claude-opus-5-5', 'high', 4], ['Review the whole change', 'claude-opus-5-5', 'xhigh', 3],
  ]
  let state = initialAgents()
  runs.forEach(([description, model, effort, steps], index) => {
    state = onSpawn(state, { id: `a${index}`, type: 'general-purpose', description, model }, turn, index * 1_000)
    for (let k = 0; k < steps; k++) {
      state = onUsage(state, `a${index}`, model, effort, { input_tokens: 2_000, output_tokens: 1_500, cache_read_input_tokens: 6_000, cache_creation_input_tokens: 500 })
    }
  })
  state = { ...onComplete(onComplete(onComplete(state, 'a0', 'answer', 18_000), 'a1', 'answer', 44_000), 'a2', 'answer', 17_000), now: 61_000 }
  const all = ordered(state.runs)
  const running = all.filter(run => run.status === 'running')
  const done = all.filter(run => run.status !== 'running')
  const header = agentsHeaderSvg(width, state)
  const parts = [
    { name: 'head', svg: header.svg, height: header.height },
    { name: 'sec1', svg: agentsSection(width, `Running · ${running.length}`, '', '').svg, height: 28 },
    ...running.map((run, i) => ({ name: run.id, svg: runSvg(width, run, state.now, i === running.length - 1), height: 92 })),
    { name: 'sec2', svg: agentsSection(width, `▾ Finished · ${done.length}`, 'x', '').svg, height: 28 },
    ...done.map((run, i) => ({ name: run.id, svg: runSvg(width, run, state.now, i === done.length - 1), height: 92 })),
    { name: 'band', svg: bandSvg(width, bandOf(state)!, '').svg, height: 34 },
  ]
  return parts.map(part => ({ name: part.name, width, height: part.height, uri: uri(force(part.svg, theme)) }))
}

if (import.meta.main) {
  console.log(JSON.stringify({
    light: controlPane('light'), dark: controlPane('dark'),
    files: { reading: { light: filesPane('light', 'reading'), dark: filesPane('dark', 'reading') },
      done: { light: filesPane('light', 'done'), dark: filesPane('dark', 'done') } },
    replay: { light: replayPane('light'), dark: replayPane('dark') },
    blast: { light: blastPane('light'), dark: blastPane('dark') },
    agents: { light: agentsPane('light'), dark: agentsPane('dark') },
  }))
}
