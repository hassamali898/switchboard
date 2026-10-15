// What Switchboard keeps across sessions in `$.store`, as typed keys with defaults and migrations.
// Pure: register.tsx does the reads and writes. Secrets never go here (BUILD_PLAN.md 5.2).

import type { FeatureId, Settings } from '../../types/index.d.ts'
import { FEATURES } from './features.ts'

export type { Settings }

export const SETTINGS_KEY = 'settings'
export const SETTINGS_VERSION = 2 as const
/** We use at most 1 MiB of the store's 4 MiB (BUILD_PLAN.md 5.2). */

/** Blast Radius waits this long for an answer, then runs the command (your call, 2026-10-12). */
export const BLAST_WAIT_MS = 60_000

export function defaultSettings(): Settings {
  const features = {} as Record<FeatureId, boolean>
  for (const feature of FEATURES) features[feature.id] = feature.isOnByDefault
  return {
    version: SETTINGS_VERSION,
    features,
    autoOpen: { agents: true, files: true },
    blastWaitMs: BLAST_WAIT_MS,
    quietHours: { from: '20:00', to: '09:00' },
    alerts: { leadMin: 5, isSound: true, isNotify: true, isQuiet: true },
  }
}

/** The meeting card's lead times to choose from (BUILD_PLAN.md P8). */
export const LEAD_CHOICES = [1, 3, 5, 10] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isClock = (value: unknown): value is string =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)

/**
 * Reads whatever the store held into valid settings: unknown keys dropped, wrong types replaced
 * by defaults, features added since filled in. Never throws, so a damaged store can't stop a session.
 */
export function readSettings(raw: unknown): Settings {
  const settings = defaultSettings()
  if (!isRecord(raw)) return settings
  if (isRecord(raw.features)) {
    for (const feature of FEATURES) {
      const value = raw.features[feature.id]
      if (typeof value === 'boolean') settings.features[feature.id] = value
    }
  }
  if (isRecord(raw.autoOpen)) {
    if (typeof raw.autoOpen.agents === 'boolean') settings.autoOpen.agents = raw.autoOpen.agents
    // Version 1 kept Files' old default (off); from version 2 (and any newer) your choice stands.
    if (typeof raw.autoOpen.files === 'boolean' && typeof raw.version === 'number' && raw.version >= SETTINGS_VERSION) settings.autoOpen.files = raw.autoOpen.files
  }
  if (raw.blastWaitMs === null) settings.blastWaitMs = null
  else if (typeof raw.blastWaitMs === 'number' && raw.blastWaitMs >= 5_000 && raw.blastWaitMs <= 24 * 3_600_000) settings.blastWaitMs = raw.blastWaitMs
  if (isRecord(raw.quietHours) && isClock(raw.quietHours.from) && isClock(raw.quietHours.to)) {
    settings.quietHours = { from: raw.quietHours.from, to: raw.quietHours.to }
  }
  if (typeof raw.inboxSessionId === 'string' && raw.inboxSessionId.length > 0 && raw.inboxSessionId.length <= 200) {
    settings.inboxSessionId = raw.inboxSessionId
  }
  if (raw.inboxDemo === true) settings.inboxDemo = true
  if (isRecord(raw.alerts)) {
    const alerts = raw.alerts
    if (typeof alerts.leadMin === 'number' && (LEAD_CHOICES as readonly number[]).includes(alerts.leadMin)) settings.alerts.leadMin = alerts.leadMin
    if (typeof alerts.isSound === 'boolean') settings.alerts.isSound = alerts.isSound
    if (typeof alerts.isNotify === 'boolean') settings.alerts.isNotify = alerts.isNotify
    if (typeof alerts.isQuiet === 'boolean') settings.alerts.isQuiet = alerts.isQuiet
  }
  return settings
}

export function withFeature(settings: Settings, id: FeatureId, isOn: boolean): Settings {
  return { ...settings, features: { ...settings.features, [id]: isOn } }
}

export function enabledFeatures(settings: Settings): Set<FeatureId> {
  return new Set(FEATURES.filter(feature => settings.features[feature.id]).map(feature => feature.id))
}

