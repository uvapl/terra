# Local dev servers

Two small servers for running and testing Terra locally, in particular the
exam variant, which needs a backend to fetch its config from and to submit
files to.

## serve.rb — static file server

Serves the repository root on port 8000 with the `Cross-Origin-Opener-Policy`
and `Cross-Origin-Embedder-Policy` headers that the language workers need
(SharedArrayBuffer). A plain `python3 -m http.server` does *not* set these
headers, so code execution won't work with it.

```bash
ruby dev-server/serve.rb
```

Then open http://localhost:8000 (IDE), http://localhost:8000/embed.html, or
the exam variant as described below.

## exam-stub.py — stub exam backend

Stands in for the real exam server on port 8001:

- **GET** (any path) returns the exam config from `exam-config.json`, with
  `postback` pointed at the stub itself and the current lock state injected.
  Edit `exam-config.json` to change tabs, course/exam name, etc. — it is
  re-read on every request, so no restart needed.
- **POST /submit** accepts the auto-save submissions and returns 200, or
  **423 Locked** when the exam is locked (Terra responds to a 423 by locking
  the entire UI).
- **GET /lock** and **GET /unlock** toggle the lock state at runtime, so you
  can watch a running exam lock itself on the next auto-save or page reload.

```bash
python3 dev-server/exam-stub.py            # start unlocked
python3 dev-server/exam-stub.py --locked   # start locked
```

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
- The exam page registers a `beforeunload` confirmation, so the browser will
  ask before reloading/leaving once you have interacted with the page.
- To start over from a clean slate, clear the site's localStorage (the app
  keys are prefixed with `terra-`).

### Typical scenarios

| Scenario | How |
|---|---|
| Fresh exam start | Clear localStorage, open the URL above |
| Submit flow ("You're done!" modal) | Click **Submit** in the navbar |
| Locked exam on load | `curl localhost:8001/lock`, then reload the exam page |
| Lock during the exam (423 path) | `curl localhost:8001/lock`, then edit some code and wait for the next auto-save |
| Server unreachable | Stop exam-stub.py, reload the exam page |
