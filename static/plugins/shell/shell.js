import { TerraPlugin } from '../../js/plugin-manager.js';
import Terra from '../../js/terra.js';
import { FileNotFoundError, FileTooLargeError } from '../../js/fs/vfs.js';

/**
 * Error type for shell command failures. The message is printed to the
 * terminal (like a program writing to stderr) and aborts the current line.
 */
class ShellError extends Error {}

/**
 * Interpreter commands that launch a program through the app rather than
 * being handled as a builtin.
 */
const PROGRAM_COMMANDS = ['python', 'python3'];

/**
 * An opt-in interactive shell that lives on top of the existing terminal.
 *
 * It owns terminal input (via term.acquireInput) whenever no program is
 * running and provides a small set of builtins (ls, cat, head, echo, pwd, cd,
 * mkdir, touch) operating on the VFS, plus builtin-to-builtin pipes and output
 * redirection. Programs are launched through Terra.app.runFile(), during which
 * the shell yields terminal input and waits for the run to end.
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
    this.term = Terra.app.layout.term;

    // The terminal may not be instantiated yet at this point; retry shortly.
    if (!this.term) {
      setTimeout(this.onLayoutLoaded, 50);
      return;
    }

    this.printBanner();
    this.term.acquireInput('shell', { onKey: this.handleKey, onPaste: this.handlePaste });
    this.renderPrompt();
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
    this.term.write('\r\n');
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

  printBanner = () => {
    // this.term.writeln('Terra shell');
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
   */
  run = async (line) => {
    const { stages, redirect } = this.parse(line);

    // A program launch (python <file>) goes through the app, not the builtins.
    if (stages.some((cmd) => PROGRAM_COMMANDS.includes(cmd[0]))) {
      if (stages.length > 1) {
        throw new ShellError('piping into a program is not supported');
      }
      if (redirect) {
        throw new ShellError('redirection is not supported for programs');
      }
      return this.runProgram(stages[0]);
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
  }

  /**
   * Launch a program through the app. The shell yields terminal input for the
   * duration of the run and takes it back afterwards.
   *
   * @param {string[]} argv - The tokenized command, e.g. ['python', 'foo.py'].
   */
  runProgram = async (argv) => {
    const script = argv[1];
    if (!script) {
      throw new ShellError(`usage: ${argv[0]} <file.py>`);
    }

    const path = this.resolvePath(script);
    if (!(await this.isFile(path))) {
      throw new ShellError(`${argv[0]}: can't open file '${script}': No such file or directory`);
    }

    this.term.releaseInput('shell');
    try {
      await Terra.app.runFile(path);
    } catch (err) {
      this.writeError(err.message);
    } finally {
      this.term.acquireInput('shell', { onKey: this.handleKey, onPaste: this.handlePaste });
    }
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
        if (!(await Terra.app.vfs.pathExists(path))) {
          await Terra.app.vfs.createFile(path, '');
        }
      }
      return '';
    },
  }

  /***** Redirection ****************************************************/

  writeRedirect = async (redirect, content) => {
    const path = this.resolvePath(redirect.file);
    const data = content.endsWith('\n') || content === '' ? content : content + '\n';
    const exists = await Terra.app.vfs.pathExists(path);

    if (redirect.op === '>>') {
      const prev = exists ? await Terra.app.vfs.readFile(path) : '';
      const merged = prev + data;
      if (exists) {
        await Terra.app.vfs.updateFile(path, merged);
      } else {
        await Terra.app.vfs.createFile(path, merged);
      }
    } else {
      if (exists) {
        await Terra.app.vfs.updateFile(path, data);
      } else {
        await Terra.app.vfs.createFile(path, data);
      }
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
