// Async interpreter for a parsed Karel program.
//
// Runs the AST against a KarelWorld. Every primitive that changes visible state
// (move/turnLeft/pickbeeper/putbeeper) calls two async hooks around the actual
// mutation: `onMark` first, with the world untouched, so the editor can
// highlight the instruction about to run; then, after the mutation, `onStep`,
// which the worker uses to post a render frame — this is what makes execution
// animate. Entering a user-instruction call, and each iteration of an
// ITERATE/WHILE loop, is its own step too: `onEnter` fires once for the call
// (before its definition runs) and once per iteration (before that
// iteration's body runs), so the call site / loop clause is seen highlighted
// on its own before the steps inside it. All three hooks receive the chain of
// source positions currently active — any enclosing ITERATE/WHILE clauses and
// call sites, outermost first, ending with whichever position the hook is
// about — so the editor can highlight the whole active chain. `turnoff`
// unwinds via the Halt sentinel. World/primitive violations (e.g. moving into
// a wall) throw a normal Error the caller reports.

import { PRIMITIVES } from './karel-parser.js';

class Halt {}

export default class KarelInterpreter {
  /**
   * @param {KarelWorld} world - The world to mutate.
   * @param {object} definitions - Map of user instruction name -> body AST.
   * @param {object} hooks
   * @param {function(array): Promise} [hooks.onEnter] - Awaited once before a
   *   user-instruction call's definition runs, and once per loop iteration
   *   before that iteration's body runs, given the active frames (outermost
   *   first, ending with the call/loop frame itself). Optional; no-op default.
   * @param {function(array): Promise} [hooks.onMark] - Awaited before each
   *   primitive mutates the world, given the active `{ line, column, length }`
   *   frames, outermost first. Optional; defaults to a no-op.
   * @param {function(array): Promise} hooks.onStep - Awaited after each visible
   *   step, given the same frames.
   */
  constructor(world, definitions, { onStep, onMark, onEnter }) {
    this.world = world;
    this.definitions = definitions;
    this.onStep = onStep;
    this.onMark = onMark || (() => Promise.resolve());
    this.onEnter = onEnter || (() => Promise.resolve());

    // Trace frames currently "open" — ITERATE/WHILE clauses and user-instruction
    // call sites the interpreter is nested inside, outermost first.
    this.stack = [];
  }

  /**
   * Run the program body. Function resolves normally on turnoff and rejects if
   * there's no turnoff, or if a rule is violated.
   *
   * @param {object} body - The execution block AST.
   */
  async run(body) {
    try {
      await this.exec(body);
    } catch (err) {
      if (err instanceof Halt) return;
      throw err;
    }
    throw new Error("Karel was not shutdown correctly");
  }

  async exec(node) {
    switch (node.type) {
      case 'block':
        for (const stmt of node.body) {
          await this.exec(stmt);
        }
        break;

      case 'call':
        await this.execCall(node);
        break;

      case 'iterate':
        await this.withFrame(node, 'iterate', async (frame) => {
          for (let k = 0; k < node.count; k++) {
            frame.current = k + 1;
            await this.onEnter([...this.stack]);
            await this.exec(node.body);
            await this.onEnter([...this.stack]);
          }
        });
        break;

      case 'while':
        await this.withFrame(node, 'while', async (frame) => {
          let k = 0;
          while (this.evalTest(node.test)) {
            frame.current = ++k;
            await this.onEnter([...this.stack]);
            await this.exec(node.body);
            await this.onEnter([...this.stack]);
          }
        });
        break;

      case 'if':
        if (this.evalTest(node.test)) {
          await this.exec(node.then);
        } else if (node.else) {
          await this.exec(node.else);
        }
        break;
    }
  }

  /**
   * Run `body`, with `node`'s own source position pushed as a trace frame for
   * its duration — used for ITERATE/WHILE clauses and user-instruction calls,
   * so nested steps report them as part of the active chain. `body` gets the
   * pushed frame itself, so an ITERATE/WHILE loop can update its `current`
   * iteration number in place before each `onEnter`.
   *
   * @param {object} node - AST node carrying `{ line, column, length }`.
   * @param {string} kind - 'iterate' | 'while' | 'call', so the editor can
   *   distinguish a call site from a loop clause.
   * @param {function(object): Promise} body
   */
  async withFrame(node, kind, body) {
    const frame = { line: node.line, column: node.column, length: node.length, kind };
    this.stack.push(frame);
    try {
      await body(frame);
    } finally {
      this.stack.pop();
    }
  }

  async execCall(node) {
    const name = node.name;
    const trace = { line: node.line, column: node.column, length: node.length };

    if (PRIMITIVES.has(name)) {
      const frames = [...this.stack, trace];
      switch (name) {
        case 'move':
          await this.onMark(frames);
          this.world.move();
          return this.onStep(frames);
        case 'turnleft':
          await this.onMark(frames);
          this.world.turnLeft();
          return this.onStep(frames);
        case 'pickbeeper':
          await this.onMark(frames);
          this.world.pickBeeper();
          return this.onStep(frames);
        case 'putbeeper':
          await this.onMark(frames);
          this.world.putBeeper();
          return this.onStep(frames);
        case 'turnoff':
          throw new Halt();
      }
    }

    const body = this.definitions[name];
    if (!body) {
      throw new Error(`Karel does not understand '${node.name}'`);
    }
    await this.withFrame(node, 'call', async () => {
      await this.onEnter([...this.stack]);
      await this.exec(body);
      await this.onEnter([...this.stack]);
    });
  }

  evalTest(test) {
    const result = this.world[test.fn]();
    return test.negate ? !result : result;
  }
}
