// The Inbox sources screen on screen: pictures with see-through Clients on the desktop, text with real
// Buttons in the terminal. Pure; the pictures are in sources.ts.

import type { RenderElement } from 'claude-code'
import { clickable, paneWidth, type Basic, type Hit, type Pictured, type Presses } from '../../ui/click.tsx'
import { sectionSvg, type Part } from '../../ui/kit.ts'
import type { InboxState, Settings } from '../../../types/index.d.ts'
import { SOURCE_NAME } from './model.ts'
import { LEAD_CHOICES, alertsSvg, checkingSvg, gmailSteps, rowsOf, slackSteps, sourcesSvg, topSvg, type SourcesActions } from './sources.ts'

export type { SourcesActions }

const widthOf = (columns: number) => paneWidth(columns)

function run(actions: SourcesActions, key: string): void {
  if (key.startsWith('sources:steps:')) actions.steps(key.endsWith('slack') ? 'slack' : 'gmail')
  else if (key.startsWith('sources:link:')) actions.openLink(key.slice('sources:link:'.length))
  else if (key.startsWith('sources:slack:')) actions.slackCode(key.endsWith('user') ? 'user' : 'app')
  else if (key.startsWith('sources:resume:')) actions.resume(key.slice('sources:resume:'.length))
  else if (key.startsWith('sources:lead:')) actions.lead(Number(key.slice('sources:lead:'.length)))
  else if (key.startsWith('sources:toggle:')) actions.toggle(key.slice('sources:toggle:'.length) as 'sound' | 'notify' | 'quiet')
  else if (key === 'sources:gmail:direct') actions.gmailMode('direct')
  else if (key === 'sources:gmail:connector') actions.gmailMode('connector')
  else if (key === 'sources:gmail:signin') actions.gmailSignIn()
  else if (key === 'sources:connectors') actions.connectors()
  else if (key === 'sources:demo') actions.demo()
  else if (key === 'sources:restart') actions.restart()
  else if (key === 'sources:back') actions.back()
}

const withAction = (parts: readonly Part[], actions: SourcesActions): Hit[] => parts.map(part => ({ ...part, onPress: () => run(actions, part.key) }))

export function sourcesDesktop(elements: Pictured, state: InboxState, settings: Settings, now: number, columns: number, actions: SourcesActions,
                               hover: string, presses: Presses): RenderElement {
  const { Box, Text } = elements
  const setup = state.setup
  const width = widthOf(columns)
  if (!setup || !setup.isLoaded) return <Text dimColor>Reading your sources…</Text>
  const top = topSvg(width, setup, hover)
  const rows = rowsOf(setup, state, now)
  const list = sourcesSvg(width, rows, hover)
  const alerts = alertsSvg(width, settings, hover)
  const checking = checkingSvg(width, state, settings.inboxDemo === true, hover)
  const pieces: RenderElement[] = [
    clickable(elements, 'sources-top', top.svg, `Back to Inbox. ${setup.error || setup.message}`, width, top.height, withAction(top.parts, actions), presses),
    clickable(elements, 'sources-head', sectionSvg(width, 'Sources', `${rows.filter(row => row.pill).length} of ${rows.length} connected`), 'Sources', width, 26, [], presses),
    clickable(elements, 'sources-list', list.svg, rows.map(row => `${SOURCE_NAME[row.source]}: ${row.how}, ${row.status}`).join('; '), width, list.height, withAction(list.parts, actions), presses),
  ]
  if (setup.steps) {
    const steps = setup.steps === 'slack' ? slackSteps(width, setup, hover) : gmailSteps(width, setup, hover)
    pieces.push(clickable(elements, `sources-steps-${setup.steps}`, steps.svg, `${setup.steps === 'slack' ? 'Connect Slack' : 'Connect Gmail'} steps`, width, steps.height,
      withAction(steps.parts, actions), presses))
  }
  pieces.push(clickable(elements, 'sources-alerts-head', sectionSvg(width, 'Alerts', 'Critical and meetings'), 'Alerts', width, 26, [], presses))
  pieces.push(clickable(elements, 'sources-alerts', alerts.svg, `Meeting card ${settings.alerts.leadMin} min before. Sound ${settings.alerts.isSound ? 'on' : 'off'}, Mac notification ${settings.alerts.isNotify ? 'on' : 'off'}, quiet hours ${settings.alerts.isQuiet ? 'on' : 'off'}`,
    width, alerts.height, withAction(alerts.parts, actions), presses))
  pieces.push(clickable(elements, 'sources-checking-head', sectionSvg(width, 'Checking'), 'Checking', width, 26, [], presses))
  pieces.push(clickable(elements, 'sources-checking', checking.svg, 'Restart checking, demo', width, checking.height, withAction(checking.parts, actions), presses))
  return <Box flexDirection="column" gap={1}>{pieces}</Box>
}

export function sourcesText(elements: Basic, state: InboxState, settings: Settings, now: number, actions: SourcesActions): RenderElement {
  const { Box, Button, Text } = elements
  const setup = state.setup
  if (!setup || !setup.isLoaded) return <Text dimColor>Reading your sources…</Text>
  const rows = rowsOf(setup, state, now)
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1}>
        <Button key="sources:back" plain label="← Inbox" onPress={actions.back} />
        {setup.error || setup.message ? <Text color={setup.error ? 'error' : 'success'} wrap="wrap">{setup.error || setup.message}</Text> : null}
      </Box>
      <Text bold>SOURCES</Text>
      {rows.map(row => (
        <Box key={row.source} flexDirection="row" gap={1}>
          <Text color={row.dot === 'green' ? 'success' : row.dot === 'red' ? 'error' : row.dot === 'amber' ? 'warning' : undefined} dimColor={row.dot === 'faint'}>●</Text>
          <Text bold>{SOURCE_NAME[row.source]}</Text>
          <Text dimColor wrap="truncate-end">{`${row.how} · ${row.status}`}</Text>
          {row.action ? <Button key={row.action[0]} label={row.action[1]} onPress={() => run(actions, row.action![0])} /> : null}
        </Box>
      ))}
      {setup.steps === 'slack' ? (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Text bold>Connect Slack</Text>
          <Text wrap="wrap">{`1. ${setup.slack.user || setup.slack.app ? '✓ ' : ''}Create the Switchboard app in Slack, then Install to Workspace.`}</Text>
          <Button key="sources:link:slack_new_app" label="Open Slack ↗" onPress={() => actions.openLink('slack_new_app')} />
          <Text wrap="wrap">{`2. ${setup.slack.user ? '✓ ' : ''}Copy the User OAuth Token (xoxp-…), then:`}</Text>
          <Button key="sources:slack:user" label="Paste code 1" onPress={() => actions.slackCode('user')} />
          <Text wrap="wrap">{`3. ${setup.slack.app ? '✓ ' : ''}Generate an App-Level Token with connections:write (xapp-…), then:`}</Text>
          <Button key="sources:slack:app" label="Paste code 2" onPress={() => actions.slackCode('app')} />
          <Text dimColor wrap="wrap">The codes go from your clipboard into the keychain; they are never shown.</Text>
        </Box>
      ) : null}
      {setup.steps === 'gmail' ? (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Text bold>{setup.gmail.mode === 'direct' ? 'Connect Gmail directly' : "Gmail through Claude's connector"}</Text>
          {setup.gmail.mode === 'direct' ? (
            <Box flexDirection="column">
              <Button key="sources:link:gmail_api" label="1. Turn on Gmail access ↗" onPress={() => actions.openLink('gmail_api')} />
              <Button key="sources:link:oauth_client" label="2. Create a sign-in key ↗" onPress={() => actions.openLink('oauth_client')} />
              <Button key="sources:gmail:signin" label="3. Connect Gmail" onPress={actions.gmailSignIn} />
              <Button key="sources:gmail:connector" plain label="Use Claude's Gmail connector instead" onPress={() => actions.gmailMode('connector')} />
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text wrap="wrap">{setup.gmail.connector ? 'Connected through Claude.' : 'Connect Gmail in Claude (Settings → Connectors).'}</Text>
              <Button key="sources:gmail:direct" plain label="Connect directly instead" onPress={() => actions.gmailMode('direct')} />
            </Box>
          )}
        </Box>
      ) : null}
      <Text bold>ALERTS</Text>
      <Box flexDirection="row" gap={1}>
        <Text>Meeting card</Text>
        {LEAD_CHOICES.map(minutes => <Button key={`sources:lead:${minutes}`} plain label={`${settings.alerts.leadMin === minutes ? '●' : '○'} ${minutes} min`} onPress={() => actions.lead(minutes)} />)}
      </Box>
      <Button key="sources:toggle:sound" plain label={`${settings.alerts.isSound ? '☑' : '☐'} Sound`} onPress={() => actions.toggle('sound')} />
      <Button key="sources:toggle:notify" plain label={`${settings.alerts.isNotify ? '☑' : '☐'} Mac notification`} onPress={() => actions.toggle('notify')} />
      <Button key="sources:toggle:quiet" plain label={`${settings.alerts.isQuiet ? '☑' : '☐'} Quiet hours ${settings.quietHours.from}–${settings.quietHours.to}`} onPress={() => actions.toggle('quiet')} />
      <Text bold>CHECKING</Text>
      <Box flexDirection="row" gap={1}>
        <Button key="sources:restart" label="Restart checking" onPress={actions.restart} />
        <Button key="sources:demo" label={settings.inboxDemo ? 'Leave the demo' : 'Try the demo'} onPress={actions.demo} />
      </Box>
    </Box>
  )
}
