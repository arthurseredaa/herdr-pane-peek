# Changelog

## 0.6.0 (2026-10-13)

Polish of what was already there; no new commands.

### Reading marked panes on submit

- Claude is told where each marked pane lives: its workspace, tab, full cwd and what runs in it (a shell, or the agent, its status and session title).
- A pane that cannot be read, or that herdr does not answer for in time, costs only itself: the other marked panes still reach Claude. Before, one timeout dropped them all.
- The reason a pane could not be read is herdr's own message (`pane w9:p9 not found`), not its raw JSON.
- Markers past the third are named to Claude as not read, instead of vanishing.
- A toast tells you when a pane could not be read or markers were skipped.
- Pane output that holds a ``` fence can no longer close the block Claude reads it in.

### Picker

- `❯` marks the row Enter will insert, and follows the arrows.
- The pane name is drawn at full strength, the session title dim.
- In a tab split into several panes a row says which one: `tab/p4`.
- `Reading herdr…` is shown until herdr first answers, where `No panes found.` used to flash.
- When herdr stops answering the picker says why in one line (`herdr: …`, or `herdr is not on PATH; is this session inside herdr?`), lists no stale panes, and Enter inserts nothing.
- Two workspaces of the same name stay two groups.
- Typing `%` in the prompt while the picker is open closes the picker: one list of panes, not two.

### Search (picker and `%word`)

- Words are matched against what a row shows, the pane id and the path written with `~`. A shell's `user@host:…` title and the home folder above the path no longer match, so `users` or your own name do not find every pane.
- A pane the words name (workspace, tab, folder, kind, id) is listed before one that only mentions them in its session title or path; a workspace's panes stay together.

### Other

- `~` in the toast stands for the home folder only where the path is inside it.
- Removed the unused `docs/screenshots/demo.gif`.

## 0.5.0 (2026-10-13)

- `%word` in the prompt offers panes in the typeahead.

## 0.4.0 (2026-10-08)

- Picker redesign: workspace groups, status dots, a match counter.

## 0.3.0 (2026-10-08)

- Marked panes are read when the prompt is sent and handed to Claude.

## 0.2.0 (2026-10-08)

- The picked pane is inserted as a `[herdr-id:…]` chip instead of a bare id.

## 0.1.0 (2026-10-08)

- `/pane-peek`: search herdr panes across workspaces and insert the chosen one into the prompt.
