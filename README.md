# herdr-pane-peek

A [Claude Code](https://claude.com/claude-code) mod for people who run their sessions inside herdr. Type `/pane-peek`, search the panes of **every** workspace, press Enter, and a `[herdr-id:w1E:p4]` marker for that pane lands in your prompt, so you can tell Claude exactly which pane to look at or act on. Already halfway through a prompt? Type `%` and pick the pane from the typeahead instead.

https://github.com/user-attachments/assets/6443c4ac-5dab-417b-83a4-4331b475ced6

## Install

In a Claude Code terminal session:

```
/plugin install pane-peek --marketplace arthurseredaa/herdr-pane-peek
```

Answer `y` to add the marketplace, then pick a scope (user scope makes it available in every session).

## Use

| Key | Does |
| --- | --- |
| `/pane-peek` | opens the picker; the search field has the keyboard |
| type | filters panes; every word must match the workspace, tab, folder, agent kind, status, session title, pane id or path (`~/…`) (`career claude` finds Claude sessions in a workspace called career-ops); a pane the words name is listed before one that only mentions them in its session title or path |
| Enter in the search field | inserts the row marked `❯` (the first match until you move) |
| ↑ ↓ / Tab, then Enter | pick another row and insert it |
| Esc | closes without inserting |

The pane lands in the prompt at the cursor as a marker with a trailing space: `[herdr-id:w1E:p4] `. Keep typing around it: "[herdr-id:w1E:p4] why do the tests fail there?". The marker is drawn as a chip in your theme's suggestion colors, and Backspace or Delete next to it removes the whole marker. A toast says where the pane lives (`workspace/tab · ~/path`). If the prompt cannot take text, the marker is copied to the clipboard instead.

Panes are grouped under their workspace. Each row is `● tab · claude idle · my-project — session title`: the dot is green for done, yellow for idle, blue for working, red for blocked and grey for a plain shell, and agents that are blocked or working are listed first inside their workspace. The session title is drawn dim, and where a tab is split into several panes the row says which one: `tab/p4`, the pane part of its id. The counter beside the search field shows `matches/total`. The pane you are in is left out of the list; type `this` to find it (it is marked `(this)`). The list refreshes every 5 seconds while the picker is open; if herdr stops answering, the picker says why and offers no panes until it answers again.

### Without leaving the prompt

Type `%` anywhere in a prompt and the panes are listed in the typeahead, the way files are for `@`: "compare this with %car". What follows the `%` filters as the picker's search does; a token cannot hold a space, so separate words with commas (`%career,claude`). Tab inserts the first row, ↓ ↑ then Enter another, and the `%word` becomes the marker. Enter with no row highlighted sends the prompt as it stands. The list holds eight panes at most and is read again from herdr once it is 5 seconds old. If the picker is open when you type the `%`, it closes: the typeahead takes over. The marker gets its chip colors at your next keystroke.

## Panes are read for you

When you send a prompt that contains markers, the mod reads each marked pane first (`herdr pane read`, the last 120 lines, at most 3 panes) and hands the snapshot to Claude beside your message, with where the pane lives: its workspace, tab and cwd, and what runs in it. A pane that could not be read, or a marker past the third, is named to Claude and a toast tells you. Claude answers from it in one step instead of loading a skill and running the command itself, which is much faster. The snapshot is taken when you press Enter, and it goes to the model, so keep that in mind for panes that show secrets. To act in a pane (send input, run something) Claude still uses the herdr skill below.

## Let Claude act in panes (recommended)

Reading works on its own: the mod attaches the pane to your message and says what the marker refers to. To let Claude *do* things in a pane (send input, run a command, prompt the agent running there), install the official herdr skill, which explains herdr panes and the `herdr` CLI. The word `herdr` in the marker is what makes Claude load it. Install it once:

```
npx skills add herdrdev/herdr --skill herdr -g -a claude-code
```

- The installer asks which agents to install to and **does not preselect Claude Code**, so pass `-a claude-code` (add `-y` to skip the confirmations). Without `-g` it installs into the current project only.
- Re-run the same command to update. If you would rather match the skill to your installed binary, `herdr --skill` prints the copy that ships with it (the copy on GitHub can be newer).
- Details: [herdr agent skill docs](https://herdr.dev/docs/agent-skill/).

Optional: `herdr integration install claude` adds a hook that lets herdr see Claude's state precisely, so the statuses in the picker are more accurate. It changes your Claude Code hooks, so it is not done for you.

## Requirements

- Claude Code started inside herdr (the `herdr` CLI on `PATH`; `HERDR_PANE_ID` is how the mod marks your own pane).
- Claude Code 2.1.287 or later (mods are on by default). The mods API can change between releases.

## Hacking on it

```
git clone git@github.com:arthurseredaa/herdr-pane-peek.git
cd herdr-pane-peek
claude --plugin-dir .          # load it from the folder; saving a file reloads the mod
claude plugin validate .       # manifest, marketplace and hooks
claude plugin test .           # the *.test.ts files
```

- `hooks/register.tsx`: the hooks (command, pane drawing, focus tracking, pick, the `%` typeahead).
- `hooks/peek.ts`: pure helpers (`herdr api snapshot` parsing, filtering, row labels, the marker and its chip behaviour).
- `types/index.d.ts`: the `$.state` contract.
- `tsconfig.json` extends a file Claude Code writes into `.claude-plugin/types/` the first time it loads the mod, so `tsc -p .` works after one load.

## License

MIT
