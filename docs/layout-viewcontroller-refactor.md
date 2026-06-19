# Layout / ViewController refactor plan

## Goal

Split today's `Layout` god-object into two layers with a clean, single-delegate
boundary:

- **`Layout` (extends `GoldenLayout`)** — tab handling, layout config templates,
  config import/export, component registration, and *mechanical* primitives
  (e.g. enable/disable the run button). It knows nothing about app-domain
  concepts like "a run ended".
- **Controller (new)** — the app's only interface to the UI. It is a
  delegate-driven façade that owns localStorage persistence, the surrounding
  page chrome (navbar, modals, page title, font/theme menus), and translates
  between low-level layout signals and app-domain semantics. It lives in
  `static/js/controllers/`: a `BaseController` (`base.js`) with one subclass per
  app variant — `IDEController` (`ide.js`), `ExamController` (`exam.js`),
  `LabController` (`lab.js`), `EmbedController` (`embed.js`).

The app talks only to the `ViewController`. The `ViewController` talks only to
the `Layout`. Each link is a **single delegate** passed in at construction.

```
App ◄──delegate──► ViewController ◄──delegate──► Layout (GoldenLayout)
```

## Why

`Layout extends eventTargetMixin(GoldenLayout)` currently carries **two event
systems at once** and mixes two responsibilities:

1. GoldenLayout's `EventEmitter` (`.on('initialised')`, `.emit('stateChanged')`).
2. A DOM `EventTarget` delegate channel (`addEventListener('runCode')`, …) that
   the app uses — every event has exactly one listener (the app), so the bus's
   multi-listener capability is unused overhead.

It also leaks upward into the app via the `Terra.app` global
(`onClearTermButtonClick` → `Terra.app.clearTerminal()`,
`renderConfigButtons` → `Terra.app.runButtonCommand(...)`), and owns run
lifecycle state (`checkForStopCodeButton`, `onRunEnded`) it shouldn't.

## Scope

All five layout files: `layout.js`, `layout.ide.js`, `layout.exam.js`,
`layout.lab.js`, `layout.embed.js`.

## Key findings from investigation

### App → layout reach-in surface is small

GoldenLayout-native calls from the app:

| Native reach-in | Count | New indirection |
|---|---|---|
| `.on('initialised', …)` | 3 | VC `onReady` delegate callback |
| `.init()` | 1 | `vc.init()` → `layout.init()` |
| `.term` (via `app.term` getter) | 1 | `vc.term` accessor |

Everything else the app calls (~28 members) is already custom methods, not
GoldenLayout API — they just need to land on the correct side of the seam.

### The delegate protocol already exists in disguise

`AppBase.registerLayoutEvents()` subscribes to named events and dispatches them
with `if (typeof this[eventName] === 'function') this[eventName](tabComponent)`.
That is delegate-method dispatch routed through an event bus. The full
layout→app surface:

- `onRunCode({ clearTerm })`
- `onEditorEditingStarted` / `onEditorEditingStopped` / `onEditorTextChanged` /
  `onEditorSwitchedTo` / `onEditorReloadRequested`
- `onImageSwitchedTo` / `onImageReloadRequested`
- `onReady` (replaces `.on('initialised')`)

One consumer, ~8 callbacks → a single delegate is the correct shape.

### Plugins are a separate, orthogonal channel — leave as-is

Plugins are notified via `triggerPluginEvent(...)` (a global broadcast to N
plugins), fired directly from the source (components, app, concerns). They do
**not** subscribe to the layout's delegate channel. The single delegate
(app, privileged) and the plugin broadcast (N plugins, open) are complementary
and do not collide. Only two relocations are needed (see step 5).

### `saveFile` misuse

`app.ide.commands.js` dispatches `saveFile` *onto* the layout purely so `app.ide.js`
can hear it — using the layout as a generic pub/sub bus between a command and
the app. With a single app delegate this bounce disappears: the command calls
the app/VC method directly.

## Target responsibility split

### `Layout` (extends `GoldenLayout`)

- Config templates (today's per-variant constructors — see step 6, collapse to data)
- Config import/export (`toConfig` / load), **but not** persistence
- Component registration (`image`, `editor`, `terminal`)
- Tab model: `getActiveEditor`, `getEditorComponents`, `getTabComponents`,
  `addFileTab`, `closeFile`, `closeFilesFromFolder`, `closeAllTabs`,
  `repointTab`, `repointTabByPath`, `serializeTabs`, `recreate`,
  `emitToAllComponents`, `emitToTabComponents`, `term`
- Tab-creation wiring: `onTabCreated`, `onTermTabCreated`, `onImageTabCreated`,
  `onEditorTabCreated`, `registerTab`, `onStackCreated`
- Run-button **primitives** only: `setRunButtonEnabled(bool)` /
  `setRunButtonMode('run' | 'stop')` — owns the button DOM (injected into the
  GoldenLayout header) but knows nothing about *why*
- Calls its delegate (the VC) for domain events instead of `dispatchEvent`

### `ViewController` (new)

- **Persistence**: `onStateChanged` → localStorage, the constructor's
  config-versioning/load logic, theme + font writes
- **Delegate dispatch to app**: holds `this.delegate` (the app); forwards the
  ~8 layout callbacks, translating where it adds meaning
- **Chrome outside GoldenLayout**: navbar (`showNavbar`, `setProjectMenuState`),
  page title (`setPageTitle`), modals (`showSaveFileModal`,
  `showSubmitExamModal`, `showLockedState`, `setSubmitModalSuccess`), font/theme
  menu state, `refresh`
- **Run semantics**: `onRunEnded` / `checkForStopCodeButton` translate
  domain → `layout.setRunButtonMode(...)`
- Fires the relocated plugin events (`onLayoutLoaded`)

## Migration steps

Each step is independently shippable and verifiable.

### Step 1 — Introduce pass-through controllers ✅ done

Create `BaseController` (`controllers/base.js`) wrapping the existing `Layout`,
plus an empty pass-through subclass per variant (`IDEController`,
`ExamController`, `LabController`, `EmbedController`). Each app constructs its
variant controller with `new XController({ delegate: this, layout })` and holds
it as `this.layout`. The controller forwards every member it does not implement
straight to the layout (via a `Proxy`), so there is no behavior change.

- App passes itself as the single delegate from day one.
- The `Proxy` survives subclassing: subclass methods take precedence, unknown
  members forward to the layout (verified).
- Verify: every app variant (ide/exam/lab/embed) still boots and runs code.
  Done for the IDE (full boot + end-to-end run); see `verify-terra` skill.

### Step 2 — Move layout-config persistence into the controller ✅ done (partial; see scope)

Done:
- `onStateChanged` → localStorage write moved into `BaseController`, which
  subscribes to the layout's low-level `stateChanged` (guarded by the layout's
  `isInitialised`). `persistLayoutConfig()` writes `layout.toConfig()` through a
  `serializeLayoutConfig(config)` hook.
- The IDE's strip-editor-values transform (`_removeEditorValue`) moved to
  `IDEController.serializeLayoutConfig()`. The layout's `onStateChanged`
  (base + IDE override) is deleted. `repointTab`'s manual `emit('stateChanged')`
  still drives persistence via the controller's subscription.
- Verified (IDE): controller persists the config, IDE values are stripped while
  paths are kept, state restores across reload, end-to-end run still works, no
  console errors.

Deferred to later steps (intentionally — entangled with other concerns):
- The constructor's config-versioning/load logic still lives in the base
  `Layout` constructor (it runs before `super()` and the variant constructors
  build their own default config). Move it when the layout constructor is
  refactored — fold into step 6 (collapse to a config-driven `Layout`).
- Theme + font localStorage writes still live in the layout, because the write
  is one line inside `setTheme`/`changeFontSize` that also manipulate the menu
  DOM. Splitting just the write is artificial; move them with the chrome in
  step 5.

### Step 3 — Replace the event bus with the delegate; drop `eventTargetMixin` ✅ done

- `Layout` no longer extends `eventTargetMixin(GoldenLayout)` — just
  `GoldenLayout`. It gained a `delegate` field (set by the controller right
  after construction: `layout.delegate = controller`).
- The `dispatchEvent` re-dispatch maps (`onEditorTabCreated` /
  `onImageTabCreated`) and both `runCode` dispatches (base + embed) became
  `this.delegate?.[method]?.(component)` calls. `BaseController` defines the
  forwarding callbacks (`onReady`, `onRunCode`, the 5 editor + 2 image events),
  each forwarding to `this.delegate` (the app).
- The app's worker-spawn `.on('initialised')` hook became `BaseApp.onReady()`,
  invoked via the delegate at the end of `Layout.onInitialised` (after the run
  button is rendered). `postSetupLayout` (first-init only) and
  `_restartActiveWorkerAfterReset` (reset only) stay on GoldenLayout's
  `.on('initialised')`, since they are lifecycle-phase-specific.
- `AppBase.registerLayoutEvents` deleted, along with its calls in `init()` and
  the IDE reset path — the delegate is wired at construction, so the replacement
  layout after `recreate` needs no re-registration.
- `saveFile`: `app.ide.commands.js` now calls `Terra.app.saveFile()` directly; the
  layout `addEventListener('saveFile')` bounce is gone.
- `onRunCode({ clearTerm })` now takes the detail object directly (no
  `event.detail`).
- Verified (IDE): boot, run, editor-switch delegate forwarding, save command,
  layout reset (`recreate`) with delegate surviving into the new instance, and
  a post-reset run — all work; no console errors.

Note: `eventTargetMixin` in `lib/helpers.js` is now unused (no importers). Left
in place as a generic utility; remove if you want it gone.

### Step 4 — Move the domain leaks and run state up ✅ done

- `onRunEnded` / `checkForStopCodeButton` (the run/stop lifecycle) moved to
  `BaseController`. The layout now exposes only the mechanical primitives
  `setRunButtonMode('run'|'stop')`, `setRunButtonEnabled(bool)`, and
  `setConfigButtonsEnabled(bool)`. The app still calls
  `this.layout.onRunEnded(...)` / `this.layout.checkForStopCodeButton()`; those
  now resolve on the controller (proxy precedence) instead of the layout.
- `Terra.app.*` reach-backs removed from `layout.js`:
  - `onClearTermButtonClick()` → `this.delegate?.onClearTerm?.()`; controller
    `onClearTerm()` → `app.clearTerminal()`.
  - `renderConfigButtons()` click → `this.delegate?.onConfigButtonCommand?.()`;
    controller `onConfigButtonCommand(sel, cmd)` → `app.runButtonCommand(...)`.
  - `Terra` (and now-unused `seconds`) imports dropped from `layout.js`; the
    dead `Terra` import in `layout.ide.js` removed too.
- Verified (IDE): infinite-loop run flips the button to a red "Stop" (via
  controller → `setRunButtonMode('stop')`), aborting returns it to "Run"
  (`onRunEnded`), a normal run finishes with the button back to "Run", and the
  `onClearTerm` / `onConfigButtonCommand` delegate chains forward to
  `app.clearTerminal` / `app.runButtonCommand`. No console errors.

Out of scope (noted): the app still does direct
`$('.run-user-code-btn, .config-btn').prop('disabled', …)` in several places,
and components/menubar still use the `Terra.app` global. Those are separate
cleanups, not part of the layout's run-state leak.

### Step 5 — Move chrome into VC subclasses; relocate plugin fires

- Move per-variant chrome (`renderButtons`, modals, navbar, page title,
  font/theme menus) from the layout subclasses into the controller subclasses
  (`IDEController`, `ExamController`, `LabController`, `EmbedController`).
- Relocate `triggerPluginEvent('onLayoutLoaded')` from `layout.js onInitialised`
  up to the VC (fired after the layout signals ready). Plugin broadcast
  otherwise unchanged.
- Repoint plugin pull-access (`check50`, `run-as`:
  `Terra.app.layout.getActiveEditor()`) to the façade.
- Verify: each variant's buttons/menus/modals/title render and function.

### Step 6 — Collapse the `Layout` hierarchy to one class

The five layout constructors are pure data (they build a GoldenLayout config
object and differ in nothing else structural). Collapse them into a single
concrete `Layout` that takes a config template (data/function). Only the
`ViewController` keeps per-variant subclasses, where real behavioral differences
live. This avoids a parallel-inheritance-hierarchy smell.

- Verify: all four apps still produce their correct initial layouts.

## Verification checklist (per step)

- IDE: open folder, open/close/save files, reset layout, run code, run/stop.
- Exam: load tabs, submit modal flow, locked state, page title.
- Lab: load files, README sidebar intact, run code, page title.
- Embed: vertical and horizontal variants, run code (clears terminal).
- Theme + font size persist across reloads in every variant.
- Plugins still receive `onLayoutLoaded`, editor/image, and run events.

## Risks / notes

- **Parallel hierarchies**: mitigated by step 6 (single `Layout`, VC-only
  subclasses).
- **`recreate` (IDE reset)**: the trickiest flow — it destroys and rebuilds the
  layout. With a delegate passed at construction the re-wiring disappears, but
  test reset thoroughly after step 3.
- **Two notification systems coexist by design**: the single delegate (app) and
  the plugin broadcast (`triggerPluginEvent`). Do not try to unify them.
