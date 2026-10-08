import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { effective, filterPanes, parseSnapshot, rowLabel } from './peek'

const PANE = 'pane-peek'
const REFRESH_MS = 5_000
const PANE_ROWS = 20

const panes = atom({ plugin: 'pane-peek', key: 'panes' } as const, [])
const query = atom({ plugin: 'pane-peek', key: 'query' } as const, '')
const selected = atom({ plugin: 'pane-peek', key: 'selected' } as const, null)
const error = atom({ plugin: 'pane-peek', key: 'error' } as const, null)

async function refresh($: EngineInterface) {
  try {
    const got = await $.process.run(['herdr', 'api', 'snapshot'], { timeoutMs: 5000 })
    if (got.exitCode !== 0) throw new Error(got.stderr.trim() || `exit ${got.exitCode}`)
    const found = parseSnapshot(got.stdout, await $.env.get('HERDR_PANE_ID'))
    await update($, panes, () => found)
    await update($, error, () => null)
  } catch (failure) {
    await update($, error, () => `herdr api snapshot: ${failure instanceof Error ? failure.message : String(failure)}`)

    return
  }
}

async function setQuery($: EngineInterface, value: string) {
  await update($, query, () => value)
  await update($, selected, () => null)
}

async function highlight($: EngineInterface, paneId: string) {
  await update($, selected, () => paneId)
}

/** Closes the pane first: while it holds the keys the prompt box refuses a fill. */
async function pick($: EngineInterface, paneId: string) {
  await $.ui.close({ id: PANE })
  const filled = await $.prompt.fill({ text: `${paneId} `, mode: 'insert' })
  if (filled.isFilled) {
    $.ui.toast(`inserted ${paneId}`)
  } else {
    await $.ui.copy({ text: paneId })
    $.ui.toast(`${paneId} copied (the prompt would not take it)`)
  }
}

async function pickFirst($: EngineInterface) {
  const list = filterPanes(await read($, panes), await read($, query))
  const target = effective(list, await read($, selected))
  if (target !== undefined) await pick($, target.paneId)
}

export const register: Register = on => {
  let isOpen = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pane-peek',
      description: 'Pick a herdr pane from any workspace and put its id in the prompt',
      immediate: true,
    })
    $.clock.every(REFRESH_MS, () => {
      if (isOpen) void refresh($)
    })

    return next(e)
  })

  on('command.run', { command: 'pane-peek' }, async $ => {
    isOpen = true
    await update($, query, () => '')
    await update($, selected, () => null)
    await $.ui.open({ id: PANE, title: 'herdr panes', focus: true, closeOnEscape: true, rows: PANE_ROWS })
    await refresh($)

    return { text: '↑↓ choose, Enter inserts the id, Esc closes.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) isOpen = false

    return next(e)
  })

  on('ui.focus', async ($, e, next) => {
    const moved = await next(e)
    if (e.requestId === PANE && e.element?.startsWith('row:') === true && moved.deny === undefined) {
      await highlight($, e.element.slice('row:'.length))
    }

    return moved
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const all = await read($, panes)
    const q = await read($, query)
    const current = effective(filterPanes(all, q), await read($, selected))
    const problem = await read($, error)
    const columns = e.props.bodyColumns ?? 80
    const list = filterPanes(all, q)
    const room = Math.max(3, (e.viewport?.rows ?? PANE_ROWS) - 4)
    const shown = list.slice(0, room)

    return (
      <Box flexDirection="column">
        <Input
          key="q"
          autoFocus
          placeholder="search: workspace, tab, cwd, agent, status…"
          value={q}
          submitLabel="insert id"
          onInput={value => setQuery($, value)}
          onSubmit={() => pickFirst($)}
        />
        {problem !== null && <Text color="red">{problem}</Text>}
        {problem === null && list.length === 0 && <Text dimColor>No panes found.</Text>}
        {shown.map(p => (
          <Button
            key={`row:${p.paneId}`}
            plain
            label={rowLabel(p, p.paneId === current?.paneId, columns - 2)}
            onPress={() => pick($, p.paneId)}
          />
        ))}
        {list.length > shown.length && <Text dimColor>{`… ${list.length - shown.length} more, narrow the search`}</Text>}
      </Box>
    )
  })
}
