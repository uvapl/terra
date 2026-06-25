# Code layout

| Directory | Contents |
|---|---|
| `apps/` | Entry point for each variant (IDE, lab, embed, exam) |
| `apps/concerns/` | App-level mixins wired in by the IDE app (filetree, storage, git, LFS) |
| `commands/` | Command registry and per-variant command configs for menus and toolbars |
| `fs/` | Filesystem implementations: virtual FS, git FS, LFS |
| `lib/` | Shared utilities, helpers, and the plugin manager |
| `platforms/` | Language runtimes (WASM) and the worker client that drives them |
| `ui/` | Everything user-facing |
| `ui/components/` | Reusable UI widgets: editor tab, terminal tab, file tree, modal, … |
| `ui/controllers/` | Per-variant view controllers that wire the layout to the app |
| `ui/layouts/` | GoldenLayout configuration and tab management per variant |
| `vendor/` | Third-party libraries |
