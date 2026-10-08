import { expect, mock, test } from 'claude-code/testing'

import { base, clip, effective, filterPanes, parseSnapshot, rowLabel } from './peek'

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

    return { value: { isOpen: true } }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: SNAPSHOT, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))

  const out = await $.command.run({ command: 'pane-peek', args: '' })

  expect(opened).toEqual([{ id: 'pane-peek', focus: true }])
  expect(out.text).toContain('Enter')
})
