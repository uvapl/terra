This directory holds Terra's self-hosted Pyodide runtime and Python packages, so
the IDE can run Python fully offline (see [../../../doc/PYTHON.md](../../../doc/PYTHON.md)).

Most files come from the [Pyodide project](https://github.com/pyodide/pyodide),
licensed under the [Mozilla Public License 2.0](https://www.mozilla.org/en-US/MPL/2.0/):
the `pyodide.*` runtime files, `python_stdlib.zip`, `pyodide-lock.json`, and the
package wheels in `wheels/`.

Files specific to this project (not part of Pyodide):

- `PYODIDE_VERSION` — the single pinned Pyodide version.
- `packages.txt` — the top-level Python packages Terra bundles.
- `update.py` — downloads the runtime and all package wheels (into `wheels/`)
  for the pinned version.
- Some wheels in `wheels/` (e.g. `checkpy`) are pure-Python packages fetched from
  PyPI and injected into `pyodide-lock.json` by `update.py`.

To update Pyodide or add a package, edit `PYODIDE_VERSION` / `packages.txt` and
run `python3 update.py`. See [../../../doc/PYTHON.md](../../../doc/PYTHON.md).
