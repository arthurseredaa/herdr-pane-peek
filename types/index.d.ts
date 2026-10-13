export type PeekPane = {
  paneId: string
  workspaceId: string
  workspace: string
  workspaceNo: number
  tab: string
  tabNo: number
  /** Its tab holds other panes too: the row then names the pane as well. */
  isSplit: boolean
  /** Agent kind (`claude`) when herdr recognises one, else null: a plain shell. */
  agent: string | null
  status: string
  title: string
  cwd: string
  /** `cwd` with the home folder written `~`: what the toast shows and the search reads. */
  path: string
  isThis: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'pane-peek': {
      panes: PeekPane[]
      query: string
      /** The row the focus ring last stood on; Enter in the search field picks it. */
      selected: string | null
      error: string | null
      /** herdr has answered at least once: an empty list then means no panes, not none read yet. */
      isLoaded: boolean
    }
  }
}
