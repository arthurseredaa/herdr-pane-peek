import type { PeekPane } from '../types'

type Snapshot = {
  result?: {
    snapshot?: {
      workspaces?: { workspace_id: string; label?: string; number?: number }[]
      tabs?: { tab_id: string; label?: string; number?: number }[]
      panes?: {
        pane_id: string
        workspace_id: string
        tab_id: string
        cwd?: string
        terminal_title_stripped?: string
      }[]
      agents?: { pane_id: string; agent?: string; agent_status?: string; terminal_title_stripped?: string }[]
    }
  }
}

/** `herdr api snapshot` -> every pane of every workspace, in sidebar order. */
export function parseSnapshot(json: string, thisPane: string | undefined): PeekPane[] {
  const snap = (JSON.parse(json) as Snapshot).result?.snapshot ?? {}
  const workspaces = new Map((snap.workspaces ?? []).map(w => [w.workspace_id, w]))
  const tabs = new Map((snap.tabs ?? []).map(t => [t.tab_id, t]))
  const agents = new Map((snap.agents ?? []).map(a => [a.pane_id, a]))

  const panes = (snap.panes ?? []).map((p): PeekPane => {
    const ws = workspaces.get(p.workspace_id)
    const tab = tabs.get(p.tab_id)
    const agent = agents.get(p.pane_id)

    return {
      paneId: p.pane_id,
      workspace: ws?.label ?? p.workspace_id,
      workspaceNo: ws?.number ?? 0,
      tab: tab?.label ?? p.tab_id,
      tabNo: tab?.number ?? 0,
      agent: agent?.agent ?? null,
      status: agent?.agent_status ?? 'shell',
      title: agent?.terminal_title_stripped ?? p.terminal_title_stripped ?? '',
      cwd: p.cwd ?? '',
      isThis: p.pane_id === thisPane,
    }
  })

  // Array.prototype.sort is stable: panes keep herdr's order inside a tab.
  return panes.sort((a, b) => a.workspaceNo - b.workspaceNo || a.tabNo - b.tabNo)
}

export function base(cwd: string): string {
  return cwd.split('/').filter(Boolean).pop() ?? cwd
}

/** Every word of `query` must occur somewhere in the pane's searchable text. */
export function filterPanes(panes: PeekPane[], query: string): PeekPane[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return panes

  return panes.filter(p => {
    const hay = [p.paneId, p.workspace, p.tab, p.agent ?? 'shell', p.status, p.title, p.cwd].join(' ').toLowerCase()

    return words.every(w => hay.includes(w))
  })
}

export function clip(line: string, columns: number): string {
  return line.length > columns ? `${line.slice(0, Math.max(1, columns - 1))}…` : line
}

export function rowLabel(p: PeekPane, isCurrent: boolean, columns: number): string {
  const kind = p.agent === null ? 'shell' : `${p.agent} ${p.status}`
  const title = p.agent !== null && p.title !== '' ? ` — ${p.title}` : ''
  const line = `${isCurrent ? '▸' : ' '} ${p.paneId}  ${p.workspace}/${p.tab} · ${kind} · ${base(p.cwd)}${p.isThis ? ' (this)' : ''}${title}`

  return clip(line, columns)
}

/** The pane Enter acts on: the ring's row if it is still listed, else the first. */
export function effective(list: PeekPane[], selected: string | null): PeekPane | undefined {
  return list.find(p => p.paneId === selected) ?? list[0]
}
