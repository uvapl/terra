import { CLANG_C_FLAGS, CLANG_LD_FLAGS } from './constants.js';

/**
 * Make a command placeholder for the clang compile command.
 *
 *
 * @param {string[]} srcFiles - List of files to compile.
 * @param {string} target - Name of the output file (target).
 * @returns {string} The command.
 */
export function makeCmdPlaceholder(srcFilenames, target) {
  const cmd = [
    'clang', ...CLANG_C_FLAGS,
    '-o', target,
    ...srcFilenames,
    ...CLANG_LD_FLAGS,
  ];

  return cmd.join(' ');
}
