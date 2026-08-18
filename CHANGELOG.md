# Changelog

## September 2026

This release covers development from June through August 2026. The IDE gained a
new Karel the Robot language, a lab mode, an interactive shell, and an edit
history facility. The layout and command handling were rebuilt, and both the
Python and C runtimes were updated.

### Karel the Robot

- New Karel plugin implementing the original syntax from Pattis (1981),
  including a parser, editor syntax mode, and renderer.
- Worlds are defined in separate files and selected with a `WORLD` directive in
  the Karel file. The directive updates the world live while editing, and world
  names autocomplete. Various line endings are accepted in world files.
- Execution is traced: the running line is highlighted at the slower speeds,
  and the animation and tracing speeds were tuned.
- The grid layout follows the original book more closely, with a revised sprite
  and CSS fixes.
- Syntax checking is stricter and marks errors in the editor. Grammar fixes
  include rejecting a semicolon after `define`.
- `KAREL-CHEATSHEET.md` documents the language; `test-cheatsheet.mjs` runs every
  snippet in it through the parser as a test.

### Lab mode

- New lab mode (`lab.html`), based on CS50 Labs, with a rendered README pane
  alongside the editor and terminal. Labs are configured in YAML; README content
  is rendered from Markdown and sanitized.

### Shell

- New opt-in shell plugin running on top of the terminal. It provides builtins
  (`ls`, `cat`, `head`, `echo`, `pwd`, `cd`, `mkdir`, `touch`) operating on the
  virtual file system, pipes between builtins, and output redirection.
- The shell keeps its own working directory, separate from the editor and file
  tree, and launches programs (`python`, `python3`) through the app, yielding
  terminal input while a program runs.
- Terminal internals moved into their own module as part of this work.

### Edit history

- New edit history plugin, reachable from the **File** menu, which records
  checkpoints of code files and lets students browse them. Consecutive edits at
  one place are accumulated into a single checkpoint; copy/paste, undo/redo and
  external edits are recorded separately. Reverting creates a new marked
  checkpoint.

### Rover assistant

- New optional assistant overlay (Rover, via clippyjs), toggled from
  **View ▸ Show Rover**. Its visibility and dragged position are persisted.
  Other code can drive it through `Terra.assistant` to play animations, speak,
  or ask a question. The sprite is served as a static file.

### Layout and interface

- Upgraded to GoldenLayout 2.
- Rebuilt layout management: panes can be arranged horizontally, vertically, or
  as tabs and stacks, and layout switching is now surgical rather than a full
  rebuild. Orientation is preserved when resetting the layout.
- New output tab stack for the terminal, and a new canvas tab type (used by
  Karel). The output tab follows the active editor. The canvas cannot be closed.
- Revised IDE aesthetics: new tab visuals, a reworked toolbar, new folder icons
  in the file tree without the caret, and a terminal title.
- Dark mode was fixed across the IDE, including icons, and the CSS was
  simplified.
- Added a focus toggle between code and terminal, simplified keyboard shortcuts,
  improved font handling, and a separate font size for demo mode. Existing
  shortcuts are now shown in the menus, which were also renumbered and given
  action markers.
- Fixes for closing files across multiple stacks, opening a file from an
  Untitled tab, flicker when splitting output tabs, dragging and closing panes,
  and Karel editor focus after a run.

### Running code

- Run buttons are enabled at app load and stay usable while Python is booting.
- Pyodide is reloaded after each run so state is reset, with a loading label
  shown for the first worker as well.
- Fixed pytest and other output not being flushed after a run, and the prompt is
  cleared before running.
- The run flow between app and worker was simplified, and the "runButton"
  concept was renamed to snippet.

### Python runtime

- Upgraded Pyodide, and added an update script driven by `packages.txt`, which
  resolves dependencies and downloads wheels so the IDE runs fully offline.
  Bundled packages: numpy, pandas, matplotlib, pytest, mypy, pycodestyle and
  checkpy.
- Python error formatting no longer depends on the Python version.
- Python setup documentation moved to `doc/PYTHON.md`.

### C runtime

- Files are now lazy-loaded from the C runtime instead of being copied up front.
- WASM runtime errors were replaced with clearer, clang-like messages (@Jelleas).

### Files and file tree

- Improved context menus in the file tree; the file tree controller was split
  into smaller parts.
- File and folder creation is deferred until a name is given, so it can be
  cancelled.
- `vfs.update` creates a file if it does not exist yet, additional paths can be
  hidden from VFS listings, `default.profraw` is ignored, and missing file
  timestamps no longer cause errors.
- Change events fire both before and after editor content is reloaded.

### Exam mode

- Images produced during a run (for example graphs) are now shown in exam mode.
- Exam configuration moved to a separate module, with a cleaner exam flow,
  clearer boot messaging and a tidier path for hiding the submit button.

### Internals

- Commands are owned by the app and surfaced by the view controller, through a
  separate command registry and user command module, replacing scattered
  menu/toolbar/keyboard handling.
- The app was split into a base class plus mode-specific apps, with concern
  modules for file system implementations, and layout/UI code moved out of the
  exam and IDE apps into dedicated layout classes.
- The language worker client was separated from the app, and a language worker
  can now be plugged in (used by Karel).
- The Rover and run-as plugins no longer use jQuery; the modal was generalized
  onto the `dialog` element.
- Files were reorganized into `apps/`, `ui/`, `commands/`, `fs/` and `lib/`, and
  a `jsconfig.json` was added.
- Added webrick instructions for the dev server.
