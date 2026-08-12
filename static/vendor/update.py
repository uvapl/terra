#!/usr/bin/env python3
"""Re-download the vendored front-end libraries in this directory.

Usage:
    python3 static/vendor/update.py                  # fetch the pinned versions
    python3 static/vendor/update.py --version 2.6.1  # fetch a different version

Files land in <package>/<version>/, so a new version is downloaded alongside the
old one rather than over it. Nothing in the app is repointed automatically: the
version appears in import paths and stylesheet links, which the script lists at
the end so they can be updated by hand.

Standard library only, no dependencies.
"""

import argparse
import pathlib
import re
import subprocess
import sys
import urllib.request

VENDOR_DIR = pathlib.Path(__file__).resolve().parent
REPO_ROOT = VENDOR_DIR.parent.parent

# Each package maps a destination path (relative to <package>/<version>/) to the
# URL it is fetched from. `{version}` is substituted in both.
#
# golden-layout publishes only CJS and ESM directory builds, whose internal
# imports are extensionless and so cannot be loaded by a browser. jsDelivr's
# `+esm` endpoint returns a single self-contained ES module, which is what we
# vendor; the stylesheets come from the package as published.
PACKAGES = {
    'golden-layout': {
        'version': '2.6.0',
        'files': {
            'golden-layout.esm.js':
                'https://cdn.jsdelivr.net/npm/golden-layout@{version}/+esm',
            'css/goldenlayout-base.css':
                'https://unpkg.com/golden-layout@{version}/dist/css/goldenlayout-base.css',
            'css/goldenlayout-light-theme.css':
                'https://unpkg.com/golden-layout@{version}/dist/css/themes/goldenlayout-light-theme.css',
        },
    },
}


def fetch(url):
    """Download a URL and return its bytes."""
    with urllib.request.urlopen(url) as response:
        if response.status != 200:
            raise RuntimeError(f'{url} returned HTTP {response.status}')
        return response.read()


def check_self_contained(name, text):
    """Warn when an ES module still imports from somewhere else.

    The whole point of vendoring the bundled build is that the browser can load
    it directly, with no bundler and no follow-up requests.
    """
    imports = sorted(set(re.findall(r'\bfrom\s*["\']([^"\']+)["\']', text)))
    if imports:
        print(f'  ! {name} still imports: {", ".join(imports)}', file=sys.stderr)
        print('    It will not load in a browser as-is.', file=sys.stderr)
        return False
    return True


def check_css_assets(name, text, base_url):
    """Warn about url() references, which are not downloaded.

    GoldenLayout's themes point at PNGs living outside the files we vendor, so
    those rules have to be overridden in the project's own CSS.
    """
    urls = sorted(set(re.findall(r'url\([\'"]?([^\'")]+)[\'"]?\)', text)))
    external = [u for u in urls if not u.startswith('data:')]
    if external:
        print(f'  ! {name} references assets that are NOT downloaded:')
        for url in external:
            print(f'      {url}')
        print('    Override those rules in static/css/ or vendor the assets too.')


def update(package, version):
    """Download every file for one package at one version."""
    spec = PACKAGES[package]
    target = VENDOR_DIR / package / version

    print(f'{package} {version} -> {target.relative_to(REPO_ROOT)}')

    for relative_path, url_template in spec['files'].items():
        url = url_template.format(version=version)
        destination = target / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)

        data = fetch(url)
        destination.write_bytes(data)

        text = data.decode('utf-8', errors='replace')
        print(f'  {relative_path} ({len(data):,} bytes)')

        if relative_path.endswith('.js'):
            check_self_contained(relative_path, text)
        elif relative_path.endswith('.css'):
            check_css_assets(relative_path, text, url)


def report_references(package, version):
    """List the files that name this package's path, so they can be repointed."""
    pattern = f'{package}/{version}'
    try:
        result = subprocess.run(
            ['git', 'grep', '-l', pattern, '--', ':!static/vendor'],
            cwd=REPO_ROOT, capture_output=True, text=True,
        )
    except FileNotFoundError:
        return

    files = [line for line in result.stdout.splitlines() if line]
    print()
    if files:
        print(f'Files referencing {pattern}:')
        for path in files:
            print(f'  {path}')
    else:
        print(f'Nothing references {pattern} yet — update the import path in')
        print('  static/js/ui/layouts/layout.js')
        print('and the stylesheet links in index.html, lab.html, exam.html, embed.html.')


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('package', nargs='?', choices=sorted(PACKAGES),
                        help='package to update (default: all)')
    parser.add_argument('--version', help='version to fetch instead of the pinned one')
    args = parser.parse_args()

    packages = [args.package] if args.package else sorted(PACKAGES)

    if args.version and len(packages) > 1:
        parser.error('--version needs a single package')

    for package in packages:
        version = args.version or PACKAGES[package]['version']
        update(package, version)
        report_references(package, version)


if __name__ == '__main__':
    main()
