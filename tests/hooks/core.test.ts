// The feature and command tables and the settings store: pure rules, no engine.

import { describe, expect, test } from 'claude-code/testing'
import { COMMANDS, FEATURES, blockedReason, commandByName, isHidden, type CommandContext } from '../../hooks/core/features.ts'
import { defaultSettings, enabledFeatures, readSettings, withFeature } from '../../hooks/core/store.ts'

const context = (over: Partial<CommandContext> = {}): CommandContext => ({
  enabled: enabledFeatures(defaultSettings()), isInboxSession: false, surfaces: ['desktop'], ...over,
})

describe('commands', () => {
  test('every command but /switchboard starts with sb-, and names are unique', async () => {
    const names = COMMANDS.map(command => command.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.filter(name => !name.startsWith('sb-'))).toEqual(['switchboard'])
  })

  test('every feature has its command in the table', async () => {
    for (const feature of FEATURES) expect(commandByName(feature.command.slice(1))?.feature).toBe(feature.id)
  })

  test('a feature that is off hides its commands, and says how to turn it on', async () => {
    const off = context({ enabled: enabledFeatures(withFeature(defaultSettings(), 'agents', false)) })
    expect(isHidden(commandByName('sb-agents')!, off)).toBe(true)
    expect(isHidden(commandByName('sb-agents')!, off)).toBe(true)
    expect(isHidden(commandByName('sb-files')!, off)).toBe(false)
    expect(blockedReason(commandByName('sb-agents')!, off)).toBe('Agents is off. Turn it on in /switchboard.')
  })

  test('/switchboard is never hidden', async () => {
    const allOff = enabledFeatures({ ...defaultSettings(), features: Object.fromEntries(FEATURES.map(f => [f.id, false])) as never })
    expect(isHidden(commandByName('switchboard')!, context({ enabled: allOff }))).toBe(false)
  })

  test('/sb-auto only in the Inbox session; /sb-browser only in the terminal', async () => {
    expect(isHidden(commandByName('sb-auto')!, context())).toBe(true)
    expect(isHidden(commandByName('sb-auto')!, context({ isInboxSession: true }))).toBe(false)
    expect(isHidden(commandByName('sb-browser')!, context())).toBe(true)
    expect(isHidden(commandByName('sb-browser')!, context({ surfaces: ['terminal'] }))).toBe(false)
  })
})

describe('settings', () => {
  test('defaults: every feature on, Agents and Files open by themselves (an old store\'s Files off is the old default)', async () => {
    const settings = defaultSettings()
    expect(Object.values(settings.features).every(Boolean)).toBe(true)
    expect(settings.autoOpen).toEqual({ agents: true, files: true })
    expect(readSettings({ version: 1, autoOpen: { agents: true, files: false } }).autoOpen.files).toBe(true)
    expect(readSettings({ version: 2, autoOpen: { agents: true, files: false } }).autoOpen.files).toBe(false)
  })

  test('a damaged or old store reads as valid settings', async () => {
    for (const raw of [undefined, null, 5, 'x', [], { features: 'nope' }]) expect(readSettings(raw)).toEqual(defaultSettings())
    const read = readSettings({ features: { files: false, unknown: true, replay: 'yes' }, quietHours: { from: '25:00', to: '09:00' },
      autoOpen: { files: true }, inboxSessionId: 'abc', extra: 1 })
    expect(read.features.files).toBe(false)
    expect(read.features.replay).toBe(true)
    expect(read.quietHours).toEqual({ from: '20:00', to: '09:00' })
    expect(read.autoOpen).toEqual({ agents: true, files: true })
    expect(read.inboxSessionId).toBe('abc')
    expect('extra' in read).toBe(false)
  })

})
