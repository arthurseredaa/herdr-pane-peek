import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  READ_LINES,
  decorate,
  describeOrigin,
  effective,
  expandDeletion,
  filterPanes,
  formatToken,
  layoutRows,
  paneContext,
  paneUnreadable,
  parseSnapshot,
  rowLabel,
  statusColor,
  tokenIds,
} from './peek'

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
  const token = formatToken(paneId)
  const found = (await read($, panes)).find(p => p.paneId === paneId)
  const from = found === undefined ? paneId : describeOrigin(found, await $.env.get('HOME'))
  const filled = await $.prompt.fill({ text: `${token} `, mode: 'insert', decorations: decorate(token) })
  if (filled.isFilled) {
    $.ui.toast(`inserted pane from ${from}`)
  } else {
    await $.ui.copy({ text: token })
    $.ui.toast(`copied pane from ${from} (the prompt would not take it)`)
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

    return {}
  })

  // The chips live in the draft as plain text: repaint them after every edit and
  // let a deletion that touches one take the whole of it.
  on('prompt.edit', async ($, e, next) => {
    const done = await next(e)
    const widened = e.inputText === '' ? expandDeletion(e.text, e.start, e.end) : null
    const text = widened?.text ?? done.text
    const cursor = widened?.cursor ?? done.cursor

    return { ...done, text, cursor, decorations: [...(done.decorations ?? []), ...decorate(text)] }
  }).catch(($, e, next) => next(e))

  // A marked pane is read here, once, so the model answers from the snapshot
  // instead of loading the skill and running `herdr pane read` itself.
  on('prompt.submit', async ($, e, next) => {
    const ids = tokenIds(e.text)
    if (ids.length === 0) return next(e)

    const blocks: string[] = []
    for (const id of ids) {
      const got = await $.process.run(
        ['herdr', 'pane', 'read', id, '--source', 'recent-unwrapped', '--lines', String(READ_LINES)],
        { timeoutMs: 5000 },
      )
      blocks.push(got.exitCode === 0 ? paneContext(id, got.stdout) : paneUnreadable(id, got.stderr.trim() || `exit ${got.exitCode}`))
    }

    return next({ ...e, context: [...(e.context ?? []), ...blocks] })
  }).catch(($, e, next) => next(e))

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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    // herdr is a terminal tool; the mobile surface has no text field to draw.
    if (e.surface === 'mobile') return next(e)
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const all = await read($, panes)
    const q = await read($, query)
    const problem = await read($, error)
    const columns = e.props.bodyColumns ?? 80
    const list = filterPanes(all, q)
    const total = Math.max(list.length, all.filter(p => !p.isThis).length)
    // lines the rows and headings may take: all but the search line, the hint and a "more" line
    const { groups, hidden } = layoutRows(list, Math.max(3, (e.viewport?.rows ?? PANE_ROWS) - 3))

    return (
      <Box flexDirection="column">
        <Box>
          <Box flexGrow={1}>
            <Input
              key="q"
              autoFocus
              placeholder="search…"
              value={q}
              submitLabel="insert"
              onInput={value => setQuery($, value)}
              onSubmit={() => pickFirst($)}
            />
          </Box>
          <Text dimColor>{` ${list.length}/${total}`}</Text>
        </Box>
        {problem !== null && <Text color="error">{problem}</Text>}
        {problem === null && list.length === 0 && <Text color="inactive">No panes found.</Text>}
        {groups.map(g => (
          <Box key={`ws:${g.workspace}`} flexDirection="column">
            <Text bold color="claude">{g.workspace}</Text>
            {g.panes.map(p => (
              <Box key={`pane:${p.paneId}`}>
                <Text color={statusColor(p.status)}> ● </Text>
                <Button plain dimColor label={rowLabel(p, columns - 4)} key={`row:${p.paneId}`} onPress={() => pick($, p.paneId)} />
              </Box>
            ))}
          </Box>
        ))}
        {hidden > 0 && <Text color="inactive">{`… ${hidden} more, narrow the search`}</Text>}
        <Text color="inactive">↑↓ choose · ⏎ insert · esc close</Text>
      </Box>
    )
  })
}
