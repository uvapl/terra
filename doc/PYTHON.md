# Python setup (Pyodide)

Terra runs Python entirely in the browser using
[Pyodide](https://pyodide.org/) — CPython compiled to WebAssembly. Python code
executes off the main thread in a dedicated web worker
([`static/js/platforms/py.worker.js`](../static/js/platforms/py.worker.js)), so
a long-running script never freezes the UI.

A hard requirement for Terra is that it must run on **locked-down student
Chromebooks with no access to external CDNs**. Therefore *everything* Pyodide
needs is self-hosted in [`static/wasm/py/`](../static/wasm/py/) and served from
the same origin as the app. Nothing is fetched from the internet at runtime.

## What lives in `static/wasm/py/`

| File | What it is |
| --- | --- |
| `pyodide.mjs` | The loader (`loadPyodide`) the worker imports. |
| `pyodide.asm.mjs`, `pyodide.asm.wasm` | The Emscripten/WebAssembly Python runtime. |
| `python_stdlib.zip` | Pyodide's **own** CPython standard library. Ships with the release; never hand-edited. |
| `pyodide-lock.json` | Lockfile describing every available package and its dependencies. Pruned to only the packages we self-host; each `file_name` points into `wheels/`. |
| `wheels/*.whl` | The self-hosted package wheels (numpy, pandas, matplotlib, pytest, mypy, checkpy, …) and their dependencies. |
| `PYODIDE_VERSION` | The single pinned Pyodide version. |
| `packages.txt` | The list of top-level packages we bundle. |
| `update.py` | Script that downloads everything above for the pinned version. |

> Note: `python_stdlib.zip` and `custom_stdlib.zip` used to be conflated. The
> former is Pyodide's built-in stdlib; the old `custom_stdlib.zip` was Terra's
> hand-built bag of PyPI packages and has been **retired** — packages are now
> real wheels loaded on demand (see below).

## How packages are loaded

Packages are **not** unpacked into the filesystem up-front. Instead, when the
user's code runs, the worker calls
[`loadPackagesFromImports()`](https://pyodide.org/en/stable/usage/api/js-api.html#pyodide.loadPackagesFromImports),
which scans the code for `import` statements and lazily loads exactly the
packages it needs (plus their dependencies) from the self-hosted wheels in
`wheels/` (Pyodide resolves each wheel path relative to `pyodide-lock.json`).
This keeps startup fast and still works fully offline.

Because `pyodide-lock.json` is pruned to only the packages we actually ship,
importing something we don't bundle raises a normal `ModuleNotFoundError`
instead of a confusing network error.

## Updating Pyodide

Everything is driven by one script and one version file.

```bash
cd static/wasm/py
# 1. Bump the pinned version (see the changelog for breaking changes:
#    https://pyodide.org/en/stable/project/changelog.html)
echo 314.0.2 > PYODIDE_VERSION
# 2. Fetch the runtime + all packages for that version
python3 update.py
# 3. Test in the browser (see below), then commit the updated assets.
```

`update.py` will:

1. Download the runtime files for the pinned version.
2. Self-host the wheels for every package in `packages.txt`, plus the full
   dependency closure.
3. Fetch any package that is **not** part of the Pyodide distribution (e.g.
   `checkpy`) and its pure-Python dependencies from PyPI, and inject matching
   entries into `pyodide-lock.json`.
4. Prune the lockfile to the self-hosted set and remove stale files.

The downloaded wheels and runtime are **committed to the repo** — the site is
served straight from the repository (GitHub Pages), so the assets must be
present. Review `git status` after running and commit the result.

### Requirements to run the script

- Python 3 with `pip` available (used to resolve PyPI-only packages).
- Network access **at update time only** (the script pulls from the Pyodide
  release CDN and PyPI). The resulting IDE runs entirely offline.

### What to expect when upgrading

`update.py` is *parameterised* by the version, not *future-proof*. Bumping
`PYODIDE_VERSION` and re-running is usually all it takes, but it deliberately
does **not** shield you from Pyodide's own breaking changes. A few things to
understand:

- **Read the [changelog](https://pyodide.org/en/stable/project/changelog.html)**
  for the version range first — especially for renamed runtime files and changed
  JS/Python APIs. Those are the changes the script *can't* detect; they show up
  only when you test in the browser. (Going 0.25 → 314, for example, renamed
  `pyodide.asm.js` to `pyodide.asm.mjs` and required module-type workers.)

- **You don't rebuild packages yourself.** Pyodide ships as one co-versioned
  distribution: each release publishes its runtime *and* its whole package set,
  built together, in the same lockfile. Compiled packages (numpy, pandas,
  matplotlib, …) are rebuilt by Pyodide for that release's exact Python **and**
  Emscripten ABI, so you can't carry old wheels forward — but you also don't
  fetch them per-package from PyPI; `update.py` just pulls the ones that release
  already provides. Pure-Python packages (checkpy, pytest, …) aren't tied to a
  Python version and work across releases unchanged.

- **Missing packages fail loudly.** Because the whole set is co-published, you
  generally won't get a 404 for a package that's *in* a release. The realistic
  failure is a package being temporarily **disabled** in a release (its rebuild
  didn't land in time — the changelog shows this happening, e.g. geopandas was
  disabled and later re-enabled). If that hits something in `packages.txt`, the
  script errors while resolving the dependency closure. Wait for a later release
  or drop the package.

- **The one non-self-contained bit** is the PyPI-only packages (checkpy and its
  deps): they're resolved with your *host* `pip`, and only pure-Python wheels
  are kept. If such a dep ever ships only a compiled wheel, the script warns and
  skips it, and it goes silently missing — so re-check those imports after an
  upgrade. Pin versions in `packages.txt` (e.g. `checkpy==2.1.2`) if you want
  reproducible re-runs.

**Bottom line:** bump the version, run the script, then always run the smoke
tests below — the runtime-file and API risks only surface at runtime.

## Adding or removing a package

Edit [`packages.txt`](../static/wasm/py/packages.txt) — one top-level package
per line (a bare name, or a pip specifier like `checkpy==2.1.2`) — then re-run
`python3 update.py`. Dependencies are resolved automatically, so you only list
what you actually want to `import`.

- If the package is in the [Pyodide
  distribution](https://pyodide.org/en/stable/usage/packages-in-pyodide.html)
  its wheel is pulled from the release.
- Otherwise it is fetched from PyPI. Only **pure-Python** packages
  (`*-none-any.whl`) can be added this way; a package with a compiled C
  extension that is not in the Pyodide distribution cannot run in the browser
  and the script will warn and skip it.

## Testing after an update

Serve the app with the CORS headers required for `SharedArrayBuffer`/stdin
(a plain `python3 -m http.server` will **not** work for stdin):

```bash
ruby dev-server/serve.rb   # http://localhost:8000
```

Then open the IDE and check:

- The console logs `Started Python v3.x.y` with the expected version.
- Running `print('hello')` works, and a `NameError` (e.g. `print(x)`) shows a
  clean traceback (Terra trims Pyodide's internal frames in
  [`formatErrorMsg`](../static/js/platforms/py.worker.js); if the traceback
  layout changed between Python versions this may need adjusting).
- `input()` works (relies on the CORS headers above).
- `import numpy`, `import pandas`, a matplotlib `Agg` plot, `import pytest`,
  `import mypy`, `import checkpy`, `import pycodestyle` all import — and in the
  network tab the wheels come from `static/wasm/py/wheels/`, never a CDN.
