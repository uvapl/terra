#!/usr/bin/env node
// Parses every Karel code sample in KAREL-CHEATSHEET.md through the real
// lexer/parser, to catch drift between the documented syntax and what the
// parser actually accepts (e.g. an example using semicolon placement the
// parser no longer allows).
//
// Usage: node test-cheatsheet.mjs   (from anywhere; paths are relative to
// this file, not the cwd)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tokenize } from './runner/karel-lexer.js';
import { parse } from './runner/karel-parser.js';

const here = dirname(fileURLToPath(import.meta.url));
const cheatsheetPath = join(here, 'KAREL-CHEATSHEET.md');
const md = readFileSync(cheatsheetPath, 'utf8');

const rawBlocks = [...md.matchAll(/```karel\n([\s\S]*?)```/g)].map((m) => ({
  raw: m[1],
  line: md.slice(0, m.index).split('\n').length,
}));

// Blockquoted fences (every line prefixed with "> ") need that prefix
// stripped before the source is valid Karel again.
const blocks = rawBlocks.map(({ raw, line }) => {
  const lines = raw.split('\n');
  const blockquoted = lines.every((l) => l.trim() === '' || l.startsWith('>'));
  const source = blockquoted ? lines.map((l) => l.replace(/^>\s?/, '')).join('\n') : raw;
  return { source, line };
});

function tryParse(source) {
  try {
    parse(tokenize(source));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

let failures = 0;
let checked = 0;

for (const block of blocks) {
  const isFullProgram = /BEGINNING-OF-PROGRAM/i.test(block.source);

  if (isFullProgram) {
    checked++;
    const result = tryParse(block.source);
    if (result.ok) {
      console.log(`OK    line ${block.line} (full program)`);
    } else {
      console.log(`FAIL  line ${block.line} (full program): ${result.message}`);
      failures++;
    }
    continue;
  }

  // Fragments illustrate one piece of syntax at a time; a blank line starts
  // a new, independent fragment. Wrap each in the minimal context it's shown
  // in so the real parser can check it.
  const chunks = block.source.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  for (const chunk of chunks) {
    const isDefinition = /^(\{[^}]*\}\s*)?DEFINE-NEW-INSTRUCTION\b/i.test(chunk);
    const label = chunk.split('\n').find((l) => l.trim() && !l.trim().startsWith('{'))?.slice(0, 60) ?? chunk.slice(0, 60);
    checked++;

    let result;
    if (isDefinition) {
      result = tryParse(`BEGINNING-OF-PROGRAM\n${chunk}\nBEGINNING-OF-EXECUTION\nturnoff\nEND-OF-EXECUTION\nEND-OF-PROGRAM`);
    } else {
      result = tryParse(`BEGINNING-OF-PROGRAM\nBEGINNING-OF-EXECUTION\n${chunk}\nEND-OF-EXECUTION\nEND-OF-PROGRAM`);
    }

    if (result.ok) {
      console.log(`OK    line ${block.line} fragment "${label}"`);
    } else {
      console.log(`FAIL  line ${block.line} fragment "${label}": ${result.message}`);
      console.log('      ' + chunk.replace(/\n/g, '\n      '));
      failures++;
    }
  }
}

console.log('');
console.log(`${checked} checked, ${failures} failed.`);

if (failures > 0) {
  process.exitCode = 1;
}
