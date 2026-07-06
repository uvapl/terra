#!/usr/bin/env python3
"""Update the self-hosted Pyodide runtime and Python packages for Terra.

Terra runs student Python code fully in the browser via Pyodide, and must work
on locked-down Chromebooks with no CDN access. Therefore *everything* Pyodide
needs is served from this directory (static/wasm/py/). This script fetches it.

Usage:

    python3 update.py

It reads the pinned version from ./PYODIDE_VERSION and the desired top-level
packages from ./packages.txt, then:

  1. Downloads the Pyodide runtime (pyodide.mjs, pyodide.asm.mjs, .wasm,
     python_stdlib.zip, pyodide-lock.json) for the pinned version.
  2. Self-hosts the wheels for every requested package that ships with the
     Pyodide distribution, plus their transitive dependencies.
  3. Fetches any requested package that is NOT in the distribution (and its
     pure-Python dependency closure) from PyPI, and injects matching entries
     into pyodide-lock.json so they load by import name -- fully offline.
  4. Prunes wheels that are no longer needed.

After running, review `git status` and commit the updated assets.

To upgrade Pyodide in the future: bump ./PYODIDE_VERSION, run this script,
test, and commit. To add/remove a package: edit ./packages.txt and re-run.
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
CDN = "https://cdn.jsdelivr.net/pyodide/v{ver}/full/{name}"

# Package wheels live in this subdirectory to keep the runtime dir tidy. Pyodide
# resolves each package's `file_name` relative to pyodide-lock.json, so the
# lockfile stores wheel paths as "<WHEEL_DIR_NAME>/<wheel>".
WHEEL_DIR_NAME = "wheels"

# Core runtime files loadPyodide() needs, all served from this directory.
RUNTIME_FILES = [
    "pyodide.mjs",
    "pyodide.asm.mjs",
    "pyodide.asm.wasm",
    "python_stdlib.zip",
    "pyodide-lock.json",
]

# Stale files from older Pyodide versions that should be removed on upgrade.
STALE_FILES = ["pyodide.asm.js", "pyodide.js", "custom_stdlib.zip"]

# Extra dependency edges to add to the lockfile, keyed by canonical package name.
# Some packages import modules at runtime that Pyodide's lockfile doesn't declare
# as dependencies, so loadPackagesFromImports() wouldn't pull them in. Listing
# them here makes them load together with their parent (targets must be present
# -- either in the distribution or listed in packages.txt so their wheels get
# self-hosted). Example: mypy imports typing_extensions / mypy_extensions /
# pathspec when run, but the Pyodide lockfile only lists `librt`.
EXTRA_DEPENDS = {
    "mypy": ["typing-extensions", "mypy-extensions", "pathspec"],
}

LOCKFILE = os.path.join(HERE, "pyodide-lock.json")
WHEEL_DIR = os.path.join(HERE, WHEEL_DIR_NAME)


def canonical(name):
    """PEP 503 style normalization used by Pyodide's lockfile keys."""
    return re.sub(r"[-_.]+", "-", name).lower()


def read_version():
    with open(os.path.join(HERE, "PYODIDE_VERSION")) as f:
        return f.read().strip()


def read_manifest():
    packages = []
    with open(os.path.join(HERE, "packages.txt")) as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            if line:
                packages.append(line)
    return packages


def spec_name(spec):
    """Package name from a manifest line / pip specifier (`checkpy==2.1.2`)."""
    return re.split(r"[=<>!~ \[]", spec, maxsplit=1)[0]


def download(url, dest):
    print(f"  fetch {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "terra-update"})
    with urllib.request.urlopen(req) as resp, open(dest, "wb") as out:
        shutil.copyfileobj(resp, out)


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def resolve_dist_closure(lock, names):
    """Transitive dependency closure (lockfile keys) for the given packages."""
    packages = lock["packages"]
    # Map every canonical name to its lockfile key.
    by_canonical = {canonical(k): k for k in packages}
    seen = set()
    stack = [by_canonical[canonical(n)] for n in names]
    while stack:
        key = stack.pop()
        if key in seen:
            continue
        seen.add(key)
        for dep in packages[key]["depends"]:
            dep_key = by_canonical.get(canonical(dep))
            if dep_key and dep_key not in seen:
                stack.append(dep_key)
    return seen


def wheel_metadata(whl_path):
    """Return (name, version, imports, requires_dist) read from a wheel."""
    name, version = os.path.basename(whl_path).split("-")[:2]
    imports, requires = [], []
    with zipfile.ZipFile(whl_path) as zf:
        names = zf.namelist()
        top = next((n for n in names if n.endswith(".dist-info/top_level.txt")), None)
        if top:
            imports = [ln.strip().replace("/", ".") for ln in
                       zf.read(top).decode().splitlines() if ln.strip()]
        meta = next((n for n in names if n.endswith(".dist-info/METADATA")), None)
        if meta:
            for ln in zf.read(meta).decode(errors="replace").splitlines():
                if ln.startswith("Requires-Dist:"):
                    requires.append(ln[len("Requires-Dist:"):].strip())
    if not imports:
        # Fall back to top-level importable modules/packages in the wheel.
        tops = set()
        with zipfile.ZipFile(whl_path) as zf:
            for n in zf.namelist():
                if ".dist-info/" in n or ".data/" in n:
                    continue
                head = n.split("/", 1)[0]
                if head.endswith(".py"):
                    tops.add(head[:-3])
                elif "/" in n:
                    tops.add(head)
        imports = sorted(tops)
    return name, version, imports, requires


def runtime_dep_names(requires_dist):
    """Runtime dependency names from Requires-Dist, ignoring extras/markers."""
    deps = []
    for req in requires_dist:
        marker = req.split(";", 1)[1] if ";" in req else ""
        if "extra ==" in marker:
            continue  # optional dependency
        deps.append(spec_name(req.split(";", 1)[0]).strip())
    return deps


def main():
    version = read_version()
    manifest = read_manifest()
    print(f"Pyodide version: {version}")

    # 1. Runtime files.
    print("Downloading runtime files...")
    for fname in RUNTIME_FILES:
        download(CDN.format(ver=version, name=fname), os.path.join(HERE, fname))

    with open(LOCKFILE) as f:
        lock = json.load(f)
    dist_names = {canonical(k) for k in lock["packages"]}

    dist_pkgs = [p for p in manifest if canonical(spec_name(p)) in dist_names]
    pypi_pkgs = [p for p in manifest if canonical(spec_name(p)) not in dist_names]

    os.makedirs(WHEEL_DIR, exist_ok=True)
    shipped_wheels = set()  # wheel basenames we keep, for pruning
    injected = {}

    # 2. Fetch PyPI-only packages (+ pure-python deps) and inject into lockfile.
    #    Done before the distribution download so that distribution packages
    #    depended on by these (e.g. checkpy -> requests) are pulled in below.
    if pypi_pkgs:
        print("Resolving PyPI-only packages...")
        tmp = tempfile.mkdtemp(prefix="terra-pip-")
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "download",
                                   "--only-binary=:all:", "--dest", tmp, *pypi_pkgs])
            for whl in sorted(os.listdir(tmp)):
                if not whl.endswith(".whl"):
                    continue
                cname = canonical(whl.split("-")[0])
                if cname in dist_names:
                    continue  # already provided by the distribution
                if not whl.endswith("-none-any.whl"):
                    print(f"  WARNING: skipping non-pure wheel {whl}; "
                          f"'{cname}' has a compiled extension and is not in the "
                          f"Pyodide distribution -- it will not work in the browser.")
                    continue
                dest = os.path.join(WHEEL_DIR, whl)
                shutil.copy(os.path.join(tmp, whl), dest)
                shipped_wheels.add(whl)
                name, ver_, imports, requires = wheel_metadata(dest)
                injected[cname] = {
                    "name": name,
                    "version": ver_,
                    "file_name": whl,
                    "imports": imports,
                    "install_dir": "site",
                    "package_type": "package",
                    "sha256": sha256_of(dest),
                    "unvendored_tests": False,
                    "_requires": requires,
                }
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

        # Wire up dependencies now that we know the full package set.
        known = dist_names | set(injected)
        for cname, entry in injected.items():
            deps = []
            for dep in runtime_dep_names(entry.pop("_requires")):
                dcanon = canonical(dep)
                if dcanon in known and dcanon != cname:
                    deps.append(dcanon)
            entry["depends"] = sorted(set(deps))
            lock["packages"][cname] = entry
        print(f"  injected: {', '.join(sorted(injected)) or '(none)'}")

    # Patch in extra dependency edges that Pyodide's lockfile is missing, so the
    # targets get self-hosted (via the closure) and auto-loaded at runtime.
    for parent, extra in EXTRA_DEPENDS.items():
        entry = lock["packages"].get(parent)
        if not entry:
            continue
        for dep in extra:
            dcanon = canonical(dep)
            if dcanon in lock["packages"] and dcanon not in entry["depends"]:
                entry["depends"].append(dcanon)

    # 3. Self-host distribution wheels for the full dependency closure of every
    #    requested package -- including distribution deps of injected packages.
    seeds = [spec_name(p) for p in dist_pkgs] + list(injected)
    closure = resolve_dist_closure(lock, seeds) if seeds else set()
    if seeds:
        print("Downloading distribution package wheels...")
        for key in sorted(closure):
            if key in injected:
                continue  # PyPI wheel already fetched above; not on the CDN
            fname = lock["packages"][key]["file_name"]
            download(CDN.format(ver=version, name=fname),
                     os.path.join(WHEEL_DIR, fname))
            shipped_wheels.add(fname)

    # 4. Prune the lockfile to only the packages we self-host, and point every
    #    wheel at the wheels/ subdirectory. Pruning keeps unknown imports failing
    #    cleanly with ModuleNotFoundError instead of a 404 on a missing wheel.
    lock["packages"] = {k: v for k, v in lock["packages"].items() if k in closure}
    for entry in lock["packages"].values():
        entry["file_name"] = f"{WHEEL_DIR_NAME}/{os.path.basename(entry['file_name'])}"
    with open(LOCKFILE, "w") as f:
        json.dump(lock, f)

    # 5. Remove stale runtime files and any wheels we no longer ship (including
    #    wheels left in the runtime dir by the previous, flat layout).
    for stale in STALE_FILES:
        path = os.path.join(HERE, stale)
        if os.path.exists(path):
            os.remove(path)
            print(f"  removed stale {stale}")

    for existing in os.listdir(HERE):
        if existing.endswith(".whl"):
            os.remove(os.path.join(HERE, existing))
            print(f"  moved wheel out of runtime dir: {existing}")

    for existing in os.listdir(WHEEL_DIR):
        if existing.endswith(".whl") and existing not in shipped_wheels:
            os.remove(os.path.join(WHEEL_DIR, existing))
            print(f"  pruned unused wheel {existing}")

    print("\nDone. Review `git status` and commit the updated assets.")


if __name__ == "__main__":
    main()
