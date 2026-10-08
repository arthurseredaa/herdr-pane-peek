import { expect, mock, test } from 'claude-code/testing'

import { base, clip, decorate, describeOrigin, effective, expandDeletion, filterPanes, findTokens, formatToken, paneContext, paneUnreadable, parseSnapshot, rowLabel, tokenIds } from './peek'

// The kit raises `prompt.edit` through a method its typings do not list.
type Edited = { text: string; cursor: number; decorations?: { start: number; end: number; backgroundColor?: string }[] }
const edit = ($: unknown, input: unknown) => ($ as { prompt: { edit: (input: unknown) => Promise<Edited> } }).prompt.edit(input)

const SNAPSHOT = JSON.stringify({
  result: {
    snapshot: {
      workspaces: [
        { workspace_id: 'w2', label: 'career-ops', number: 2 },
        { workspace_id: 'w1', label: 'ai-news', number: 1 },
      ],
      tabs: [
        { tab_id: 'w2:t1', label: '1', number: 1 },
        { tab_id: 'w1:t1', label: 'main', number: 1 },
      ],
      panes: [
        { pane_id: 'w2:p3', workspace_id: 'w2', tab_id: 'w2:t1', cwd: '/h/Projects/career-ops', terminal_title_stripped: 'user@host:~/Projects/career-ops' },
        { pane_id: 'w2:p4', workspace_id: 'w2', tab_id: 'w2:t1', cwd: '/h/Projects/career-ops', terminal_title_stripped: 'Claude Code' },
        { pane_id: 'w1:p1', workspace_id: 'w1', tab_id: 'w1:t1', cwd: '/h/Projects/ai-news', terminal_title_stripped: 'user@host:~/Projects/ai-news' },
      ],
      agents: [{ pane_id: 'w2:p4', agent: 'claude', agent_status: 'working', terminal_title_stripped: 'Interview prep' }],
    },
  },
})

test('parseSnapshot joins workspaces, tabs and agents, in sidebar order', () => {
  const panes = parseSnapshot(SNAPSHOT, 'w2:p4')
  expect(panes.map(p => p.paneId)).toEqual(['w1:p1', 'w2:p3', 'w2:p4'])
  expect(panes[0]).toEqual({
    paneId: 'w1:p1', workspace: 'ai-news', workspaceNo: 1, tab: 'main', tabNo: 1,
    agent: null, status: 'shell', title: 'user@host:~/Projects/ai-news', cwd: '/h/Projects/ai-news', isThis: false,
  })
  expect(panes[2]).toMatchObject({ agent: 'claude', status: 'working', title: 'Interview prep', isThis: true })
})

test('filterPanes: every word must match somewhere, across workspaces', () => {
  const panes = parseSnapshot(SNAPSHOT, undefined)
  expect(filterPanes(panes, '').length).toBe(3)
  expect(filterPanes(panes, 'career').map(p => p.paneId)).toEqual(['w2:p3', 'w2:p4'])
  expect(filterPanes(panes, 'career claude').map(p => p.paneId)).toEqual(['w2:p4'])
  expect(filterPanes(panes, 'interview WORKING').map(p => p.paneId)).toEqual(['w2:p4'])
  expect(filterPanes(panes, 'w1:p1').map(p => p.paneId)).toEqual(['w1:p1'])
  expect(filterPanes(panes, 'nope')).toEqual([])
})

test('effective keeps the ring row while listed, else the first', () => {
  const panes = parseSnapshot(SNAPSHOT, undefined)
  expect(effective(panes, 'w2:p3')?.paneId).toBe('w2:p3')
  expect(effective(panes, 'gone')?.paneId).toBe('w1:p1')
  expect(effective([], null)).toBeUndefined()
})

test('rowLabel, clip, base', () => {
  const [shell, , agent] = parseSnapshot(SNAPSHOT, 'w2:p4')
  expect(rowLabel(shell!, false, 200)).toBe('  w1:p1  ai-news/main · shell · ai-news')
  expect(rowLabel(agent!, true, 200)).toBe('▸ w2:p4  career-ops/1 · claude working · career-ops (this) — Interview prep')
  expect(clip('abcdef', 4)).toBe('abc…')
  expect(base('/a/b/career-ops')).toBe('career-ops')
})

test('/pane-peek opens a focused pane', async ($, on) => {
  const opened: { id: string; focus?: true }[] = []
  mock.env(on, { HERDR_PANE_ID: 'w2:p4' })
  on('ui.open', (_$, e) => {
    opened.push({ id: e.id, focus: e.focus })

    return { value: { isPlaced: true as const } }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: SNAPSHOT, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))

  const out = await $.command.run({ command: 'pane-peek', args: '' } as never)

  expect(opened).toEqual([{ id: 'pane-peek', focus: true }])
  expect(out.text).toContain('Enter')
})

test('formatToken, findTokens and decorate', () => {
  expect(formatToken('w1E:p4')).toBe('[herdr-id:w1E:p4]')
  const text = 'see [herdr-id:w1E:p4] and [herdr-id:w2:p1] ok [not-a-token] [herdr-id:]'
  expect(findTokens(text)).toEqual([
    { start: 4, end: 21 },
    { start: 26, end: 42 },
  ])
  const runs = decorate(text)
  expect(runs.length).toBe(2)
  expect(runs[0]).toMatchObject({ start: 4, end: 21, color: 'inverseText', backgroundColor: 'suggestion' })
})

test('expandDeletion: a deletion touching a token takes all of it', () => {
  const text = 'look at [herdr-id:w1E:p4] now' // token spans 8..25
  // Backspace right after the closing bracket removes `]` only; the whole token goes.
  expect(expandDeletion(text, 24, 25)).toEqual({ text: 'look at  now', cursor: 8 })
  // Backspace from inside, Delete on the opening bracket, a selection crossing one edge.
  expect(expandDeletion(text, 12, 13)).toEqual({ text: 'look at  now', cursor: 8 })
  expect(expandDeletion(text, 8, 9)).toEqual({ text: 'look at  now', cursor: 8 })
  expect(expandDeletion(text, 3, 10)).toEqual({ text: 'loo now', cursor: 3 })
  // Edits that miss the token are left to the editor: the char before it, the space after it.
  expect(expandDeletion(text, 7, 8)).toBeNull()
  expect(expandDeletion(text, 25, 26)).toBeNull()
  expect(expandDeletion('no tokens here', 0, 3)).toBeNull()
})

test('prompt.edit repaints chips and widens a Backspace', async ($, on) => {
  const text = 'a [herdr-id:w1E:p4] b'
  on('prompt.edit', (_$, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))

  const typed = await edit($, {
    origin: { kind: 'composer' },
    text,
    cursor: text.length,
    start: text.length,
    end: text.length,
    inputText: '!',
  })
  expect(typed.text).toBe('a [herdr-id:w1E:p4] b!')
  expect(typed.decorations).toMatchObject([{ start: 2, end: 19, backgroundColor: 'suggestion' }])

  const erased = await edit($, {
    origin: { kind: 'composer' },
    text,
    cursor: 19,
    start: 18,
    end: 19,
    inputText: '',
  })
  expect(erased.text).toBe('a  b')
  expect(erased.cursor).toBe(2)
  expect(erased.decorations ?? []).toEqual([])
})

test('describeOrigin shows workspace/tab and a ~-shortened path', () => {
  const [pane] = parseSnapshot(SNAPSHOT, undefined)
  expect(describeOrigin({ ...pane!, cwd: '/h/Projects/ai-news' }, '/h')).toBe('ai-news/main · ~/Projects/ai-news')
  expect(describeOrigin({ ...pane!, cwd: '/srv/app' }, '/h')).toBe('ai-news/main · /srv/app')
  expect(describeOrigin({ ...pane!, cwd: '/h/x' }, undefined)).toBe('ai-news/main · /h/x')
})

test('picking a row inserts the chip and toasts where the pane lives', async ($, on) => {
  const filled: { text: string; mode?: string }[] = []
  const toasts: string[] = []
  mock.env(on, { HERDR_PANE_ID: 'w2:p4', HOME: '/h' })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.close', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: SNAPSHOT, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('prompt.fill', (_$, e) => {
    filled.push({ text: e.text, mode: e.mode })

    return { isFilled: true }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  await $.command.run({ command: 'pane-peek', args: '' } as never)
  const ui = await $.ui.mount({
    plugin: 'pane-peek',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'pane-peek',
    props: { bodyColumns: 80 } as never,
  })
  await ui.press({ key: 'row:w1:p1' })

  expect(filled).toEqual([{ text: '[herdr-id:w1:p1] ', mode: 'insert' }])
  expect(toasts).toEqual(['inserted pane from ai-news/main · ~/Projects/ai-news'])
  await ui.unmount()
})

test('tokenIds: distinct ids in order, capped at three', () => {
  expect(tokenIds('no markers')).toEqual([])
  expect(tokenIds('a [herdr-id:w1:p1] b [herdr-id:w2:p3] c [herdr-id:w1:p1]')).toEqual(['w1:p1', 'w2:p3'])
  expect(tokenIds('[herdr-id:a][herdr-id:b][herdr-id:c][herdr-id:d]')).toEqual(['a', 'b', 'c'])
})

test('paneContext names the pane, keeps the tail of long output, handles empty panes', () => {
  const text = paneContext('w1:p1', 'line 1\nline 2\n')
  expect(text).toContain('herdr pane w1:p1')
  expect(text).toContain('[herdr-id:w1:p1]')
  expect(text).toContain('```\nline 1\nline 2\n```')
  expect(paneContext('w1:p1', 'x'.repeat(50_000)).length).toBeLessThan(21_000)
  expect(paneContext('w1:p1', '  \n')).toContain('(the pane is empty)')
  expect(paneUnreadable('w9:p9', 'pane not found')).toContain('could not be read (pane not found)')
})

test('prompt.submit reads each marked pane and attaches it as context', async ($, on) => {
  const argvs: string[][] = []
  on('process.run', (_$, e) => {
    argvs.push([...e.argv])

    return {
      value: {
        exitCode: e.argv[3] === 'w9:p9' ? 1 : 0,
        stdout: e.argv[3] === 'w9:p9' ? '' : `output of ${e.argv[3]}`,
        stderr: e.argv[3] === 'w9:p9' ? 'pane not found' : '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))

  const sent = await $.prompt.submit({ text: 'see [herdr-id:w1:p1] and [herdr-id:w9:p9] why?', context: ['earlier'] } as never)

  expect(argvs).toEqual([
    ['herdr', 'pane', 'read', 'w1:p1', '--source', 'recent-unwrapped', '--lines', '120'],
    ['herdr', 'pane', 'read', 'w9:p9', '--source', 'recent-unwrapped', '--lines', '120'],
  ])
  expect(sent.text).toBe('see [herdr-id:w1:p1] and [herdr-id:w9:p9] why?')
  expect(sent.context?.[0]).toBe('earlier')
  expect(sent.context?.[1]).toContain('output of w1:p1')
  expect(sent.context?.[2]).toContain('could not be read (pane not found)')

  argvs.length = 0
  const plain = await $.prompt.submit({ text: 'no marker here' } as never)
  expect(argvs).toEqual([])
  expect(plain.context ?? []).toEqual([])
})
