import { TerraPlugin } from '../../js/lib/plugin-manager.js';
import Terra from '../../js/terra.js';
import { FileNotFoundError, FileTooLargeError } from '../../js/fs/vfs.js';
import { parseMakefile } from './makefile.js';

/**
 * Error type for shell command failures. The message is printed to the
 * terminal (like a program writing to stderr) and aborts the current line.
 */
class ShellError extends Error {}

/**
 * The command that builds targets from a makefile.
 */
const MAKE = 'make';

/**
 * The makefile names `make` looks for, in the order it tries them.
 */
const MAKEFILE_NAMES = ['Makefile', 'makefile'];

/**
 * Reports a command that failed without a status of its own, the way a shell
 * numbers a command it could not carry out.
 */
const SHELL_ERROR_STATUS = 2;

/**
 * An interactive shell that lives on top of the existing terminal.
 *
 * It owns terminal input (via term.acquireInput) whenever no program is
 * running and provides a small set of builtins (ls, cat, head, echo, pwd, cd,
 * mkdir, touch, rm) operating on the VFS, plus builtin-to-builtin pipes and
 * output redirection.
 *
 * Programs are launched through the app, during which the shell yields terminal
 * input and waits for the run to end. Three things count as a program: a
 * command a language registered (`python3 hello.py`, `clang -o hello hello.c`),
 * `make`, and a path to a binary an earlier build produced (`./hello alice`).
 *
 * `make` reads the makefile in its working directory and runs each recipe line
 * through the shell itself, so a recipe can use anything the user can type.
 *
 * The shell keeps its own current working directory, fully separate from the
 * editor/file tree. Paths are VFS-relative; the shell root ('') is the same
 * root the file tree shows.
 */
export default class ShellPlugin extends TerraPlugin {
  name = 'shell';

  /** Reference to the terminal component. @type {?object} */
  term = null;

  /** Current working directory, VFS-relative ('' is the root). @type {string} */
  cwd = '';

  /** The line currently being edited. @type {string} */
  line = '';

  /** Cursor position within the current line. @type {number} */
  cursor = 0;

  /** Command history. @type {string[]} */
  history = [];

  /** Index into history while browsing with the arrow keys. @type {number} */
  histIndex = 0;

  /** True while a command is executing, to ignore further input. @type {boolean} */
  busy = false;

  /**
   * True while a run started outside the shell (e.g. the Run button) is in
   * progress, so the shell knows to restore its prompt when that run ends.
   * @type {boolean}
   */
  externalRun = false;

  onLayoutLoaded = () => {
    this.term = Terra.app.term;

    // The terminal may not be instantiated yet at this point; retry shortly.
    if (!this.term) {
      setTimeout(this.onLayoutLoaded, 50);
      return;
    }

    this.term.acquireInput('shell', { onKey: this.handleKey, onPaste: this.handlePaste });
    this.renderPrompt();
  }

  /**
   * The terminal was cleared by the user (ctrl-k, trash button, menu). Render a
   * fresh prompt, but only when the shell currently owns input — not while a
   * program is running.
   */
  onTerminalCleared = () => {
    if (this.term?.inputOwner === 'shell') {
      this.renderPrompt();
    }
  }

  /***** Run lifecycle (program launches) *******************************/

  /**
   * A program run is starting. When the shell still owns input, the run was
   * initiated outside the shell (e.g. the Run button) while sitting at a
   * prompt: yield input and move program output onto a fresh line. Runs the
   * shell started itself (python ...) have already released input, so this is
   * a no-op for them.
   */
  onRunStart = () => {
    if (!this.term || this.term.inputOwner !== 'shell') return;

    this.externalRun = true;
    this.term.clearCurrentLine();
    this.term.releaseInput('shell');
  }

  /**
   * A program run has ended. Restore the shell's prompt, input ownership and
   * cursor, but only for runs the shell did not start itself (those restore
   * their own prompt via submit()).
   */
  onRunEnded = () => {
    if (!this.externalRun) return;

    this.externalRun = false;
    this.term.acquireInput('shell', { onKey: this.handleKey, onPaste: this.handlePaste });
    this.renderPrompt();
  }

  /***** Input handling **************************************************/

  handleKey = (e) => {
    if (this.busy) return;

    const ev = e.domEvent;

    switch (ev.key) {
      case 'Enter':
        return this.submit();
      case 'Backspace':
        return this.backspace();
      case 'ArrowLeft':
        if (this.cursor > 0) { this.cursor--; this.render(); }
        return;
      case 'ArrowRight':
        if (this.cursor < this.line.length) { this.cursor++; this.render(); }
        return;
      case 'ArrowUp':
        return this.historyPrev();
      case 'ArrowDown':
        return this.historyNext();
      case 'Home':
        this.cursor = 0; this.render();
        return;
      case 'End':
        this.cursor = this.line.length; this.render();
        return;
    }

    // Insert printable characters, ignoring anything with a modifier or any
    // non-single-character key (Tab, F-keys, etc.).
    if (e.key && e.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      this.insert(e.key);
    }
  }

  handlePaste = (text) => {
    if (this.busy || !text) return;
    this.insert(text);
  }

  insert = (text) => {
    this.line = this.line.slice(0, this.cursor) + text + this.line.slice(this.cursor);
    this.cursor += text.length;
    this.render();
  }

  backspace = () => {
    if (this.cursor === 0) return;
    this.line = this.line.slice(0, this.cursor - 1) + this.line.slice(this.cursor);
    this.cursor--;
    this.render();
  }

  historyPrev = () => {
    if (this.histIndex === 0) return;
    this.histIndex--;
    this.line = this.history[this.histIndex];
    this.cursor = this.line.length;
    this.render();
  }

  historyNext = () => {
    if (this.histIndex >= this.history.length) return;
    this.histIndex++;
    this.line = this.history[this.histIndex] || '';
    this.cursor = this.line.length;
    this.render();
  }

  /***** Rendering ******************************************************/

  promptString = () => {
    // A plain '$ '. The cwd is still tracked internally for cd/pwd.
    return '$ ';
  }

  /**
   * Redraw the prompt and current line, placing the cursor correctly. Clears
   * the whole line first, so it works for insertions and deletions alike. This
   * assumes the input fits on a single terminal row, which is fine for the
   * short commands this shell targets.
   */
  render = () => {
    this.term.write('\x1b[2K\r');
    this.term.write(this.promptString() + this.line);

    const tail = this.line.length - this.cursor;
    if (tail > 0) {
      this.term.write(`\x1b[${tail}D`);
    }
  }

  /** Print a fresh prompt on a new empty line. */
  renderPrompt = () => {
    this.line = '';
    this.cursor = 0;
    this.render();
  }

  writeOut = (content) => {
    if (content === '') return;
    this.term.write(content.endsWith('\n') ? content : content + '\n');
  }

  writeError = (message) => {
    this.term.write(`\x1b[1;31m${message}\x1b[0m\n`);
  }

  /***** Command execution **********************************************/

  submit = async () => {
    const line = this.line;
    this.term.write('\r\n');

    this.line = '';
    this.cursor = 0;

    const trimmed = line.trim();
    if (trimmed) {
      this.history.push(trimmed);
    }
    this.histIndex = this.history.length;

    if (trimmed) {
      this.busy = true;
      try {
        await this.run(trimmed);
      } catch (err) {
        this.writeError(err instanceof ShellError ? err.message : `error: ${err.message}`);
      } finally {
        this.busy = false;
      }
    }

    this.renderPrompt();
  }

  /**
   * Parse and execute a single command line.
   *
   * @param {string} line - The trimmed command line.
   * @param {boolean} [nested] - True when make is already holding the
   * terminal, so a program must not take it over again.
   * @returns {Promise<number>} The exit status.
   */
  run = async (line, nested = false) => {
    const { stages, redirect } = this.parse(line);

    if (stages.some((cmd) => this.isProgram(cmd[0]))) {
      if (stages.length > 1) {
        throw new ShellError('piping into a program is not supported');
      }
      if (redirect) {
        throw new ShellError('redirection is not supported for programs');
      }
      return this.runProgram(stages[0], nested);
    }

    // Builtin pipeline: feed each stage's stdout into the next stage's stdin.
    let stdin = '';
    for (const cmd of stages) {
      stdin = await this.runBuiltin(cmd, stdin);
    }

    if (redirect) {
      await this.writeRedirect(redirect, stdin);
    } else {
      this.writeOut(stdin);
    }

    return 0;
  }

  /**
   * Run one line on behalf of make, reporting rather than raising a failure.
   *
   * @param {string} line - The command line from a recipe.
   * @returns {Promise<number>} The exit status.
   */
  runLine = async (line) => {
    try {
      return await this.run(line, true);
    } catch (err) {
      this.writeError(err instanceof ShellError ? err.message : `error: ${err.message}`);
      return SHELL_ERROR_STATUS;
    }
  }

  /**
   * Whether a command launches a program rather than a builtin.
   *
   * @param {string} name - The first word of a command.
   * @returns {boolean}
   */
  isProgram = (name) => (
    // A builtin is never shadowed by a command a language registered.
    !this.builtins[name]
    && (
      name === MAKE
      || this.isPath(name)
      || Terra.app.langWorkerClient.hasShellCommand(name)
    )
  );

  /**
   * Whether a command names a file rather than a command.
   *
   * @param {string} name - The first word of a command.
   * @returns {boolean}
   */
  isPath = (name) => name.includes('/');

  /**
   * Run a program: make, a binary, or a registered command.
   *
   * @param {string[]} argv - The tokenized command, e.g. ['./hello', 'alice'].
   * @param {boolean} [nested] - True when make already holds the terminal.
   * @returns {Promise<number>} The exit status.
   */
  runProgram = async (argv, nested = false) => {
    const [name] = argv;

    const start = () => {
      if (name === MAKE) return this.make(argv);
      if (this.isPath(name)) return this.exec(argv);
      return this.launchCommand(argv);
    };

    return nested ? start() : this.launch(start);
  }

  /**
   * Hand the terminal to a program for the duration of a run and take it back
   * afterwards. Raised errors are printed.
   *
   * @param {function} start - Starts the run. Awaited.
   * @returns {Promise<number>} The exit status the run reported, or a failure
   * status when it raised instead.
   */
  launch = async (start) => {
    this.term.releaseInput('shell');
    try {
      return await start();
    } catch (err) {
      this.writeError(err.message);
      return SHELL_ERROR_STATUS;
    } finally {
      this.term.acquireInput('shell', { onKey: this.handleKey, onPaste: this.handlePaste });
    }
  }

  /**
   * Build targets from the makefile in the current directory.
   *
   * @param {string[]} argv - The tokenized command.
   * @returns {Promise<number>} The exit status.
   */
  make = async (argv) => {
    const goals = argv.slice(1);
    const { rules, first } = await this.readMakefile();

    if (goals.length === 0) {
      if (first === null) {
        throw new ShellError(`${MAKE}: *** No targets specified and no makefile found.  Stop.`);
      }
      goals.push(first);
    }

    for (const goal of goals) {
      // `make hello.c` is a common mistake, and a source file is otherwise
      // simply up to date, which says nothing useful.
      if (!rules.has(goal) && goal.endsWith('.c')) {
        throw new ShellError(
          `${MAKE}: *** No rule to make target '${goal}'.  Stop.` +
          `\nDid you mean \`${MAKE} ${goal.replace(/\.c$/, '')}\`?`);
      }

      if (!(await this.makeTarget(goal, rules, null, []))) {
        this.writeOut(`${MAKE}: '${goal}' is up to date.`);
      }
    }

    return 0;
  }

  /**
   * Read the makefile in the current directory. Its absence is not an error:
   * make falls back on the implicit rule, so `make hello` keeps working in a
   * folder that has only sources.
   *
   * @returns {Promise<{ rules: Map, first: ?string }>} See parseMakefile().
   */
  readMakefile = async () => {
    for (const name of MAKEFILE_NAMES) {
      if (!(await this.isFile(this.resolvePath(name)))) continue;

      const text = await Terra.app.vfs.readFile(this.resolvePath(name));
      try {
        return parseMakefile(text, name);
      } catch (err) {
        throw new ShellError(err.message);
      }
    }

    return { rules: new Map(), first: null };
  }

  /**
   * The rule make applies when the makefile has none for a target: build
   * `hello` from `hello.c`. This is what `make hello` did before makefiles
   * were read at all.
   *
   * @param {string} name - The target.
   * @returns {Promise<?object>} A rule, or null when there is no source.
   */
  implicitRule = async (name) => {
    const source = `${name}.c`;
    if (!(await this.isFile(this.resolvePath(source)))) return null;

    return {
      deps: [source],
      recipe: [{ text: `clang -o ${name} ${source}`, echo: true, ignoreErrors: false }],
    };
  }

  /**
   * Bring one target up to date, building its prerequisites first.
   *
   * @param {string} name - The target to build.
   * @param {Map} rules - The rules from the makefile.
   * @param {?string} parent - The target that needs this one, for the error.
   * @param {string[]} stack - The targets being built further up, to catch a
   * rule that depends on itself.
   * @throws {ShellError} When there is no rule, or a recipe fails.
   * @returns {Promise<boolean>} True when a recipe ran.
   */
  makeTarget = async (name, rules, parent, stack) => {
    if (stack.includes(name)) {
      this.writeOut(`${MAKE}: Circular ${parent} <- ${name} dependency dropped.`);
      return false;
    }

    const rule = rules.get(name) || await this.implicitRule(name);

    if (!rule) {
      // A prerequisite with no rule is a source file, and is up to date by
      // virtue of existing.
      if (await this.isFile(this.resolvePath(name))) return false;

      const needed = parent ? `, needed by '${parent}'` : '';
      throw new ShellError(`${MAKE}: *** No rule to make target '${name}'${needed}.  Stop.`);
    }

    let rebuilt = false;
    for (const dep of rule.deps) {
      if (await this.makeTarget(dep, rules, name, [...stack, name])) {
        rebuilt = true;
      }
    }

    if (!rebuilt && await this.isUpToDate(name, rule.deps)) {
      return false;
    }

    await this.runRecipe(name, rule.recipe);
    return true;
  }

  /**
   * Whether a target is newer than everything it is built from.
   *
   * @param {string} name - The target.
   * @param {string[]} deps - Its prerequisites.
   * @returns {Promise<boolean>}
   */
  isUpToDate = async (name, deps) => {
    const targetTime = await this.fileMtime(name);
    if (targetTime === null) return false;

    for (const dep of deps) {
      const depTime = await this.fileMtime(dep);
      if (depTime === null || depTime > targetTime) return false;
    }

    return true;
  }

  /**
   * When a file was last written, for make's comparison. Build artifacts are
   * listed alongside stored files, so an object file counts too.
   *
   * @param {string} name - A path as the makefile writes it.
   * @returns {Promise<?number>} The timestamp, or null when there is no file.
   */
  fileMtime = async (name) => {
    const { parent, name: filename } = this.splitPath(this.resolvePath(name));
    const files = await Terra.app.vfs.getFileList(parent);
    const entry = files.find((file) => file.path === filename);
    return entry ? entry.mtime : null;
  }

  /**
   * Run every command of a recipe, printing each one first.
   *
   * @param {string} target - The target being built, for the error.
   * @param {object[]} recipe - See parseMakefile().
   * @throws {ShellError} When a command fails.
   */
  runRecipe = async (target, recipe) => {
    for (const command of recipe) {
      if (command.echo) this.writeOut(command.text);

      const status = await this.runLine(command.text);
      if (status !== 0 && !command.ignoreErrors) {
        throw new ShellError(`${MAKE}: *** [${target}] Error ${status}`);
      }
    }
  }

  /**
   * Run a binary that `make` produced, e.g. `./hello alice "bob smith"`.
   * argv[0] is the command as typed
   *
   * @param {string[]} argv - The tokenized command.
   * @returns {Promise<number>} The program's exit status.
   */
  exec = async (argv) => {
    const [cmd, ...args] = argv;
    const path = this.resolvePath(cmd);

    if (!(await this.isFile(path))) {
      throw new ShellError(`${cmd}: No such file or directory`);
    }

    // Only a binary is executable.
    if (!(await Terra.app.vfs.isTempBinary(path))) {
      throw new ShellError(`${cmd}: Permission denied`);
    }

    return Terra.app.execBinary(path, args, cmd);
  }

  /**
   * Run a command a language registered, e.g. `python3 hello.py` or
   * `mypy hello.py`. The language turns the command line into something its
   * worker runs; the shell only supplies where it runs.
   *
   * @param {string[]} argv - The tokenized command.
   * @returns {Promise<number>} The program's exit status.
   */
  launchCommand = async (argv) => {
    const { proglang, parse } = Terra.app.langWorkerClient.getShellCommand(argv[0]);

    let spec;
    try {
      spec = await parse(argv, {
        cwd: this.cwd,
        resolvePath: this.resolvePath,
        isFile: this.isFile,
      });
    } catch (err) {
      throw new ShellError(err.message);
    }

    return Terra.app.runCommand(proglang, spec, argv.join(' '), {
      cwd: this.cwd,
      fromShell: true,
    });
  }

  /**
   * Run a single builtin command.
   *
   * @param {string[]} cmd - Tokenized command: [name, ...args].
   * @param {string} stdin - Standard input piped from the previous stage.
   * @returns {Promise<string>} The command's standard output.
   */
  runBuiltin = async (cmd, stdin) => {
    const [name, ...args] = cmd;

    if (!name) return '';

    const builtin = this.builtins[name];
    if (!builtin) {
      throw new ShellError(`${name}: command not found`);
    }

    return builtin(args, stdin);
  }

  /***** Builtins *******************************************************/

  builtins = {
    ls: async (args) => {
      const path = this.resolvePath(args[0] || '');

      if (await this.isFile(path)) {
        return this.basename(path);
      }
      if (path !== '' && !(await this.isFolder(path))) {
        throw new ShellError(`ls: ${args[0]}: No such file or directory`);
      }

      const folders = (await Terra.app.vfs.listFoldersInFolder(path)).sort();
      const files = (await Terra.app.vfs.listFilesInFolder(path)).sort();
      return folders.map((name) => `${name}/`).concat(files).join('\n');
    },

    cat: async (args, stdin) => {
      if (args.length === 0) return stdin;

      const contents = [];
      for (const arg of args) {
        contents.push(await this.readFileArg('cat', arg));
      }
      return contents.join('');
    },

    head: async (args, stdin) => {
      let count = 10;
      const files = [];

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-n') {
          count = parseInt(args[++i], 10);
          if (isNaN(count) || count < 0) {
            throw new ShellError('head: invalid line count');
          }
        } else {
          files.push(args[i]);
        }
      }

      const source = files.length > 0
        ? await this.readFileArg('head', files[0])
        : stdin;

      return source.split('\n').slice(0, count).join('\n');
    },

    echo: async (args) => args.join(' '),

    pwd: async () => `/${this.cwd}`,

    cd: async (args) => {
      const target = this.resolvePath(args[0] || '');
      if (target !== '' && !(await this.isFolder(target))) {
        throw new ShellError(`cd: ${args[0]}: No such file or directory`);
      }
      this.cwd = target;
      return '';
    },

    mkdir: async (args) => {
      if (args.length === 0) throw new ShellError('mkdir: missing operand');

      for (const arg of args) {
        const path = this.resolvePath(arg);
        if (await Terra.app.vfs.pathExists(path)) {
          throw new ShellError(`mkdir: ${arg}: File exists`);
        }
        await Terra.app.vfs.createFolder(path);
      }
      return '';
    },

    touch: async (args) => {
      if (args.length === 0) throw new ShellError('touch: missing operand');

      for (const arg of args) {
        const path = this.resolvePath(arg);
        if (await Terra.app.vfs.pathExists(path)) {
          // Rewrite the file so only its modification time changes, which is
          // what make looks at.
          await Terra.app.vfs.updateFile(path, await Terra.app.vfs.readFile(path));
        } else {
          await Terra.app.vfs.createFile(path, '');
        }
      }
      return '';
    },

    rm: async (args) => {
      let recursive = false;
      let force = false;
      const paths = [];

      for (const arg of args) {
        if (arg === '-r' || arg === '-rf' || arg === '-fr') recursive = true;
        if (arg === '-f' || arg === '-rf' || arg === '-fr') force = true;
        if (!arg.startsWith('-')) paths.push(arg);
      }

      if (paths.length === 0 && !force) throw new ShellError('rm: missing operand');

      for (const arg of paths) {
        const path = this.resolvePath(arg);

        if (await this.isFolder(path)) {
          if (!recursive) throw new ShellError(`rm: ${arg}: is a directory`);
          await Terra.app.vfs.deleteFolder(path);
          continue;
        }

        if (!(await Terra.app.vfs.pathExists(path))) {
          if (force) continue;
          throw new ShellError(`rm: ${arg}: No such file or directory`);
        }

        await Terra.app.vfs.deleteFile(path);
      }
      return '';
    },
  }

  /***** Redirection ****************************************************/

  writeRedirect = async (redirect, content) => {
    const path = this.resolvePath(redirect.file);
    const data = content.endsWith('\n') || content === '' ? content : content + '\n';

    // updateFile upserts, so both `>` (truncate) and `>>` (append) just write.
    // Append still needs to read any prior content first.
    if (redirect.op === '>>') {
      const exists = await Terra.app.vfs.pathExists(path);
      const prev = exists ? await Terra.app.vfs.readFile(path) : '';
      await Terra.app.vfs.updateFile(path, prev + data);
    } else {
      await Terra.app.vfs.updateFile(path, data);
    }
  }

  /***** Parsing ********************************************************/

  /**
   * Parse a command line into pipeline stages and an optional redirection.
   * Redirection ('>' or '>>') is only recognized at the end of the line.
   *
   * @param {string} line
   * @returns {{ stages: string[][], redirect: ?{op: string, file: string} }}
   */
  parse = (line) => {
    let redirect = null;

    const match = line.match(/(>>|>)\s*(\S+)\s*$/);
    if (match) {
      redirect = { op: match[1], file: match[2] };
      line = line.slice(0, match.index);
    }

    const stages = line
      .split('|')
      .map((stage) => this.tokenize(stage))
      .filter((tokens) => tokens.length > 0);

    if (stages.length === 0) {
      throw new ShellError('syntax error: empty command');
    }

    return { stages, redirect };
  }

  /**
   * Split a single command into tokens, honoring single and double quotes.
   *
   * @param {string} str
   * @returns {string[]}
   */
  tokenize = (str) => {
    const tokens = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      tokens.push(m[1] ?? m[2] ?? m[3]);
    }
    return tokens;
  }

  /***** Path helpers ***************************************************/

  /**
   * Resolve an argument path against the current working directory into a
   * normalized VFS-relative path. A leading '/' resolves from the root.
   * '.' and '..' segments are collapsed; '..' cannot escape the root.
   *
   * @param {string} arg
   * @returns {string} VFS-relative path ('' is the root).
   */
  resolvePath = (arg) => {
    const base = arg.startsWith('/') ? [] : this.cwd.split('/').filter(Boolean);
    const parts = arg.split('/').filter(Boolean);

    const stack = base;
    for (const part of parts) {
      if (part === '.') continue;
      if (part === '..') {
        stack.pop();
      } else {
        stack.push(part);
      }
    }

    return stack.join('/');
  }

  basename = (path) => path.split('/').filter(Boolean).pop() || '';

  /**
   * Split a path into its parent folder and final name.
   *
   * @param {string} path
   * @returns {{ parent: string, name: string }}
   */
  splitPath = (path) => {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop() || '';
    return { parent: parts.join('/'), name };
  }

  isFolder = async (path) => {
    if (path === '') return true;
    const { parent, name } = this.splitPath(path);
    const folders = await Terra.app.vfs.listFoldersInFolder(parent);
    return folders.includes(name);
  }

  isFile = async (path) => {
    if (path === '') return false;
    const { parent, name } = this.splitPath(path);
    const files = await Terra.app.vfs.listFilesInFolder(parent);
    return files.includes(name);
  }

  /**
   * Read a file argument, translating VFS errors into shell-style messages.
   *
   * @param {string} cmd - The command name, for the error message.
   * @param {string} arg - The path argument as typed by the user.
   * @returns {Promise<string>} The file contents.
   */
  readFileArg = async (cmd, arg) => {
    const path = this.resolvePath(arg);

    if (await this.isFolder(path)) {
      throw new ShellError(`${cmd}: ${arg}: Is a directory`);
    }

    try {
      return await Terra.app.vfs.readFile(path);
    } catch (err) {
      if (err instanceof FileNotFoundError) {
        throw new ShellError(`${cmd}: ${arg}: No such file or directory`);
      }
      if (err instanceof FileTooLargeError) {
        throw new ShellError(`${cmd}: ${arg}: File too large`);
      }
      throw err;
    }
  }
}
