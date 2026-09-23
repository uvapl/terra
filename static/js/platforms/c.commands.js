/**
 * Splits `-oNAME` style arguments into the flag and its value.
 *
 * @param {string} arg - One command-line argument.
 * @param {string} flag - The flag to look for, e.g. '-o'.
 * @returns {?string} The attached value, '' when the flag stands alone, or
 * null when the argument is a different flag.
 */
function attachedValue(arg, flag) {
  if (!arg.startsWith(flag)) return null;
  return arg.slice(flag.length);
}

/**
 * Turns a clang command line into what the C worker should build.
 *
 * Recognises `-c`, `-o` and `-l`; every other flag is dropped. The worker
 * drives `clang -cc1` and `wasm-ld` directly with a fixed set of compile and
 * link flags, so the warning, standard and debug flags a makefile passes have
 * no effect. Inputs are `.c` sources and `.o` objects, both resolved against
 * the shell's working directory.
 *
 * @param {string[]} argv - The tokenized command, e.g. ['clang', '-c', 'a.c'].
 * @param {object} ctx - Shell context: `cwd`, and the `resolvePath` and
 * `isFile` helpers to look a file up with.
 * @throws {Error} With a message to print when the command cannot run.
 * @returns {Promise<object>} The spec, see API.runCommand() in clang.worker.js.
 */
async function parseClang(argv, ctx) {
  const args = argv.slice(1);
  const inputs = [];
  const libs = [];
  let output = null;
  let compileOnly = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    const outValue = attachedValue(arg, '-o');
    if (outValue !== null) {
      output = outValue || args[++i];
      if (!output) {
        throw new Error("clang: error: argument to '-o' is missing (expected 1 value)");
      }
      continue;
    }

    const libValue = attachedValue(arg, '-l');
    if (libValue !== null) {
      const lib = libValue || args[++i];
      if (!lib) {
        throw new Error("clang: error: argument to '-l' is missing (expected 1 value)");
      }
      libs.push(`-l${lib}`);
      continue;
    }

    if (arg === '-c') {
      compileOnly = true;
      continue;
    }

    // Anything else starting with a dash is a flag this clang does not act on.
    if (arg.startsWith('-')) {
      continue;
    }

    const path = ctx.resolvePath(arg);
    if (!(await ctx.isFile(path))) {
      throw new Error(`clang: error: no such file or directory: '${arg}'`);
    }
    if (!path.endsWith('.c') && !path.endsWith('.o')) {
      throw new Error(`clang: error: cannot handle '${arg}': not a .c or .o file`);
    }
    inputs.push(path);
  }

  if (inputs.length === 0) {
    throw new Error('clang: error: no input files');
  }

  if (compileOnly) {
    if (output && inputs.length > 1) {
      throw new Error('clang: error: cannot specify -o when generating multiple output files');
    }

    const sources = inputs.filter((path) => path.endsWith('.c'));
    if (sources.length === 0) {
      throw new Error('clang: error: no input files');
    }

    return {
      mode: 'compile',
      jobs: sources.map((path) => ({
        input: path,
        output: output ? ctx.resolvePath(output) : `${path.slice(0, -2)}.o`,
      })),
    };
  }

  return {
    mode: 'link',
    inputs,
    output: ctx.resolvePath(output || 'a.out'),
    libs,
  };
}

/**
 * The commands C backs in a shell.
 */
export const cShellCommands = {
  clang: { parse: parseClang },
};
