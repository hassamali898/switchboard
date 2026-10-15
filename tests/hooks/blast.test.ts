// Blast Radius (phase 3): what is held, and how each report reads. Pure, no engine.

import { describe, expect, test } from 'claude-code/testing'
import { classify, segments } from '../../hooks/features/blast/classify.ts'
import {
  cleanReport, dirtyReport, findDryRun, migrateReport, parseRm, pushReport, pushTarget, rmReport, size, topmost,
} from '../../hooks/features/blast/measure.ts'
import { countdown, decide, denyText, hold, initialBlast, pauseLength, visibleRows, waitLength, waitWords } from '../../hooks/features/blast/model.ts'
import { actionsSvg, reportSvg } from '../../hooks/features/blast/pictures.ts'

const kind = (command: string) => classify(command)?.kind ?? null
const base = { command: 'rm -rf build', where: 'in demo-app' }

describe('what is held', () => {
  test('rm needs -r or -f; plain rm, ls and safe git run', async () => {
    expect(kind('rm -rf build')).toBe('rm')
    expect(kind('rm -f a.txt')).toBe('rm')
    expect(kind('rm a.txt')).toBeNull()
    expect(kind('ls -la && git status && git diff')).toBeNull()
    expect(kind('git clean -n')).toBeNull()
  })

  test('prefixes do not hide it: sudo, doas, env, timeout, nice, \\rm, /bin/rm', async () => {
    for (const command of ['sudo -u me rm -rf x', 'doas rm -rf x', 'FOO=1 env rm -rf x', 'timeout -s KILL 30 rm -rf x',
      'nice -n 5 rm -rf x', '\\rm -rf x', '/bin/rm -rf x']) expect(kind(command)).toBe('rm')
  })

  test('find -delete, find -exec rm, xargs rm, bash -c "<inner>"', async () => {
    expect(kind('find . -name "*.log" -delete')).toBe('find-delete')
    expect(kind('find dist -type f -exec rm {} +')).toBe('find-delete')
    expect(kind('find . -name "*.log"')).toBeNull()
    expect(kind('git ls-files -z | xargs -0 rm')).toBe('xargs-rm')
    expect(kind('bash -c "cd build && rm -rf out"')).toBe('rm')
    expect(kind("sh -c 'echo hi'")).toBeNull()
  })

  test('git: reset --hard, clean, force push, checkout .; cd and -C move where it runs', async () => {
    expect(kind('git reset --hard HEAD~1')).toBe('git-reset')
    expect(kind('git clean -fd')).toBe('git-clean')
    expect(kind('git push --force-with-lease origin main')).toBe('git-push-force')
    expect(kind('git push origin +main')).toBe('git-push-force')
    expect(kind('git checkout -- .')).toBe('git-checkout')
    expect(kind('git restore --staged .')).toBeNull()
    expect(classify('cd web && rm -rf node_modules')?.dir).toBe('web')
    expect(classify('(cd web && make) && rm -rf dist')?.dir).toBeNull()
    expect(classify('git -C sub reset --hard')?.dir).toBe('sub')
  })

  test('migrations, and a variable in the targets', async () => {
    expect(classify('python manage.py migrate')?.tool).toBe('django')
    expect(classify('bin/rails db:migrate')?.tool).toBe('rails')
    expect(kind('bin/rails db:migrate:status')).toBeNull()
    expect(classify('rm -rf "$BUILD_DIR"')?.usesVariable).toBe(true)
    expect(classify('rm -rf $(ls -d tmp*)')?.usesVariable).toBe(true)
  })

  test('variables set earlier on the line are read in, so the command can be measured', async () => {
    const risk = classify('S=/tmp/scratch; cd $S/png5 && rm -f agents-*.png')
    expect([risk?.kind, risk?.dir, risk?.usesVariable]).toEqual(['rm', '/tmp/scratch/png5', false])
    expect(classify('D=build_dir; rm -rf "${D}"')?.targets).toEqual(['build_dir'])
    expect(classify('rm -rf $UNSET')?.usesVariable).toBe(true)
    expect(classify('X=1')).toBeNull()
  })

  test('segments split outside quotes only', async () => {
    expect(segments('a && b || c; d | e')).toEqual(['a ', ' b ', ' c', ' d ', ' e'])
    expect(segments('bash -c "a && b"')).toEqual(['bash -c "a && b"'])
  })
})

describe('reports', () => {
  const RM_OUT = ['T\t9\t292864\t1\t0', 'D\t6\t239616\t./build/assets', 'D\t1\t48128\t./build/assets/fonts', 'D\t2\t5120\t./build',
    'F\t80896\t./build/assets/vendor.81d3aa.js', 'F\t64512\t./build/assets/app.4f9c2e.js', 'F\t48128\t./build/assets/fonts/inter-var.woff2',
    'G\t0'].join('\n')

  test('rm: folders by size with their largest files, the untracked warning, the button', async () => {
    const report = rmReport(base, parseRm(RM_OUT))
    expect([report.verb, report.amount, report.action]).toEqual(['will delete', '9 files · 286 KB', 'Delete 9 files'])
    expect(report.warn).toContain("can't be restored")
    expect(report.rows.map(row => `${row.isIndented ? '  ' : ''}${row.name}`)).toEqual([
      'build/assets/', '  vendor.81d3aa.js', '  app.4f9c2e.js', 'build/assets/fonts/', '  inter-var.woff2', 'build/'])
    expect(report.more).toBe(6)
    expect(Math.round(report.rows[0]!.bar * 100)).toBe(82)
  })

  test('rm of nothing is not held; tracked files drop the warning', async () => {
    expect(rmReport(base, parseRm('T\t0\t0\t0\t0')).isEmpty).toBe(true)
    expect(rmReport(base, parseRm('T\t3\t10\t1\t0\nG\t3')).warn).toBe('')
  })

  test('find: the dry run swaps -delete and -exec rm for -print', async () => {
    expect(findDryRun(['-name', '*.log', '-delete'])).toEqual(['-name', '*.log', '-print'])
    expect(findDryRun(['-type', 'f', '-exec', 'rm', '{}', ';'])).toEqual(['-type', 'f', '-print'])
    expect(findDryRun(['-exec', 'rm', '-f', '{}', '+', '-o', '-print'])).toEqual(['-print', '-o', '-print'])
  })

  test('git reset: dirty files with their line counts', async () => {
    const report = dirtyReport({ ...base, command: 'git reset --hard' }, '12\t3\tsrc/app.js\n-\t-\tlogo.png\n', true)
    expect(report.amount).toBe('changes in 2 files · +12 −3')
    expect(report.rows.map(row => row.count)).toEqual(['+12 −3', 'binary'])
    expect(dirtyReport(base, '', true).isEmpty).toBe(true)
  })

  test('git clean, force push, migrations', async () => {
    expect(cleanReport(base, 'Would remove tmp/\nWould remove a.log\n').amount).toBe('2 untracked paths')
    expect(pushTarget(['origin', 'feat:main'])).toEqual({ remote: 'origin', source: 'feat', branch: 'main' })
    expect(pushTarget(['--force'])).toEqual({ remote: 'origin', source: 'HEAD', branch: '' })
    expect(pushReport(base, 'origin/main', 'a1c9e42 Fix\nb2d0f53 Add\n').amount).toBe('2 commits on origin/main')
    expect(pushReport(base, 'origin/main', '').isEmpty).toBe(true)
    expect(pushReport(base, 'origin/main', null).note).toContain('git fetch')
    expect(migrateReport(base, 'django', '[X] a.0001\n[ ] a.0002\n[ ] b.0001\n').amount).toBe('2 migrations')
  })

  test('sizes read short', async () => {
    expect([size(812), size(48128), size(292864), size(5 * 1024 * 1024)]).toEqual(['812 B', '47 KB', '286 KB', '5.0 MB'])
  })
})

describe('the hold', () => {
  test('a decision lands once, for the held call only', async () => {
    let state = hold(initialBlast(), 'a', 'rm')
    state = decide(state, 'b', 'proceed')
    expect(state.held?.decision).toBeNull()
    state = decide(decide(state, 'a', 'cancel'), 'a', 'proceed')
    expect(state.held?.decision).toBe('cancel')
  })

  test('refusals tell Claude what it would have done and not to retry', async () => {
    const text = denyText('the user pressed Cancel', rmReport(base, parseRm('T\t9\t292864\t1\t0\nG\t-1')))
    expect(text).toBe('Blast Radius held this command and did not run it: the user pressed Cancel. It would have: will delete 9 files · 286 KB. ' +
      'Do not retry it unless the user asks you to.')
  })

  test('wait lengths, their words, and the countdown', async () => {
    expect([waitLength('30s'), waitLength('1m'), waitLength('5m'), waitLength('1h'), waitLength('90'), waitLength('none'), waitLength('2s'), waitLength('soon')])
      .toEqual([30_000, 60_000, 300_000, 3_600_000, 90_000, null, undefined, undefined])
    expect([waitWords(60_000), waitWords(90_000), waitWords(null)]).toEqual(['1 min', '1 min 30 s', 'until you choose'])
    const held = { ...hold(initialBlast(), 'a', 'rm').held!, autoRunAt: 60_000, now: 18_000 }
    expect([countdown(held), countdown({ ...held, autoRunAt: null })]).toEqual(['0:42', ''])
  })

  test('pause lengths', async () => {
    expect([pauseLength(''), pauseLength('1h'), pauseLength('30m'), pauseLength('2h30m'), pauseLength('90'), pauseLength('soon')])
      .toEqual([3_600_000, 3_600_000, 1_800_000, 9_000_000, 5_400_000, 0])
  })

  test('the card shows 8 rows, then "Show N more"; the decision row has the action and Cancel', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => `D\t1\t${1000 - i}\t./f${i}`).join('\n')
    const report = rmReport(base, parseRm(`T\t12\t12000\t1\t0\n${rows}\nG\t-1`))
    const held = { ...hold(initialBlast(), 'a', 'rm').held!, report, phase: 'waiting' as const }
    expect(visibleRows(report, false).hidden).toBe(4)
    expect(actionsSvg(480, held, 1, '').parts.map(part => part.key)).toEqual(['blast:more', 'blast:proceed', 'blast:cancel'])
    expect(actionsSvg(480, held, 1, '').svg).toContain('1 more held')
    expect(reportSvg(480, held, 'rm').svg).toContain('will')
  })
})

describe('find -delete', () => {
  test('only the topmost paths are measured, linear even for a huge listing', async () => {
    expect(topmost(['./a/b.pyc', './a', './a-c/d', './e/'])).toEqual({ top: ['./a', './a-c/d', './e'], isPartial: false })
    const many = Array.from({ length: 50_000 }, (_, i) => `./cache/f${i}.pyc`)
    expect(topmost([...many, './cache']).top).toEqual(['./cache'])
    expect(topmost(Array.from({ length: 2_500 }, (_, i) => `./f${i}`)).isPartial).toBe(true)
    expect(topmost(Array.from({ length: 2_500 }, (_, i) => `./dir/f${i}`).concat('./dir')).isPartial).toBe(false)
  })
})
