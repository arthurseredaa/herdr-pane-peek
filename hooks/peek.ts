import type { PromptDecoration } from 'claude-code'

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

/** What the prompt gets for a picked pane: a marker the herdr skill can recognise. */
export function formatToken(paneId: string): string {
  return `[herdr-id:${paneId}]`
}

export type Span = { start: number; end: number }

export function findTokens(text: string): Span[] {
  return [...text.matchAll(/\[herdr-id:[^\]\s]+\]/g)].map(m => ({ start: m.index, end: m.index + m[0].length }))
}

/** Theme keys, so the chip follows the person's theme: Claude's suggestion accent behind inverse text. */
const CHIP = { color: 'inverseText', backgroundColor: 'suggestion', bold: true } as const

export function decorate(text: string): PromptDecoration[] {
  return findTokens(text).map(span => ({ ...span, ...CHIP }))
}

/**
 * A deletion that touches a token takes the whole token with it, like a placeholder chip.
 * `[start, end)` is the span the edit removed from `text`, the draft before the edit.
 * Returns the draft and cursor after the widened deletion, or null when no token is touched.
 */
export function expandDeletion(text: string, start: number, end: number): { text: string; cursor: number } | null {
  let from = start
  let to = end
  for (const t of findTokens(text)) {
    if (t.start < to && t.end > from) {
      from = Math.min(from, t.start)
      to = Math.max(to, t.end)
    }
  }
  if (from === start && to === end) return null

  return { text: text.slice(0, from) + text.slice(to), cursor: from }
}

/** Where a pane lives, for the toast: `workspace/tab · ~/path`. */
export function describeOrigin(p: PeekPane, home: string | undefined): string {
  const short = home !== undefined && home !== '' && p.cwd.startsWith(home) ? `~${p.cwd.slice(home.length)}` : p.cwd

  return `${p.workspace}/${p.tab} · ${short}`
}

export const READ_LINES = 120
export const MAX_PANES = 3
const MAX_CHARS = 20_000

/** The distinct pane ids named by `[herdr-id:...]` markers in `text`, in order, at most MAX_PANES. */
export function tokenIds(text: string): string[] {
  const ids = [...text.matchAll(/\[herdr-id:([^\]\s]+)\]/g)].map(m => m[1]!)

  return [...new Set(ids)].slice(0, MAX_PANES)
}

/** What the model reads beside the prompt for one marked pane. */
export function paneContext(paneId: string, output: string): string {
  const body = output.trim() === '' ? '(the pane is empty)' : output.trimEnd().slice(-MAX_CHARS)

  return [
    `Contents of herdr pane ${paneId}, read when the prompt was sent (\`herdr pane read ${paneId} --source recent-unwrapped --lines ${READ_LINES}\`); a snapshot, not live. The user's marker [herdr-id:${paneId}] refers to this pane. To act in a pane (send input, run commands) use the herdr skill.`,
    '```',
    body,
    '```',
  ].join('\n')
}

export function paneUnreadable(paneId: string, detail: string): string {
  return `The user marked herdr pane ${paneId} but it could not be read (${detail}). Use the herdr skill to find out why if it matters.`
}
