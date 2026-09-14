import { getFileExtension } from '../lib/helpers.js';

/**
 * The modules behind the bare commands, e.g. `mypy bla.py` runs
 * `python3 -m mypy bla.py`.
 */
const TOOLS = {
  mypy: 'mypy',
  pytest: 'pytest',
  pycodestyle: 'pycodestyle',
  terra_doctest: 'terra_doctest',
};

/**
 * Build the spec for a tool: everything after the command name is the tool's
 * own business.
 *
 * @param {string} module - The python module the command runs.
 * @returns {function} A parse function, see parseInterpreter().
 */
function parseTool(module) {
  return (argv) => {
    const [name, ...args] = argv;
    return { mode: 'module', target: module, args, argv0: name };
  };
}

/**
 * Turn a python command line into what the worker should run.
 *
 * @param {string[]} argv - The tokenized command, e.g. ['python3', 'hello.py'].
 * @param {object} ctx - Shell context: `cwd`, and the `resolvePath` and
 * `isFile` helpers to look a file up with.
 * @throws {Error} With a message to print when the command cannot run.
 * @returns {Promise<object>} The spec, see terra_run.main().
 */
async function parseInterpreter(argv, ctx) {
  const [name, target, ...args] = argv;

  if (!target) {
    throw new Error(`${name}: interactive mode is not supported`);
  }

  if (target === '-m') {
    if (args.length === 0) {
      throw new Error('Argument expected for the -m option');
    }

    const [module, ...rest] = args;
    return { mode: 'module', target: module, args: rest, argv0: '-m' };
  }

  if (target.startsWith('-')) {
    throw new Error(`${name}: unsupported option '${target}'`);
  }

  // The file is checked here rather than in the worker, so a typo comes back
  // at the prompt instead of after python has started.
  const path = ctx.resolvePath(target);
  if (!(await ctx.isFile(path))) {
    throw new Error(`${name}: can't open file '${target}': No such file or directory`);
  }
  if (getFileExtension(path) !== 'py') {
    throw new Error(`${name}: can't run '${target}': not a .py file`);
  }

  // The script is named by its path in the project, which the worker anchors
  // to its own home directory; only argv0 keeps the path as typed.
  return { mode: 'script', target: path, args, argv0: target };
}

/**
 * The commands python backs in a shell.
 */
export const pythonShellCommands = {
  python: { parse: parseInterpreter },
  python3: { parse: parseInterpreter },
  ...Object.fromEntries(
    Object.entries(TOOLS).map(([name, module]) => [name, { parse: parseTool(module) }])
  ),
};
