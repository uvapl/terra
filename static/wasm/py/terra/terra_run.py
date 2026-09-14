"""Run one command line for Terra's Python worker.

The worker hands over a spec, not a command line: argument parsing happens on
the JavaScript side, where a bad command is reported at the shell prompt
without waiting for Python to start.
"""

import json
import os
import runpy
import sys
import traceback

HOME = "/home/pyodide"

# Frames from these files are dropped from tracebacks, so a student only sees
# frames from their own code.
_INTERNAL = frozenset([
    __file__,
    runpy.__file__,
    "<frozen runpy>",
    "<frozen importlib._bootstrap>",
    "<frozen importlib._bootstrap_external>",
])


def main(payload):
    """Execute one command and report how it ended.

    @param payload: JSON object with `mode` ("script" or "module"), `target`
    (the script path relative to the cwd, or the module name), `args` (the
    arguments after the target) and `argv0` (what sys.argv[0] should be).
    @returns JSON object with `status` (the exit status) and `error`
    (text to print, or None).
    """
    spec = json.loads(payload)
    mode = spec["mode"]
    target = spec["target"]
    argv0 = spec.get("argv0") or target

    old_argv = sys.argv
    old_path = list(sys.path)
    sys.argv = [argv0] + list(spec.get("args") or [])

    status = 0
    error = None

    try:
        if mode == "module":
            # `python -m mod` searches the cwd first; '' tracks the cwd.
            sys.path.insert(0, "")
            # alter_sys would overwrite the sys.argv[0] set above.
            runpy.run_module(target, run_name="__main__", alter_sys=False)
        else:
            # `python script.py` searches the script's own folder first.
            sys.path.insert(0, os.path.dirname(os.path.abspath(target)))
            _run_script(target, argv0)
    except SystemExit as exc:
        status, error = _from_system_exit(exc)
    except BaseException as exc:
        status, error = 1, _format_traceback(exc)
    finally:
        sys.argv = old_argv
        sys.path[:] = old_path
        for stream in (sys.stdout, sys.stderr):
            try:
                stream.flush()
            except Exception:
                pass

    return json.dumps({"status": status, "error": error})


def _run_script(target, argv0):
    """Run a file as __main__.

    runpy.run_path would do this too, but it overwrites sys.argv[0] with the
    path it was given; the script is known here by the path the user typed.
    """
    with open(target, encoding="utf-8") as f:
        source = f.read()

    # Compiling under argv0 is what puts the typed path in tracebacks.
    code = compile(source, argv0, "exec")
    exec(code, {
        "__name__": "__main__",
        "__file__": argv0,
        "__doc__": None,
        "__package__": None,
        "__spec__": None,
        "__builtins__": __builtins__,
    })


def _from_system_exit(exc):
    """Turn sys.exit() into a status, since exiting is not a crash.

    Only sys.exit("message") prints anything, matching CPython.
    """
    code = exc.code

    if code is None:
        return 0, None
    if isinstance(code, bool):
        return (1 if code else 0), None
    if isinstance(code, int):
        return code, None

    return 1, str(code) + "\n"


def _format_traceback(exc):
    """Format an exception the way python would on a terminal."""
    tb = exc.__traceback__

    # Skip the frames that got us here, keeping the student's own.
    while tb is not None and tb.tb_frame.f_code.co_filename in _INTERNAL:
        tb = tb.tb_next

    text = "".join(traceback.format_exception(type(exc), exc, tb))

    # Imported project files resolve to absolute paths; show them as the file
    # tree does.
    return text.replace('File "%s/' % HOME, 'File "')
