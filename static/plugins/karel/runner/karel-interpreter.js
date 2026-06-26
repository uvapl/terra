// Async interpreter for a parsed Karel program.
//
// Runs the AST against a KarelWorld. Every primitive that changes visible state
// (move/turnLeft/pickbeeper/putbeeper) calls the async `onStep` callback, which
// the worker uses to post a render frame and wait a beat — this is what makes
// execution animate. `turnoff` unwinds via the Halt sentinel. World/primitive
// violations (e.g. moving into a wall) throw a normal Error the caller reports.

import { PRIMITIVES } from './karel-parser.js';

class Halt {}

export default class KarelInterpreter {
  /**
   * @param {KarelWorld} world - The world to mutate.
   * @param {object} definitions - Map of user instruction name -> body AST.
   * @param {object} hooks
   * @param {function(): Promise} hooks.onStep - Awaited after each visible step.
   */
  constructor(world, definitions, { onStep }) {
    this.world = world;
    this.definitions = definitions;
    this.onStep = onStep;
  }

  /**
   * Run the program body. Resolves normally on turnoff or when the body ends;
   * rejects if a primitive/world rule is violated.
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
        for (let k = 0; k < node.count; k++) {
          await this.exec(node.body);
        }
        break;

      case 'while':
        while (this.evalTest(node.test)) {
          await this.exec(node.body);
        }
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

  async execCall(node) {
    const name = node.name;

    if (PRIMITIVES.has(name)) {
      switch (name) {
        case 'move':       this.world.move();       return this.onStep();
        case 'turnleft':   this.world.turnLeft();   return this.onStep();
        case 'pickbeeper': this.world.pickBeeper(); return this.onStep();
        case 'putbeeper':  this.world.putBeeper();  return this.onStep();
        case 'turnoff':    throw new Halt();
      }
    }

    const body = this.definitions[name];
    if (!body) {
      throw new Error(`Karel does not know how to '${node.name}'.`);
    }
    await this.exec(body);
  }

  evalTest(test) {
    const result = this.world[test.fn]();
    return test.negate ? !result : result;
  }
}
