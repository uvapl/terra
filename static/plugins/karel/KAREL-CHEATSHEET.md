# Karel Cheat Sheet

The classic Pattis Karel language as implemented in `static/plugins/karel`.
Keywords are **case-insensitive** and **hyphenated** (e.g. `BEGINNING-OF-PROGRAM`,
`front-is-clear`). Statements are **separated** by `;`: exactly one `;` is
required between two statements in a block, and none is allowed before the
block's closing keyword (e.g. right before `END`). Newlines are insignificant
whitespace and never substitute for `;`.

This holds for every kind of statement: an `ITERATE`/`WHILE`/`IF` is one
statement, so it takes a `;` after it when another statement follows, whether
its body is a single instruction or a `BEGIN … END` block. The keywords that
close a list — `END`, `ELSE`, `END-OF-EXECUTION` — never have a `;` in front
of them.

The items inside `BEGINNING-OF-PROGRAM` are separated by `;` the same way, so
every definition is followed by one — see
[Defining new instructions](#defining-new-instructions).

---

## Program skeleton

Every program has this shape. The optional directives come first, then the
program block, which contains zero or more instruction definitions followed by
the execution block.

```karel
WORLD "test.w"          { optional: which world to load }
SPEED slow              { optional: animation speed }

BEGINNING-OF-PROGRAM

    { instruction definitions go here }

    BEGINNING-OF-EXECUTION
        { the statements that actually run }
        move;
        turnoff
    END-OF-EXECUTION

END-OF-PROGRAM
```

---

## Directives (optional, before the program)

### `WORLD`
Loads a named world file. Takes a quoted string.

```karel
WORLD "test.w"
BEGINNING-OF-PROGRAM
  BEGINNING-OF-EXECUTION
    move;
    turnoff
  END-OF-EXECUTION
END-OF-PROGRAM
```

### `SPEED`
Sets animation speed. Allowed values: `slow`, `slower`, `slowest`, `fast`.

```karel
SPEED fast
WORLD "test.w"           { WORLD and SPEED may appear in either order }
BEGINNING-OF-PROGRAM
  BEGINNING-OF-EXECUTION
    move;
    turnoff
  END-OF-EXECUTION
END-OF-PROGRAM
```

---

## Primitive instructions

The five built-in commands. The first four animate one step; `turnoff` ends the
program.

| Instruction  | Effect                                              |
|--------------|-----------------------------------------------------|
| `move`       | Move one cell forward (error if a wall is in front) |
| `turnleft`   | Turn 90° counter-clockwise                          |
| `pickbeeper` | Pick up a beeper from the current corner            |
| `putbeeper`  | Put a beeper down on the current corner             |
| `turnoff`    | Stop the program                                    |

```karel
BEGINNING-OF-PROGRAM
  BEGINNING-OF-EXECUTION
    move;
    pickbeeper;
    turnleft;
    move;
    putbeeper;
    turnoff
  END-OF-EXECUTION
END-OF-PROGRAM
```

> There is no built-in `turnright`. Turning right is three `turnleft`s — a
> classic candidate for a user-defined instruction (see below).

---

## Defining new instructions

`DEFINE-NEW-INSTRUCTION` names a single statement — use a `BEGIN … END` block
to group several. Definitions go between
`BEGINNING-OF-PROGRAM` and `BEGINNING-OF-EXECUTION`. Names are case-insensitive.

```karel
BEGINNING-OF-PROGRAM

  DEFINE-NEW-INSTRUCTION turnright AS
    BEGIN
      turnleft;
      turnleft;
      turnleft
    END;

  DEFINE-NEW-INSTRUCTION turnaround AS
    BEGIN
      turnleft;
      turnleft
    END;

  BEGINNING-OF-EXECUTION
    turnright;
    turnaround;
    turnoff
  END-OF-EXECUTION

END-OF-PROGRAM
```

A definition can call primitives or other user instructions:

```karel
  DEFINE-NEW-INSTRUCTION harvest-one AS
    BEGIN
      pickbeeper;
      move
    END;
```

> Note: the items inside `BEGINNING-OF-PROGRAM` — the definitions and the
> `BEGINNING-OF-EXECUTION … END-OF-EXECUTION` block — are separated by `;` too.
> The execution block is always the last item, so in practice every definition
> is followed by one. The `;` inside a definition's block still separates the
> statements in it, as usual, and the statement right before `END` has none. A
> body that is a single bare instruction is separated the same way:
>
> ```karel
> DEFINE-NEW-INSTRUCTION turnaround-once AS turnleft;
> DEFINE-NEW-INSTRUCTION turnaround-twice AS turnleft;
> ```

---

## Blocks

`BEGIN … END` groups several statements into one. Required wherever the grammar
expects a single statement but you want many (loop bodies, branches,
definitions).

```karel
BEGINNING-OF-PROGRAM
  BEGINNING-OF-EXECUTION
    BEGIN
      move;
      move;
      turnleft
    END;
    turnoff
  END-OF-EXECUTION
END-OF-PROGRAM
```

---

## Control flow

> An `ITERATE`/`WHILE`/`IF` is a single statement, so the normal `;` separator
> applies to it: one after it when another statement follows, none when it is
> the last statement in its list. The shape of its body makes no difference —
> a bare instruction and a `BEGIN … END` block behave the same. The examples
> below each show one statement on its own, so none of them ends in a `;`.

### `ITERATE n TIMES` — fixed repetition

Repeats a statement a fixed number of times. `n` is a literal integer.

```karel
{ Move forward 5 cells }
ITERATE 5 TIMES
  move

{ With a block body }
ITERATE 4 TIMES
  BEGIN
    move;
    turnleft
  END
```

### `WHILE test DO` — conditional loop

Repeats while the test is true.

```karel
{ Walk to the wall }
WHILE front-is-clear DO
  move

{ Pick up a whole row of beepers }
WHILE next-to-a-beeper DO
  BEGIN
    pickbeeper;
    move
  END
```

### `IF test THEN [ELSE]` — branching

`ELSE` is optional.

```karel
{ Without else }
IF next-to-a-beeper THEN
  pickbeeper

{ With else }
IF front-is-clear THEN
  move
ELSE
  turnleft

{ Block branches }
IF front-is-blocked THEN
  BEGIN
    turnleft;
    move
  END
ELSE
  move
```

> Note: when `THEN`/`ELSE` branches are single statements, no `;` is needed
> directly before `ELSE`. Likewise, a `BEGIN … END` branch must not have a
> `;` directly before its `END`.

---

## Conditions (tests)

Used in `WHILE … DO` and `IF … THEN`. Each comes in a positive and a negative
spelling; you may *also* prefix any of them with `NOT` (which flips it again).

| Positive                      | Negative (built-in)         | Meaning (positive)                  |
|-------------------------------|-----------------------------|-------------------------------------|
| `front-is-clear`              | `front-is-blocked`          | No wall directly ahead              |
| `left-is-clear`               | `left-is-blocked`           | No wall to Karel's left             |
| `right-is-clear`              | `right-is-blocked`          | No wall to Karel's right            |
| `next-to-a-beeper`            | `not-next-to-a-beeper`      | A beeper is on the current corner   |
| `any-beepers-in-beeper-bag`   | `no-beepers-in-beeper-bag`  | Karel's bag holds ≥1 beeper         |
| `facing-north`                | `not-facing-north`          | Karel faces north                   |
| `facing-south`                | `not-facing-south`          | Karel faces south                   |
| `facing-east`                 | `not-facing-east`           | Karel faces east                    |
| `facing-west`                 | `not-facing-west`           | Karel faces west                    |

```karel
{ Positive and built-in negative spellings }
IF front-is-clear THEN move;
IF front-is-blocked THEN turnleft

{ Explicit NOT prefix — equivalent to the negative spelling }
IF NOT front-is-clear THEN turnleft

{ Orient to face north }
WHILE not-facing-north DO
  turnleft

{ Use up the whole bag }
WHILE any-beepers-in-beeper-bag DO
  putbeeper
```

---

## Comments

```karel
// Line comment — runs to end of line.

{ Block comment —
  can span multiple lines. }
```

---

## Complete worked example

Turn right (no primitive exists), walk to the wall picking up every beeper, and
stop.

```karel
WORLD "test.w"
SPEED slow

BEGINNING-OF-PROGRAM

  DEFINE-NEW-INSTRUCTION turnright AS
    BEGIN
      turnleft;
      turnleft;
      turnleft
    END;

  BEGINNING-OF-EXECUTION

    { Face east by turning right once }
    turnright;

    { Sweep forward, harvesting beepers, until a wall stops us }
    WHILE front-is-clear DO
      BEGIN
        IF next-to-a-beeper THEN
          pickbeeper;
        move
      END;

    { Grab a beeper on the final corner too }
    IF next-to-a-beeper THEN
      pickbeeper;

    turnoff

  END-OF-EXECUTION

END-OF-PROGRAM
```

---

## Grammar reference

```
program     := [ "WORLD" string ] [ "SPEED" speed ]   { either order, optional }
               "BEGINNING-OF-PROGRAM"
                 { definition ";" }
                 execution
               "END-OF-PROGRAM"

execution   := "BEGINNING-OF-EXECUTION" statements "END-OF-EXECUTION"
definition  := "DEFINE-NEW-INSTRUCTION" name "AS" statement
statements  := statement { ";" statement }
statement   := block | iterate | while | if | call
block       := "BEGIN" statements "END"
iterate     := "ITERATE" number "TIMES" statement
while       := "WHILE" test "DO" statement
if          := "IF" test "THEN" statement [ "ELSE" statement ]
call        := word                       { primitive or user instruction }
test        := [ "NOT" ] testword
speed       := "SLOW" | "SLOWER" | "SLOWEST" | "FAST"
```
