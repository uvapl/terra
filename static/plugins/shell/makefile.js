/**
 * Reads the small subset of makefile syntax this shell supports: explicit
 * rules and their recipes. There are no variables, no automatic variables, no
 * pattern rules, no includes and no conditionals.
 *
 * A rule is a line naming one or more targets, a colon, and the prerequisites:
 *
 *     speller: speller.c dictionary.c
 *     <tab>clang -c -o speller.o speller.c
 *
 * Every line after it that starts with a tab is one command of the recipe. A
 * command may be prefixed with `@` to run without being printed first, or with
 * `-` to let make carry on when it fails.
 */

/**
 * Split off the prefixes a recipe line may carry.
 *
 * @param {string} text - The command, with its leading tab already removed.
 * @returns {{ text: string, echo: boolean, ignoreErrors: boolean }}
 */
function parseRecipeLine(text) {
  let echo = true;
  let ignoreErrors = false;

  let rest = text;
  while (rest.startsWith('@') || rest.startsWith('-')) {
    if (rest.startsWith('@')) echo = false;
    if (rest.startsWith('-')) ignoreErrors = true;
    rest = rest.slice(1);
  }

  return { text: rest.trim(), echo, ignoreErrors };
}

/**
 * Read a makefile into the rules it declares.
 *
 * @param {string} text - The makefile's contents.
 * @param {string} filename - The name to report in a parse error.
 * @throws {Error} With make's own message when a line is neither a rule, a
 * recipe line, a comment nor blank.
 * @returns {{ rules: Map<string, { deps: string[], recipe: object[] }>,
 *            first: ?string }} The rules by target name, and the target that
 * `make` builds when given none. Recipe entries are parseRecipeLine() results.
 */
export function parseMakefile(text, filename = 'Makefile') {
  const rules = new Map();
  let first = null;
  let current = [];

  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // A recipe line is the only place where leading whitespace means
    // something, so test for the tab before trimming anything.
    if (line.startsWith('\t')) {
      if (current.length === 0) {
        throw new Error(`${filename}:${i + 1}: *** recipe commences before first target.  Stop.`);
      }

      const command = parseRecipeLine(line.slice(1));
      if (command.text) {
        for (const target of current) {
          rules.get(target).recipe.push(command);
        }
      }
      continue;
    }

    const stripped = line.replace(/#.*$/, '').trim();
    if (stripped === '') {
      // A blank line ends the recipe, a comment does not, but treating both
      // the same only matters for a makefile that indents nothing.
      continue;
    }

    const colon = stripped.indexOf(':');
    if (colon === -1) {
      throw new Error(`${filename}:${i + 1}: *** missing separator.  Stop.`);
    }

    const targets = stripped.slice(0, colon).trim().split(/\s+/).filter(Boolean);
    const deps = stripped.slice(colon + 1).trim().split(/\s+/).filter(Boolean);

    if (targets.length === 0) {
      throw new Error(`${filename}:${i + 1}: *** missing target.  Stop.`);
    }

    for (const target of targets) {
      // A repeated target takes the new prerequisites and recipe, which is
      // close enough to what make does with a plain redefinition.
      rules.set(target, { deps, recipe: [] });
      if (first === null && !target.startsWith('.')) first = target;
    }

    current = targets;
  }

  return { rules, first };
}
