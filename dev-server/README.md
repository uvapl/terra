# Local dev servers

Two small servers for running and testing Terra locally, in particular the
pages that need a backend to fetch a config from and to submit files to.

## serve.rb — static file server

Serves the repository root on port 8000 with the `Cross-Origin-Opener-Policy`
and `Cross-Origin-Embedder-Policy` headers that the language workers need
(SharedArrayBuffer). A plain `python3 -m http.server` does *not* set these
headers, so code execution won't work with it.

```bash
ruby dev-server/serve.rb
```

On Ruby 3.4+ `webrick` is no longer bundled with Ruby; install it once with
`gem install webrick` if you get a `cannot load such file -- webrick` error.

Then open http://localhost:8000 (IDE), http://localhost:8000/embed.html, or
one of the variants described below.

## exam-stub.py — stub course-site

Stands in for the real course-site on port 8001:

- **GET /lab.json** returns the lab config from `lab-config.json`; **GET** on
  any other path returns the exam config from `exam-config.json`. Both get
  `postback` pointed at the stub itself and the current lock state injected.
  Edit the JSON files to change tabs, course/exam name, which lab is handed
  out, etc. — they are re-read on every request, so no restart needed.
- **POST /submit** accepts the auto-save submissions and returns 200, or
  **423 Locked** when submission is locked (Terra responds to a 423 by locking
  the entire UI). Submitted files are remembered per `code` and handed back as
  `tabs` on the next config request, the way a real course-site restores a
  student's work. They are held in memory only, so restarting the stub is how
  you get back to a student's first attempt.
- **GET /lock** and **GET /unlock** toggle the lock state at runtime, so you
  can watch a running session lock itself on the next auto-save or page reload.

```bash
python3 dev-server/exam-stub.py            # start unlocked
python3 dev-server/exam-stub.py --locked   # start locked
```

## The two pages

`exam.html` and `lab.html` run the same app. What separates them is whether
there is a course-site involved:

| Page | Opened as | Behaviour |
|---|---|---|
| `exam.html` | `?url=<config>&code=<code>` | Always connected. Auto-saves, has a submit button, can be locked. Shows whatever the course-site hands out: a set of files of its own, or a lab when the config names a `lab_url`. |
| `lab.html` | `#<lab-url>` or `?url=<lab-url>` | Never connected. A lab worked on locally, with the files staying in this browser. |

So a lab is *optionally* connected: the same lab runs standalone from
`lab.html`, or connected from `exam.html` when a course-site hands it out.

## Testing exam mode

With both servers running, open:

```
http://localhost:8000/exam.html?url=http://localhost:8001/config.json&code=test-uuid-1234
```

Notes:

- Do **not** URL-encode the `url` param: the app decodes it with `decodeURI`,
  which leaves `%3A`/`%2F` intact, so an encoded URL fails validation.
- On a successful load the app stores the config in localStorage and strips
  the query params. Reloading the page without params exercises the
  localStorage fallback path.
- The page registers a `beforeunload` confirmation, so the browser will
  ask before reloading/leaving once you have interacted with the page.
- Opening the link again always starts from a clean file system: an exam
  sitting is not resumed from what happens to be in this browser, it is
  restored from what the course-site has.
- To start over from a clean slate, clear the site's localStorage (the app
  keys are prefixed with `terra-`).

### Typical scenarios (exam)

| Scenario | How |
|---|---|
| Fresh exam start | Clear localStorage, open the URL above |
| Submit flow ("You're done!" modal) | Click **Submit** in the navbar |
| Locked exam on load | `curl localhost:8001/lock`, then reload the exam page |
| Lock during the exam (423 path) | `curl localhost:8001/lock`, then edit some code and wait for the next auto-save |
| Server unreachable | Stop exam-stub.py, reload the exam page |

## Testing a standalone lab

A standalone lab needs no stub server: the lab's own host is the backend, so
testing requires an internet connection. With serve.rb running, open:

```
http://localhost:8000/lab.html#https://minprog.github.io/objects/queue/lab/
http://localhost:8000/lab.html#https://github.com/cs50/labs/tree/2023/x/mario/less
```

The lab URL identifies a directory containing a lab config — `lab.yml`, or
`.cs50.yml` / `.cs50.yaml` for a lab written against the cs50 tooling — and the
instructions it names. Two URL forms are accepted:

- **Statically deployed labs** (preferred): any URL is taken to be the lab
  directory itself and files are fetched straight from it. The host must
  serve CORS headers (`Access-Control-Allow-Origin`); GitHub Pages does.
- **GitHub repository URLs** (`github.com/org/repo/tree/branch/subdir`):
  resolved to raw.githubusercontent.com. Branch names may contain slashes;
  the branch/subdir split is resolved through the GitHub API, with a raw-file
  probe as fallback when the API is rate-limited (60 unauthenticated
  requests/hour per IP).

The config is read under either the `lab:` or the `lab50:` root key:

```yaml
lab:
  readme: index.md        # instructions to render; defaults to README.md
  files:                  # opened as tabs, downloaded from the lab directory
    - queue.py
  buttons:                # extra toolbar buttons, each running a snippet
    doctest: |
      import doctest
      doctest.testmod(<filename>)
```

A `files` entry may also be `!include`/`!exclude` tagged, as cs50 configs write
it. A button with an empty value removes the built-in button of that name, so
`run:` drops the Run button and its shortcut.

The lab URL goes after a `#` (preferred — it stays in the address bar, so the
link remains shareable) or in a `?url=` query param (stripped after load).

Notes:

- On a successful load the app stores the config in localStorage and strips
  the query params. Reloading without params reopens the last-used lab.
- Standalone labs are persistent: downloaded files live in a per-lab VFS folder
  and are never overwritten by re-downloads, so student edits survive reloads.
  The README scroll progress ({% next %} pagination) is also remembered.
- Opening lab.html without params and without a stored lab shows a form to
  paste a lab URL into.
- To start over from a clean slate, clear the site's localStorage (lab keys
  are prefixed with `terra-lab-`).

## Testing a connected lab

A lab handed out by a course-site. `lab-config.json` names the lab, so edit it
to point at another one. With both servers running, open:

```
http://localhost:8000/exam.html?url=http://localhost:8001/lab.json&code=test-uuid-1234
```

The instructions, files and buttons come from the lab; the auto-save, submit
button and lock come from the course-site. The lab's instructions take the
left-hand side, so the editor sits above the terminal rather than beside it.

### Typical scenarios (connected lab)

| Scenario | How |
|---|---|
| First attempt | Clear localStorage, open the URL above. Files come from the lab. |
| Work restored on another machine | Edit, click **Submit**, then reopen the URL. The files now come back from the stub, not the lab. |
| Deadline passed | `curl localhost:8001/lock`, then reload, or edit and wait for the next auto-save |
| Course-site unreachable | Stop exam-stub.py, reload. The page refuses to boot rather than falling back to an unconnected lab. |
