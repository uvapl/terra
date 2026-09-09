"""Check the examples in a module's docstrings and print a short, readable
summary instead of doctest's verbose output. Meant for the exam/lab "doctest"
button.

Button config:

    import terra_doctest
    terra_doctest.run("<filename>")

`run` also accepts an already-imported module object, so this works too:

    import <filename>
    import terra_doctest
    terra_doctest.run("<filename>")
"""

import doctest
import importlib
import sys
import traceback

# doctest calls the `>>> ...` lines in a docstring "examples"; students see them
# as worked examples, so that is the word used throughout the output.

CHECK = "✓"
CROSS = "✗"

# Only emit colour codes when writing to a real terminal (Terra's is one).
_COLOR = False
try:
    _COLOR = sys.stdout.isatty()
except Exception:
    pass


def _c(text, code):
    return "\x1b[%sm%s\x1b[0m" % (code, text) if _COLOR else text


def _bold(t):
    return _c(t, "1")


def _dim(t):
    return _c(t, "2")


def _green(t):
    return _c(t, "32")


def _red(t):
    return _c(t, "31")


def _yellow(t):
    return _c(t, "33")


def _resolve(module):
    """Accept a module object or a module name; return the module object."""
    if not isinstance(module, str):
        return module
    if module in sys.modules:
        return importlib.reload(sys.modules[module])
    return importlib.import_module(module)


def _short(name, module_name):
    """Drop the leading `module_name.` from a dotted doctest name."""
    prefix = module_name + "."
    return name[len(prefix):] if name.startswith(prefix) else name


def _labelled(label, value, color=None):
    """A `label   value` line, keeping multi-line values lined up under the
    value column."""
    head = "      %-15s" % label
    lines = value.splitlines() or ["(nothing)"]
    if color:
        lines = [color(line) for line in lines]
    if len(lines) == 1:
        return head + lines[0]
    return head + ("\n" + " " * len(head)).join(lines)


class _Recorder(doctest.DocTestRunner):
    """Runs the examples without printing anything, keeping every failure."""

    def __init__(self):
        super().__init__(verbose=False)
        self.recorded = []

    def _record(self, test, example, got):
        self.recorded.append({
            "name": test.name,
            "line": (test.lineno or 0) + example.lineno + 1,
            "source": example.source.strip(),
            "want": (example.want or "").strip(),
            "got": got.strip(),
        })

    def report_failure(self, out, test, example, got):
        self._record(test, example, got)

    def report_unexpected_exception(self, out, test, example, exc_info):
        got = "".join(
            traceback.format_exception_only(exc_info[0], exc_info[1])
        ).strip()
        self._record(test, example, got)


def run(module):
    """Check `module`'s docstring examples and print a summary followed by the
    first example to fix.

    `module` is a module object or a module name (without `.py`).
    """
    mod = _resolve(module)
    module_name = getattr(mod, "__name__", str(module))

    print(_bold("Checking the examples in %s" % module_name))
    print()

    try:
        found = doctest.DocTestFinder().find(mod)
    except ValueError as err:
        print("  " + _red("Could not read an example: %s" % err))
        print("  Check the spacing of the >>> lines in your docstrings.")
        return

    tests = [t for t in found if t.examples]
    tests.sort(key=lambda t: (t.lineno or 0, t.name))

    if not tests:
        print("  There are no examples in this file to check.")
        print("  Add some inside a function's \"\"\" ... \"\"\" text, like:")
        print(_dim("      >>> kwadraat(3)"))
        print(_dim("      9"))
        return

    rows = []
    failures = []
    total = correct = 0
    for test in tests:
        recorder = _Recorder()
        result = recorder.run(test, out=lambda s: None, clear_globs=True)
        attempted = getattr(result, "attempted")
        failed = getattr(result, "failed")
        total += attempted
        correct += attempted - failed
        rows.append((_short(test.name, module_name), attempted - failed, attempted))
        failures.extend(recorder.recorded)

    name_width = max(len(name) for name, _, _ in rows)
    for name, ok, attempted in rows:
        count = "%d/%d" % (ok, attempted)
        if ok == attempted:
            icon, count = _green(CHECK), _dim(count)
        else:
            icon, count = _red(CROSS), _red(count)
        print("  %s  %-*s  %s" % (icon, name_width, name, count))

    print()
    summary = "%d of %d examples are correct" % (correct, total)
    print("  " + (_green(summary) if correct == total else _yellow(summary)))

    if not failures:
        print()
        print("  " + _green("Everything checks out."))
        return

    failures.sort(key=lambda f: f["line"])
    first = failures[0]
    call = first["source"]
    want = first["want"] or "(nothing)"
    got = first["got"] or "(nothing)"

    print()
    print("  " + _bold("Start with %s, line %d:"
                       % (_short(first["name"], module_name), first["line"])))
    print()
    if "\n" not in call and "\n" not in want and "\n" not in got:
        print("      %s  should give  %s" % (call, _green(want)))
        print("      but your code gave  %s" % _red(got))
    else:
        print(_labelled("the example", call))
        print(_labelled("should give", want, _green))
        print(_labelled("your code gave", got, _red))
