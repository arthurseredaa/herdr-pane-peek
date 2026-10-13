import type { PromptAutocompleteSuggestion, PromptDecoration } from 'claude-code'

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

/** `cwd` with the home folder written `~`, where it lies inside it. */
export function tilde(cwd: string, home: string | undefined): string {
  const root = (home ?? '').replace(/\/+$/, '')
  if (root === '') return cwd
  if (cwd === root) return '~'

  return cwd.startsWith(`${root}/`) ? `~${cwd.slice(root.length)}` : cwd
}

/** `herdr api snapshot` -> every pane of every workspace, in sidebar order. */
export function parseSnapshot(json: string, thisPane: string | undefined, home?: string): PeekPane[] {
  const snap = (JSON.parse(json) as Snapshot).result?.snapshot ?? {}
  const workspaces = new Map((snap.workspaces ?? []).map(w => [w.workspace_id, w]))
  const tabs = new Map((snap.tabs ?? []).map(t => [t.tab_id, t]))
  const agents = new Map((snap.agents ?? []).map(a => [a.pane_id, a]))
  const tabSizes = new Map<string, number>()
  for (const p of snap.panes ?? []) tabSizes.set(p.tab_id, (tabSizes.get(p.tab_id) ?? 0) + 1)

  const panes = (snap.panes ?? []).map((p): PeekPane => {
    const ws = workspaces.get(p.workspace_id)
    const tab = tabs.get(p.tab_id)
    const agent = agents.get(p.pane_id)

    return {
      paneId: p.pane_id,
      workspaceId: p.workspace_id,
      workspace: ws?.label ?? p.workspace_id,
      workspaceNo: ws?.number ?? 0,
      tab: tab?.label ?? p.tab_id,
      tabNo: tab?.number ?? 0,
      isSplit: (tabSizes.get(p.tab_id) ?? 0) > 1,
      agent: agent?.agent ?? null,
      status: agent?.agent_status ?? 'shell',
      title: agent?.terminal_title_stripped ?? p.terminal_title_stripped ?? '',
      cwd: p.cwd ?? '',
      path: tilde(p.cwd ?? '', home),
      isThis: p.pane_id === thisPane,
    }
  })

  // Array.prototype.sort is stable: panes keep herdr's order among equals.
  return panes.sort((a, b) => a.workspaceNo - b.workspaceNo || attention(a) - attention(b) || a.tabNo - b.tabNo)
}

/** Within a workspace the agents that need a look come first: blocked, working, other agents, shells. */
function attention(p: PeekPane): number {
  if (p.agent === null) return 3
  if (p.status === 'blocked') return 0
  if (p.status === 'working') return 1

  return 2
}

export function base(cwd: string): string {
  return cwd.split('/').filter(Boolean).pop() ?? cwd
}

/**
 * Every word of `query` must occur in what the pane's row shows, its id or its path.
 * A pane the words name (workspace, tab, kind, folder, id) comes before one that only
 * mentions them (session title, path), its workspace's panes staying together.
 * The pane you are in is left out of an empty search and found by the word "this".
 */
export function filterPanes(panes: PeekPane[], query: string): PeekPane[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const wantsThis = words.includes('this')
  const pool = wantsThis ? panes : panes.filter(p => !p.isThis)
  if (words.length === 0) return pool

  const found = pool.flatMap(p => {
    const name = [p.paneId, p.workspace, p.tab, kindOf(p), base(p.cwd), p.isThis ? 'this' : ''].join(' ').toLowerCase()
    const mention = `${sessionTitle(p)} ${p.path}`.toLowerCase()
    const unnamed = words.filter(w => !name.includes(w))

    return unnamed.every(w => mention.includes(w)) ? [{ pane: p, unnamed: unnamed.length }] : []
  })
  // a workspace stands where its best pane does, then in list order
  const places = new Map<string, { best: number; order: number }>()
  for (const { pane, unnamed } of found) {
    const place = places.get(pane.workspaceId)
    places.set(pane.workspaceId, { best: Math.min(place?.best ?? unnamed, unnamed), order: place?.order ?? places.size })
  }
  const at = (id: string) => places.get(id)!

  // Array.prototype.sort is stable: panes keep the list's order among equals.
  return found
    .sort((a, b) => {
      const [wa, wb] = [at(a.pane.workspaceId), at(b.pane.workspaceId)]

      return wa.best - wb.best || wa.order - wb.order || a.unnamed - b.unnamed
    })
    .map(f => f.pane)
}

export function clip(line: string, columns: number): string {
  return line.length > columns ? `${line.slice(0, Math.max(1, columns - 1))}…` : line
}

function kindOf(p: PeekPane): string {
  return p.agent === null ? 'shell' : `${p.agent} ${p.status}`
}

/** `tab · kind · folder`, what a pane is called inside its workspace; in a split tab, `tab/p4`: the pane part of its id. */
function paneName(p: PeekPane): string {
  const tab = p.isSplit ? `${p.tab}/${p.paneId.split(':').pop()}` : p.tab

  return `${tab} · ${kindOf(p)} · ${base(p.cwd)}${p.isThis ? ' (this)' : ''}`
}

/** An agent's session title; a shell's title only repeats its cwd. */
function sessionTitle(p: PeekPane): string {
  return p.agent !== null ? p.title : ''
}

/**
 * The row's text in two parts, the title drawn dim after the name; it gives way first where the row is narrow.
 * The workspace is the group heading above and the status dot is drawn beside.
 */
export function rowParts(p: PeekPane, columns: number): { name: string; title: string } {
  const name = clip(paneName(p), columns)
  const title = sessionTitle(p)
  const room = columns - name.length

  // less than ` — a…` says nothing
  return { name, title: title === '' || room < 5 ? '' : clip(` — ${title}`, room) }
}

/** The search a `%word,word` token asks for: a token holds no spaces, so commas stand in for them. */
export function tokenQuery(token: string): string {
  return token.slice(1).replaceAll(',', ' ')
}

/** The typeahead row for a pane: taking it writes the marker over the token. */
export function suggestRow(p: PeekPane): PromptAutocompleteSuggestion {
  const title = sessionTitle(p)

  return {
    text: `${formatToken(p.paneId)} `,
    label: `${p.workspace} · ${paneName(p)}`,
    ...(title === '' ? {} : { description: title }),
  }
}

/** Theme keys, so the dots follow the person's theme. */
export function statusColor(status: string): 'ide' | 'warning' | 'success' | 'error' | 'inactive' {
  if (status === 'working') return 'ide'
  if (status === 'blocked') return 'error'
  if (status === 'idle') return 'warning'
  if (status === 'done') return 'success'

  return 'inactive'
}

export type Group = { workspaceId: string; workspace: string; panes: PeekPane[] }

/** Panes grouped by workspace in list order, cut to `room` lines (a heading costs one); `hidden` counts the panes cut. */
export function layoutRows(list: PeekPane[], room: number): { groups: Group[]; hidden: number } {
  const groups: Group[] = []
  let used = 0
  let shown = 0
  for (const p of list) {
    const last = groups[groups.length - 1]
    const opens = last?.workspaceId !== p.workspaceId
    if (used + (opens ? 2 : 1) > room) break
    if (opens) groups.push({ workspaceId: p.workspaceId, workspace: p.workspace, panes: [p] })
    else last.panes.push(p)
    used += opens ? 2 : 1
    shown += 1
  }

  return { groups, hidden: list.length - shown }
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

const MARKER = /\[herdr-id:([^\]\s]+)\]/g

export function findTokens(text: string): Span[] {
  return [...text.matchAll(MARKER)].map(m => ({ start: m.index, end: m.index + m[0].length }))
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
export function describeOrigin(p: PeekPane): string {
  return `${p.workspace}/${p.tab} · ${p.path}`
}

export const READ_LINES = 120
export const MAX_PANES = 3
const MAX_CHARS = 20_000

/** The distinct pane ids named by `[herdr-id:...]` markers in `text`, in order; the first MAX_PANES are read. */
export function tokenIds(text: string): string[] {
  return [...new Set([...text.matchAll(MARKER)].map(m => m[1]!))]
}

/** What herdr said went wrong: the message of its JSON error, else its words as written, else the exit code. */
export function herdrError(stderr: string, exitCode: number): string {
  const text = stderr.trim()
  try {
    const message = (JSON.parse(text) as { error?: { message?: unknown } }).error?.message
    if (typeof message === 'string' && message !== '') return message
  } catch {
    // not JSON: plain words, or nothing
  }

  return text || `exit ${exitCode}`
}

/** Why a herdr command never ran: said in one line when herdr is not installed, as the engine worded it otherwise. */
export function notRun(reason: string): string {
  return reason.includes('ENOENT') ? 'herdr is not on PATH; is this session inside herdr?' : reason
}

/** Where a marked pane lives and what runs in it; the cwd in full, so the model can open what the output names. */
function placeOf(p: PeekPane): string {
  const session = p.title === '' ? '' : `, session "${p.title}"`
  const runs = p.agent === null ? 'a plain shell' : `running ${p.agent} (${p.status})${session}`

  return `It is in workspace "${p.workspace}", tab "${p.tab}", cwd ${p.cwd}, ${runs}.`
}

/** A fence the output cannot close: longer than any run of backticks in it. */
function fenceFor(body: string): string {
  const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map(m => m[0].length))

  return '`'.repeat(Math.max(3, longest + 1))
}

/** What the model reads beside the prompt for one marked pane; `pane` is herdr's record of it, when it has one. */
export function paneContext(paneId: string, output: string, pane?: PeekPane): string {
  const body = output.trim() === '' ? '(the pane is empty)' : output.trimEnd().slice(-MAX_CHARS)
  const fence = fenceFor(body)
  const place = pane === undefined ? '' : ` ${placeOf(pane)}`

  return [
    `Contents of herdr pane ${paneId}, read when the prompt was sent (\`herdr pane read ${paneId} --source recent-unwrapped --lines ${READ_LINES}\`); a snapshot, not live. The user's marker [herdr-id:${paneId}] refers to this pane.${place} To act in a pane (send input, run commands) use the herdr skill.`,
    fence,
    body,
    fence,
  ].join('\n')
}

export function paneUnreadable(paneId: string, detail: string): string {
  return `The user marked herdr pane ${paneId} but it could not be read (${detail}). Use the herdr skill to find out why if it matters.`
}

/** The markers past MAX_PANES: named, so the model knows they are there and were not read. */
export function panesSkipped(paneIds: string[]): string {
  return `The user also marked herdr ${paneIds.length === 1 ? 'pane' : 'panes'} ${paneIds.join(', ')}, not read: only the first ${MAX_PANES} marked panes are. Use the herdr skill to read one if it matters.`
}
