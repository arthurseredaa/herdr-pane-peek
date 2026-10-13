import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PeekPane } from '../types'
import {
  MAX_PANES,
  READ_LINES,
  decorate,
  describeOrigin,
  effective,
  expandDeletion,
  filterPanes,
  formatToken,
  herdrError,
  layoutRows,
  notRun,
  paneContext,
  paneUnreadable,
  panesSkipped,
  parseSnapshot,
  rowParts,
  statusColor,
  suggestRow,
  tokenIds,
  tokenQuery,
} from './peek'

const PANE = 'pane-peek'
const REFRESH_MS = 5_000
const PANE_ROWS = 20
const SUGGEST_ROWS = 8

const panes = atom({ plugin: 'pane-peek', key: 'panes' } as const, [])
const query = atom({ plugin: 'pane-peek', key: 'query' } as const, '')
const selected = atom({ plugin: 'pane-peek', key: 'selected' } as const, null)
const error = atom({ plugin: 'pane-peek', key: 'error' } as const, null)
const isLoaded = atom({ plugin: 'pane-peek', key: 'isLoaded' } as const, false)

function said(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}

/** Every pane herdr has; throws with what went wrong, worded for the picker's error line. */
async function snapshot($: EngineInterface): Promise<PeekPane[]> {
  const got = await $.process.run(['herdr', 'api', 'snapshot'], { timeoutMs: 5000 }).catch(failure => {
    throw new Error(notRun(said(failure)))
  })
  if (got.exitCode !== 0) throw new Error(`herdr: ${herdrError(got.stderr, got.exitCode)}`)
  const [thisPane, home] = [await $.env.get('HERDR_PANE_ID'), await $.env.get('HOME')]
  try {
    return parseSnapshot(got.stdout, thisPane, home)
  } catch (failure) {
    throw new Error(`herdr: its snapshot could not be read (${said(failure)})`)
  }
}

async function refresh($: EngineInterface) {
  try {
    const found = await snapshot($)
    await update($, panes, () => found)
    await update($, error, () => null)
    await update($, isLoaded, () => true)
  } catch (failure) {
    await update($, error, () => said(failure))

    return
  }
}

/** One marked pane's recent output, or why herdr gave none: a pane that fails costs only itself. */
async function readPane($: EngineInterface, paneId: string): Promise<{ output: string } | { problem: string }> {
  try {
    const got = await $.process.run(
      ['herdr', 'pane', 'read', paneId, '--source', 'recent-unwrapped', '--lines', String(READ_LINES)],
      { timeoutMs: 5000 },
    )

    return got.exitCode === 0 ? { output: got.stdout } : { problem: herdrError(got.stderr, got.exitCode) }
  } catch (failure) {
    return { problem: notRun(said(failure)) }
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
  const from = found === undefined ? paneId : describeOrigin(found)
  const filled = await $.prompt.fill({ text: `${token} `, mode: 'insert', decorations: decorate(token) })
  if (filled.isFilled) {
    $.ui.toast(`inserted pane from ${from}`)
  } else {
    await $.ui.copy({ text: token })
    $.ui.toast(`copied pane from ${from} (the prompt would not take it)`)
  }
}

async function pickFirst($: EngineInterface) {
  // the rows are not drawn while herdr does not answer: Enter has nothing to act on
  if ((await read($, error)) !== null) return
  const list = filterPanes(await read($, panes), await read($, query))
  const target = effective(list, await read($, selected))
  if (target !== undefined) await pick($, target.paneId)
}

export const register: Register = on => {
  let isOpen = false
  let suggestedAt: number | null = null

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

  // `%word` anywhere in the draft: the picker's search without leaving the prompt box.
  on('prompt.autocomplete', { token: /^%/ }, async ($, e, next) => {
    const rest = await next(e)
    // the person is choosing in the prompt box now: one list of panes, not two
    if (isOpen) {
      await $.ui.close({ id: PANE })
      isOpen = false
    }
    const now = await $.clock.now()
    if (suggestedAt === null || now - suggestedAt >= REFRESH_MS) {
      await refresh($)
      suggestedAt = now
    }
    if ((await read($, error)) !== null) return rest
    const rows = filterPanes(await read($, panes), tokenQuery(e.token)).slice(0, SUGGEST_ROWS).map(suggestRow)

    return { suggestions: [...rest.suggestions, ...rows] }
  }).catch(($, e, next) => next(e))

  // A marked pane is read here, once, so the model answers from the snapshot
  // instead of loading the skill and running `herdr pane read` itself.
  on('prompt.submit', async ($, e, next) => {
    const ids = tokenIds(e.text)
    if (ids.length === 0) return next(e)

    const known = await snapshot($).catch((): PeekPane[] => [])
    const blocks: string[] = []
    const unread: string[] = []
    for (const id of ids.slice(0, MAX_PANES)) {
      const got = await readPane($, id)
      if ('output' in got) {
        blocks.push(paneContext(id, got.output, known.find(p => p.paneId === id)))
      } else {
        blocks.push(paneUnreadable(id, got.problem))
        unread.push(`${id} (${got.problem})`)
      }
    }
    const skipped = ids.slice(MAX_PANES)
    if (skipped.length > 0) blocks.push(panesSkipped(skipped))
    // The model is told in its context; the person sent the prompt believing the panes went with it.
    const told = [
      ...(unread.length > 0 ? [`could not read ${unread.join(', ')}`] : []),
      ...(skipped.length > 0 ? [`read the first ${MAX_PANES} panes, not ${skipped.join(', ')}`] : []),
    ]
    if (told.length > 0) $.ui.toast(`pane-peek: ${told.join('; ')}`)

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
    const isReading = problem === null && !(await read($, isLoaded))
    const columns = e.props.bodyColumns ?? 80
    // what herdr last listed is not offered once it stops answering: those panes may be gone
    const list = problem === null ? filterPanes(all, q) : []
    const total = Math.max(list.length, all.filter(p => !p.isThis).length)
    const target = effective(list, await read($, selected))
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
          {problem === null && !isReading && <Text dimColor>{` ${list.length}/${total}`}</Text>}
        </Box>
        {problem !== null && <Text color="error">{problem}</Text>}
        {isReading && <Text color="inactive">Reading herdr…</Text>}
        {problem === null && !isReading && list.length === 0 && <Text color="inactive">No panes found.</Text>}
        {groups.map(g => (
          <Box key={`ws:${g.workspaceId}`} flexDirection="column">
            <Text bold color="claude">{g.workspace}</Text>
            {g.panes.map(p => {
              const { name, title } = rowParts(p, columns - 4)

              return (
                <Box key={`pane:${p.paneId}`}>
                  <Text color="claude">{p.paneId === target?.paneId ? '❯' : ' '}</Text>
                  <Text color={statusColor(p.status)}>● </Text>
                  <Button plain key={`row:${p.paneId}`} onPress={() => pick($, p.paneId)}>
                    {name}
                    <Text dimColor>{title}</Text>
                  </Button>
                </Box>
              )
            })}
          </Box>
        ))}
        {hidden > 0 && <Text color="inactive">{`… ${hidden} more, narrow the search`}</Text>}
        <Text color="inactive">↑↓ choose · ⏎ insert · esc close</Text>
      </Box>
    )
  })
}
