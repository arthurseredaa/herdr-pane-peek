import { expect, mock, test } from 'claude-code/testing'

import { base, clip, decorate, describeOrigin, effective, expandDeletion, filterPanes, findTokens, formatToken, herdrError, layoutRows, notRun, paneContext, paneUnreadable, parseSnapshot, rowParts, statusColor, suggestRow, tilde, tokenIds, tokenQuery } from './peek'

// The kit raises `prompt.edit` through a method its typings do not list.
type Edited = { text: string; cursor: number; decorations?: { start: number; end: number; backgroundColor?: string }[] }
const edit = ($: unknown, input: unknown) => ($ as { prompt: { edit: (input: unknown) => Promise<Edited> } }).prompt.edit(input)

// So is `prompt.autocomplete`: asked for the token the draft ends on, as the box asks while one types.
type Suggested = { suggestions: { text: string; label?: string; description?: string }[] }
const autocomplete = ($: unknown, text: string) => {
  const start = text.search(/\S+$/)

  return ($ as { prompt: { autocomplete: (input: unknown) => Promise<Suggested> } }).prompt.autocomplete({ text, cursor: text.length, token: text.slice(start), start })
}

const ran = (stdout: string, exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

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
  const panes = parseSnapshot(SNAPSHOT, 'w2:p4', '/h')
  expect(panes.map(p => p.paneId)).toEqual(['w1:p1', 'w2:p4', 'w2:p3'])
  expect(panes[0]).toEqual({
    paneId: 'w1:p1', workspaceId: 'w1', workspace: 'ai-news', workspaceNo: 1, tab: 'main', tabNo: 1, isSplit: false,
    agent: null, status: 'shell', title: 'user@host:~/Projects/ai-news', cwd: '/h/Projects/ai-news', path: '~/Projects/ai-news', isThis: false,
  })
  expect(panes[1]).toMatchObject({ agent: 'claude', status: 'working', title: 'Interview prep', isThis: true })
  // w2:p3 and w2:p4 share a tab; without a home folder the path is the cwd
  expect(panes.map(p => p.isSplit)).toEqual([false, true, true])
  expect(parseSnapshot(SNAPSHOT, undefined)[0]!.path).toBe('/h/Projects/ai-news')
})

test('tilde: the home folder as ~, only where the path is inside it', () => {
  expect(tilde('/Users/sam/code/x', '/Users/sam')).toBe('~/code/x')
  expect(tilde('/Users/sam', '/Users/sam')).toBe('~')
  expect(tilde('/Users/samantha/x', '/Users/sam')).toBe('/Users/samantha/x')
  expect(tilde('/srv/app', '/Users/sam')).toBe('/srv/app')
  expect(tilde('/srv/app', undefined)).toBe('/srv/app')
  expect(tilde('/srv/app', '')).toBe('/srv/app')
})

test('parseSnapshot puts blocked and working agents above idle ones and shells, inside a workspace', () => {
  const snap = JSON.stringify({
    result: {
      snapshot: {
        workspaces: [{ workspace_id: 'w1', label: 'a', number: 1 }, { workspace_id: 'w2', label: 'b', number: 2 }],
        tabs: [{ tab_id: 't', label: '1', number: 1 }],
        panes: [
          { pane_id: 'w1:shell', workspace_id: 'w1', tab_id: 't' },
          { pane_id: 'w1:idle', workspace_id: 'w1', tab_id: 't' },
          { pane_id: 'w1:work', workspace_id: 'w1', tab_id: 't' },
          { pane_id: 'w1:block', workspace_id: 'w1', tab_id: 't' },
          { pane_id: 'w2:idle', workspace_id: 'w2', tab_id: 't' },
        ],
        agents: [
          { pane_id: 'w1:idle', agent: 'claude', agent_status: 'idle' },
          { pane_id: 'w1:work', agent: 'claude', agent_status: 'working' },
          { pane_id: 'w1:block', agent: 'claude', agent_status: 'blocked' },
          { pane_id: 'w2:idle', agent: 'claude', agent_status: 'idle' },
        ],
      },
    },
  })
  expect(parseSnapshot(snap, undefined).map(p => p.paneId)).toEqual(['w1:block', 'w1:work', 'w1:idle', 'w1:shell', 'w2:idle'])
})

test('filterPanes: every word must match somewhere, across workspaces', () => {
  const panes = parseSnapshot(SNAPSHOT, undefined)
  expect(filterPanes(panes, '').length).toBe(3)
  // the pane you are in stays out of the list until you ask for it with "this"
  const mine = parseSnapshot(SNAPSHOT, 'w2:p4')
  expect(filterPanes(mine, '').map(p => p.paneId)).toEqual(['w1:p1', 'w2:p3'])
  expect(filterPanes(mine, 'career').map(p => p.paneId)).toEqual(['w2:p3'])
  expect(filterPanes(mine, 'this').map(p => p.paneId)).toEqual(['w2:p4'])
  expect(filterPanes(mine, 'this career').map(p => p.paneId)).toEqual(['w2:p4'])
  expect(filterPanes(panes, 'career').map(p => p.paneId)).toEqual(['w2:p4', 'w2:p3'])
  expect(filterPanes(panes, 'career claude').map(p => p.paneId)).toEqual(['w2:p4'])
  expect(filterPanes(panes, 'interview WORKING').map(p => p.paneId)).toEqual(['w2:p4'])
  expect(filterPanes(panes, 'w1:p1').map(p => p.paneId)).toEqual(['w1:p1'])
  expect(filterPanes(panes, 'nope')).toEqual([])
})

test('filterPanes reads what a row shows, not a shell title or the home folder above the path', () => {
  const panes = parseSnapshot(SNAPSHOT, undefined, '/h')
  // every shell's title is `user@host:~/...`, and every cwd starts with /h/
  expect(filterPanes(panes, 'host')).toEqual([])
  expect(filterPanes(panes, '/h/')).toEqual([])
  expect(filterPanes(panes, '~/projects').length).toBe(3)
  expect(filterPanes(panes, 'p3').map(p => p.paneId)).toEqual(['w2:p3'])
})

const RANKED = JSON.stringify({
  result: {
    snapshot: {
      workspaces: [{ workspace_id: 'wa', label: 'api', number: 1 }, { workspace_id: 'wb', label: 'web', number: 2 }],
      tabs: [{ tab_id: 'wa:t1', label: '1', number: 1 }, { tab_id: 'wa:t2', label: '2', number: 2 }, { tab_id: 'wb:t1', label: '1', number: 1 }],
      panes: [
        { pane_id: 'wa:p1', workspace_id: 'wa', tab_id: 'wa:t1', cwd: '/x/api' },
        { pane_id: 'wa:p2', workspace_id: 'wa', tab_id: 'wa:t2', cwd: '/x/web-tools' },
        { pane_id: 'wb:p1', workspace_id: 'wb', tab_id: 'wb:t1', cwd: '/x/web' },
      ],
      agents: [{ pane_id: 'wa:p1', agent: 'claude', agent_status: 'idle', terminal_title_stripped: 'fix web layout' }],
    },
  },
})

test('filterPanes: a pane named by the search comes before one that only mentions it, workspaces kept whole', () => {
  const panes = parseSnapshot(RANKED, undefined)
  expect(panes.map(p => p.paneId)).toEqual(['wa:p1', 'wa:p2', 'wb:p1'])
  // wa:p1 says "web" in its session title only; wa:p2's folder and wb's name carry it
  expect(filterPanes(panes, 'web').map(p => p.paneId)).toEqual(['wa:p2', 'wa:p1', 'wb:p1'])
  // a workspace whose best match is a mention goes after one that is named
  expect(filterPanes(panes.filter(p => p.paneId !== 'wa:p2'), 'web').map(p => p.paneId)).toEqual(['wb:p1', 'wa:p1'])
  expect(filterPanes(panes, '').map(p => p.paneId)).toEqual(['wa:p1', 'wa:p2', 'wb:p1'])
})

test('layoutRows groups by workspace and cuts the list to the room it has', () => {
  const panes = parseSnapshot(SNAPSHOT, undefined)
  expect(layoutRows(panes, 10)).toEqual({
    groups: [
      { workspaceId: 'w1', workspace: 'ai-news', panes: [panes[0]] },
      { workspaceId: 'w2', workspace: 'career-ops', panes: [panes[1], panes[2]] },
    ],
    hidden: 0,
  })
  // a header costs a line: 4 lines hold ai-news (2) and one career-ops row (2)
  const cut = layoutRows(panes, 4)
  expect(cut.groups.map(g => g.panes.length)).toEqual([1, 1])
  expect(cut.hidden).toBe(1)
  expect(layoutRows([], 5)).toEqual({ groups: [], hidden: 0 })
})

test('layoutRows keeps two workspaces of one name apart', () => {
  const [a] = parseSnapshot(SNAPSHOT, undefined)
  const twins = [{ ...a!, workspaceId: 'w1', workspace: 'same' }, { ...a!, paneId: 'w7:p1', workspaceId: 'w7', workspace: 'same' }]
  expect(layoutRows(twins, 10).groups.map(g => [g.workspaceId, g.panes.length])).toEqual([['w1', 1], ['w7', 1]])
})

test('effective keeps the ring row while listed, else the first', () => {
  const panes = parseSnapshot(SNAPSHOT, undefined)
  expect(effective(panes, 'w2:p3')?.paneId).toBe('w2:p3')
  expect(effective(panes, 'gone')?.paneId).toBe('w1:p1')
  expect(effective([], null)).toBeUndefined()
})

test('rowParts, clip, base, statusColor', () => {
  const [shell, agent] = parseSnapshot(SNAPSHOT, 'w2:p4')
  expect(rowParts(shell!, 200)).toEqual({ name: 'main · shell · ai-news', title: '' })
  // a pane that shares its tab is told from its neighbours by the pane part of its id
  expect(rowParts(agent!, 200)).toEqual({ name: '1/p4 · claude working · career-ops (this)', title: ' — Interview prep' })
  // the title gives way first, then the name; 41 columns hold the name whole
  expect(rowParts(agent!, 50)).toEqual({ name: '1/p4 · claude working · career-ops (this)', title: ' — Inter…' })
  expect(rowParts(agent!, 43)).toEqual({ name: '1/p4 · claude working · career-ops (this)', title: '' })
  expect(rowParts(agent!, 10)).toEqual({ name: '1/p4 · cl…', title: '' })
  expect(statusColor('working')).toBe('ide')
  expect(statusColor('blocked')).toBe('error')
  expect(statusColor('idle')).toBe('warning')
  expect(statusColor('done')).toBe('success')
  expect(statusColor('shell')).toBe('inactive')
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
  expect(out.text).toBeUndefined()
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
  expect(describeOrigin(parseSnapshot(SNAPSHOT, undefined, '/h')[0]!)).toBe('ai-news/main · ~/Projects/ai-news')
  expect(describeOrigin(parseSnapshot(SNAPSHOT, undefined, '/elsewhere')[0]!)).toBe('ai-news/main · /h/Projects/ai-news')
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

test('the picker groups rows by workspace, hides this pane and counts matches', async ($, on) => {
  mock.env(on, { HERDR_PANE_ID: 'w2:p4', HOME: '/h' })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: SNAPSHOT, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))

  await $.command.run({ command: 'pane-peek', args: '' } as never)
  const ui = await $.ui.mount({
    plugin: 'pane-peek',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'pane-peek',
    props: { bodyColumns: 80 } as never,
  })

  const rows = await ui.findAll({ type: 'Button' })
  expect(rows.map(r => r.key)).toEqual(['row:w1:p1', 'row:w2:p3'])
  expect(rows.map(r => r.text)).toEqual(['main · shell · ai-news', '1/p3 · shell · career-ops'])
  expect(await ui.find({ text: 'career-ops' })).toBeDefined()
  expect(await ui.find({ text: ' 2/2' })).toBeDefined()

  await ui.input({ key: 'q', text: 'this', kind: 'change' })
  expect((await ui.findAll({ type: 'Button' })).map(r => r.key)).toEqual(['row:w2:p4'])
  expect(await ui.find({ text: ' 1/2' })).toBeDefined()
  await ui.unmount()
})

const PICKER = { plugin: 'pane-peek', surface: 'terminal', component: 'Pane', requestId: 'pane-peek', props: { bodyColumns: 80 } as never } as const
const EMPTY = JSON.stringify({ result: { snapshot: { workspaces: [], tabs: [], panes: [] } } })

test('until herdr has answered the picker says it is reading, not that there are no panes', async ($, on) => {
  mock.env(on, {})
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('process.run', () => ran(EMPTY))

  const ui = await $.ui.mount(PICKER)
  const before = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(before).toContain('Reading herdr…')
  expect(before).not.toContain('No panes found.')

  await $.command.run({ command: 'pane-peek', args: '' } as never)
  const after = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(after).toContain('No panes found.')
  expect(after).not.toContain('Reading herdr…')
  await ui.unmount()
})

test('the row Enter would insert carries the pointer: the first match, then the row the ring was on', async ($, on) => {
  mock.env(on, {})
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.focus', () => ({}))
  on('process.run', () => ran(SNAPSHOT))

  await $.command.run({ command: 'pane-peek', args: '' } as never)
  const ui = await $.ui.mount(PICKER)
  // one pointer cell per row, in row order: w1:p1, w2:p4, w2:p3
  const pointers = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text).filter(t => t === '❯' || t === ' ')
  expect(await pointers()).toEqual(['❯', ' ', ' '])

  await ($ as unknown as { ui: { focus: (e: unknown) => Promise<unknown> } }).ui.focus({ requestId: 'pane-peek', element: 'row:w2:p3' })
  expect(await pointers()).toEqual([' ', ' ', '❯'])

  await ui.input({ key: 'q', text: 'claude', kind: 'change' })
  expect(await pointers()).toEqual(['❯'])
  await ui.unmount()
})

test('a session title is drawn dim beside the pane name, inside the one row', async ($, on) => {
  mock.env(on, {})
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('process.run', () => ran(SNAPSHOT))

  await $.command.run({ command: 'pane-peek', args: '' } as never)
  const ui = await $.ui.mount(PICKER)

  expect((await ui.find({ key: 'row:w2:p4' }))?.text).toBe('1/p4 · claude working · career-ops — Interview prep')
  expect((await ui.findAll({ type: 'Text', text: ' — Interview prep' })).length).toBe(1)
  await ui.unmount()
})

test('when herdr stops answering the picker says so in its words and offers no stale rows', async ($, on) => {
  let isUp = true
  const filled: string[] = []
  const clock = mock.clock(on)
  mock.env(on, {})
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.close', () => ({ value: undefined }))
  on('process.run', () => (isUp ? ran(SNAPSHOT) : ran('', 1, '{"error":{"code":"no_server","message":"server is not running"}}')))
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)

    return { isFilled: true }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))

  // the refresh timer is set as the session starts
  await $.session.start({ cwd: '/h', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'pane-peek', args: '' } as never)
  const ui = await $.ui.mount(PICKER)
  expect((await ui.findAll({ type: 'Button' })).length).toBe(3)

  isUp = false
  await clock.advance(5_000)
  expect(await ui.findAll({ type: 'Button' })).toEqual([])
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toContain('herdr: server is not running')

  await ui.input({ key: 'q', text: '' })
  expect(filled).toEqual([])
  await ui.unmount()
})

test('tokenIds: every distinct id, in order', () => {
  expect(tokenIds('no markers')).toEqual([])
  expect(tokenIds('a [herdr-id:w1:p1] b [herdr-id:w2:p3] c [herdr-id:w1:p1]')).toEqual(['w1:p1', 'w2:p3'])
  expect(tokenIds('[herdr-id:a][herdr-id:b][herdr-id:c][herdr-id:d]')).toEqual(['a', 'b', 'c', 'd'])
})

test("herdrError: the message out of herdr's JSON error, else the text, else the exit code", () => {
  expect(herdrError('{"error":{"code":"pane_not_found","message":"pane w99:p9 not found"},"id":"cli:pane:read"}\n', 1)).toBe('pane w99:p9 not found')
  expect(herdrError(' no server \n', 1)).toBe('no server')
  expect(herdrError('{"error":{}}', 1)).toBe('{"error":{}}')
  expect(herdrError('', 2)).toBe('exit 2')
})

test('notRun: a herdr that is not installed is said in one line, any other reason as it came', () => {
  expect(notRun('pane-peek: $.process.run(herdr) failed to start: ENOENT: Executable not found in $PATH: "herdr"')).toBe('herdr is not on PATH; is this session inside herdr?')
  expect(notRun('timed out after 5000 ms')).toBe('timed out after 5000 ms')
})

test('paneContext tells the model where the pane lives and what runs there', () => {
  const [shell, agent] = parseSnapshot(SNAPSHOT, undefined)
  expect(paneContext('w1:p1', 'x', shell)).toContain('workspace "ai-news", tab "main", cwd /h/Projects/ai-news, a plain shell.')
  expect(paneContext('w2:p4', 'x', agent)).toContain('workspace "career-ops", tab "1", cwd /h/Projects/career-ops, running claude (working), session "Interview prep".')
  // a pane herdr no longer lists is attached all the same, without the line
  expect(paneContext('w1:p1', 'x')).not.toContain('workspace')
})

test('paneContext fences the output with more backticks than it holds', () => {
  expect(paneContext('w1:p1', 'a\n```\nb')).toContain('````\na\n```\nb\n````')
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

// herdr as `prompt.submit` meets it: the snapshot, then one read per pane.
const herdr = (read: (paneId: string) => ReturnType<typeof ran>, snapshot = ran(SNAPSHOT)) => (_$: unknown, e: { argv: readonly string[] }) =>
  e.argv[1] === 'api' ? snapshot : read(e.argv[3]!)

test('prompt.submit reads each marked pane and attaches it as context', async ($, on) => {
  const argvs: string[][] = []
  mock.env(on, {})
  on('process.run', (_$, e) => {
    argvs.push([...e.argv])

    return herdr(id => (id === 'w9:p9' ? ran('', 1, '{"error":{"code":"pane_not_found","message":"pane w9:p9 not found"}}') : ran(`output of ${id}`)))(_$, e)
  })
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  on('ui.toast', () => ({ value: undefined }))

  const sent = await $.prompt.submit({ text: 'see [herdr-id:w1:p1] and [herdr-id:w9:p9] why?', context: ['earlier'] } as never)

  expect(argvs).toEqual([
    ['herdr', 'api', 'snapshot'],
    ['herdr', 'pane', 'read', 'w1:p1', '--source', 'recent-unwrapped', '--lines', '120'],
    ['herdr', 'pane', 'read', 'w9:p9', '--source', 'recent-unwrapped', '--lines', '120'],
  ])
  expect(sent.text).toBe('see [herdr-id:w1:p1] and [herdr-id:w9:p9] why?')
  expect(sent.context?.[0]).toBe('earlier')
  expect(sent.context?.[1]).toContain('output of w1:p1')
  expect(sent.context?.[1]).toContain('cwd /h/Projects/ai-news, a plain shell.')
  expect(sent.context?.[2]).toContain('could not be read (pane w9:p9 not found)')

  argvs.length = 0
  const plain = await $.prompt.submit({ text: 'no marker here' } as never)
  expect(argvs).toEqual([])
  expect(plain.context ?? []).toEqual([])
})

test('a pane herdr does not answer for costs that pane alone, and the person is told', async ($, on) => {
  const toasts: string[] = []
  on('process.run', (_$, e) => {
    // a throw here reaches the mod as a rejected run (the kit words the reason itself), as a timeout does
    if (e.argv[3] === 'w1:p1') throw new Error('timed out')

    return herdr(id => ran(`output of ${id}`))(_$, e)
  })
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  const sent = await $.prompt.submit({ text: '[herdr-id:w1:p1] [herdr-id:w2:p3]' } as never)

  expect(sent.context?.length).toBe(2)
  expect(sent.context?.[0]).toContain('herdr pane w1:p1 but it could not be read (')
  expect(sent.context?.[1]).toContain('output of w2:p3')
  expect(toasts.map(t => t.slice(0, 33))).toEqual(['pane-peek: could not read w1:p1 ('])
})

test('with no snapshot to place them, marked panes are read all the same', async ($, on) => {
  on('process.run', herdr(id => ran(`output of ${id}`), ran('', 1, 'no server')))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))

  const sent = await $.prompt.submit({ text: '[herdr-id:w1:p1]' } as never)

  expect(sent.context?.length).toBe(1)
  expect(sent.context?.[0]).toContain('output of w1:p1')
})

test('past three marked panes the rest are named to the model and the person, not read', async ($, on) => {
  const read: string[] = []
  const toasts: string[] = []
  on('process.run', herdr(id => {
    read.push(id)

    return ran(`output of ${id}`)
  }))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  const sent = await $.prompt.submit({ text: '[herdr-id:a] [herdr-id:b] [herdr-id:c] [herdr-id:d] [herdr-id:e]' } as never)

  expect(read).toEqual(['a', 'b', 'c'])
  expect(sent.context?.length).toBe(4)
  expect(sent.context?.[3]).toContain('herdr panes d, e')
  expect(sent.context?.[3]).toContain('not read')
  expect(toasts).toEqual(['pane-peek: read the first 3 panes, not d, e'])
})

test('tokenQuery: the words after the % trigger, commas standing in for spaces', () => {
  const panes = parseSnapshot(SNAPSHOT, undefined)
  expect(tokenQuery('%')).toBe('')
  expect(filterPanes(panes, tokenQuery('%career')).map(p => p.paneId)).toEqual(['w2:p4', 'w2:p3'])
  expect(filterPanes(panes, tokenQuery('%career,claude')).map(p => p.paneId)).toEqual(['w2:p4'])
})

test('suggestRow: the marker to write, a one-line label and the session title beside it', () => {
  const [shell, agent] = parseSnapshot(SNAPSHOT, 'w2:p4')
  expect(suggestRow(shell!)).toEqual({ text: '[herdr-id:w1:p1] ', label: 'ai-news · main · shell · ai-news' })
  expect(suggestRow(agent!)).toEqual({
    text: '[herdr-id:w2:p4] ',
    label: 'career-ops · 1/p4 · claude working · career-ops (this)',
    description: 'Interview prep',
  })
})

test('a %word in the prompt offers the matching panes beneath the rows already there', async ($, on) => {
  mock.env(on, { HERDR_PANE_ID: 'w2:p4' })
  mock.clock(on)
  on('process.run', () => ran(SNAPSHOT))
  on('prompt.autocomplete', () => ({ suggestions: [{ text: '#1' }] }))

  expect((await autocomplete($, 'look at %')).suggestions).toEqual([
    { text: '#1' },
    { text: '[herdr-id:w1:p1] ', label: 'ai-news · main · shell · ai-news' },
    { text: '[herdr-id:w2:p3] ', label: 'career-ops · 1/p3 · shell · career-ops' },
  ])
  expect((await autocomplete($, 'look at %career')).suggestions.map(s => s.text)).toEqual(['#1', '[herdr-id:w2:p3] '])
  expect((await autocomplete($, 'look at %this,claude')).suggestions.map(s => s.text)).toEqual(['#1', '[herdr-id:w2:p4] '])
})

test('a token that does not start with % asks herdr nothing and adds no rows', async ($, on) => {
  let asked = 0
  mock.clock(on)
  on('process.run', () => {
    asked += 1

    return ran(SNAPSHOT)
  })
  on('prompt.autocomplete', () => ({ suggestions: [{ text: '#1' }] }))

  expect((await autocomplete($, 'about 50%')).suggestions).toEqual([{ text: '#1' }])
  expect(asked).toBe(0)
})

test('a %word typed while the picker is open closes the picker: the typeahead lists the panes', async ($, on) => {
  const closed: string[] = []
  mock.env(on, {})
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.close', (_$, e) => {
    closed.push(e.id)

    return { value: undefined }
  })
  on('process.run', () => ran(SNAPSHOT))
  on('prompt.autocomplete', () => ({ suggestions: [] }))

  await $.command.run({ command: 'pane-peek', args: '' } as never)
  const offered = await autocomplete($, 'look at %career')

  expect(closed).toEqual(['pane-peek'])
  expect(offered.suggestions.map(s => s.text)).toEqual(['[herdr-id:w2:p4] ', '[herdr-id:w2:p3] '])

  // once closed there is nothing left to close
  await autocomplete($, 'look at %career,claude')
  expect(closed).toEqual(['pane-peek'])
})

test('a token that does not start with % leaves an open picker alone', async ($, on) => {
  const closed: string[] = []
  mock.env(on, {})
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.close', (_$, e) => {
    closed.push(e.id)

    return { value: undefined }
  })
  on('process.run', () => ran(SNAPSHOT))
  on('prompt.autocomplete', () => ({ suggestions: [] }))

  await $.command.run({ command: 'pane-peek', args: '' } as never)
  await autocomplete($, 'about 50%')

  expect(closed).toEqual([])
})

test('the panes behind the typeahead are read again only once they are five seconds old', async ($, on) => {
  let asked = 0
  const clock = mock.clock(on)
  on('process.run', () => {
    asked += 1

    return ran(SNAPSHOT)
  })
  on('prompt.autocomplete', () => ({ suggestions: [] }))

  await autocomplete($, '%')
  await autocomplete($, '%c')
  await clock.advance(4_999)
  await autocomplete($, '%ca')
  expect(asked).toBe(1)

  await clock.advance(1)
  await autocomplete($, '%car')
  expect(asked).toBe(2)
})

test('once herdr stops answering the typeahead offers no panes, not the ones it last saw', async ($, on) => {
  let isUp = true
  const clock = mock.clock(on)
  mock.env(on, {})
  on('process.run', () => (isUp ? ran(SNAPSHOT) : ran('', 1, 'no server')))
  on('prompt.autocomplete', () => ({ suggestions: [{ text: '#1' }] }))

  expect((await autocomplete($, '%')).suggestions.length).toBe(4)

  isUp = false
  await clock.advance(5_000)
  expect((await autocomplete($, '%')).suggestions).toEqual([{ text: '#1' }])
})

test('the typeahead offers eight panes at most', async ($, on) => {
  const ids = Array.from({ length: 10 }, (_, i) => `w1:p${i + 1}`)
  mock.env(on, {})
  mock.clock(on)
  on('process.run', () =>
    ran(
      JSON.stringify({
        result: {
          snapshot: {
            workspaces: [{ workspace_id: 'w1', label: 'a', number: 1 }],
            tabs: [{ tab_id: 'w1:t1', label: 't', number: 1 }],
            panes: ids.map(pane_id => ({ pane_id, workspace_id: 'w1', tab_id: 'w1:t1', cwd: '/x' })),
          },
        },
      }),
    ),
  )
  on('prompt.autocomplete', () => ({ suggestions: [] }))

  expect((await autocomplete($, '%')).suggestions.map(s => s.text)).toEqual(ids.slice(0, 8).map(id => `[herdr-id:${id}] `))
})
