export type PeekPane = {
  paneId: string
  workspace: string
  workspaceNo: number
  tab: string
  tabNo: number
  /** Agent kind (`claude`) when herdr recognises one, else null: a plain shell. */
  agent: string | null
  status: string
  title: string
  cwd: string
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
    }
  }
}
