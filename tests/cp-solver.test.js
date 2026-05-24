"use strict";

const assert = require("assert");
const path = require("path");

const cp = require(path.join("..", "src", "cp-solver"));
const sc = require(path.join("..", "src", "scrabble-collage"));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error("        " + (err.stack ? err.stack.split("\n").slice(0, 3).join("\n        ") : err.message));
  }
}

function placementMap(placements) {
  const out = new Map();
  for (const p of placements) {
    out.set(p.word, p);
  }
  return out;
}

function shareCell(pa, pb) {
  return cp.placementsShareCell(pa, pb);
}

console.log("CP solver tests");

test("empty word list returns empty result", () => {
  const r = cp.solveCollage([], {});
  assert.strictEqual(r.status, "empty");
  assert.deepStrictEqual(r.placements, []);
});

test("single word is placed at origin", () => {
  const r = cp.solveCollage(["HELLO"], {});
  assert.strictEqual(r.status, "optimal");
  assert.strictEqual(r.placements.length, 1);
  assert.strictEqual(r.placements[0].word, "HELLO");
});

test("two intersecting words succeed without constraints", () => {
  const r = cp.solveCollage(["HELLO", "WORLD"], {});
  assert.strictEqual(r.status, "optimal");
  assert.strictEqual(r.placements.length, 2);
  assert.strictEqual(r.overlapCount, 1);
});

test("mustTouch is enforced: structurally infeasible pairs report unsat", () => {
  const r = cp.solveCollage(["ABC", "XYZ"], {
    preferences: [{ a: "ABC", b: "XYZ", type: "mustTouch" }],
  });
  assert.strictEqual(r.status, "unsat-structural");
  assert.strictEqual(r.placements.length, 0);
});

test("mustTouch placements actually share a cell", () => {
  const r = cp.solveCollage(["HELLO", "WORLD"], {
    preferences: [{ a: "HELLO", b: "WORLD", type: "mustTouch" }],
  });
  assert.strictEqual(r.status, "optimal");
  const m = placementMap(r.placements);
  assert(shareCell(m.get("HELLO"), m.get("WORLD")), "HELLO and WORLD must share a cell");
});

test("via-chain enforces consecutive intersections", () => {
  const r = cp.solveCollage(["BRANDON", "EDWARD", "EMILY"], {
    preferences: [{ a: "BRANDON", b: "EMILY", via: ["EDWARD"] }],
  });
  assert.strictEqual(r.status, "optimal");
  const m = placementMap(r.placements);
  assert(shareCell(m.get("BRANDON"), m.get("EDWARD")), "BRANDON-EDWARD must share a cell");
  assert(shareCell(m.get("EDWARD"), m.get("EMILY")), "EDWARD-EMILY must share a cell");
});

test("via-chain with no shared letters in the chain is structurally unsat", () => {
  const r = cp.solveCollage(["CAT", "DOG", "BAT"], {
    preferences: [{ a: "CAT", b: "DOG", via: ["BAT"] }],
  });
  assert.strictEqual(r.status, "unsat-structural");
});

test("strictCrossChecks rejects incidental sub-words", () => {
  // Forces the solver to find a layout where every letter that's
  // adjacent to another letter forms one of the input words.
  const r = cp.solveCollage(["HELLO", "WORLD"], {
    preferences: [{ a: "HELLO", b: "WORLD", type: "mustTouch" }],
    strictCrossChecks: true,
  });
  assert.strictEqual(r.status, "optimal");
  // For each cell of each placement, walking perpendicularly must not
  // form a non-input word.
  const allowed = new Set(["HELLO", "WORLD"]);
  const board = new Map();
  for (const p of r.placements) {
    for (let i = 0; i < p.word.length; i += 1) {
      const row = p.row + (p.direction === "down" ? i : 0);
      const col = p.col + (p.direction === "across" ? i : 0);
      board.set(`${row},${col}`, p.word[i]);
    }
  }
  function lineWord(row, col, dr, dc) {
    let r = row;
    let c = col;
    while (board.has(`${r - dr},${c - dc}`)) {
      r -= dr;
      c -= dc;
    }
    const out = [];
    while (board.has(`${r},${c}`)) {
      out.push(board.get(`${r},${c}`));
      r += dr;
      c += dc;
    }
    return out.join("");
  }
  for (const [key] of board) {
    const [r, c] = key.split(",").map(Number);
    for (const [dr, dc] of [[1, 0], [0, 1]]) {
      const w = lineWord(r, c, dr, dc);
      if (w.length > 1) {
        assert(allowed.has(w), `incidental word "${w}" not in allowed set`);
      }
    }
  }
});

test("overlap optimality: solver maximizes intersections", () => {
  // For HELLO + WORLD the only crossing letter is L (HELLO[2,3], WORLD[3]),
  // and once placed there is exactly one geometric configuration up to
  // symmetry. The optimal overlap is 1.
  const r = cp.solveCollage(["HELLO", "WORLD"], {});
  assert.strictEqual(r.overlapCount, 1, "HELLO + WORLD should have exactly 1 overlap");
  assert(r.optimal, "result should be marked optimal when search exhausts within budget");
});

test("seven-name family layout is solved optimally and quickly", () => {
  const t0 = Date.now();
  const r = cp.solveCollage(
    ["BRANDON", "EDWARD", "EMILY", "MASON", "PRESTON", "TRISHA", "SCOTT"],
    {
      preferences: [
        { a: "SCOTT", b: "TRISHA", type: "mustTouch" },
        { a: "BRANDON", b: "EMILY", type: "preferConnected", via: ["EDWARD"] },
      ],
    }
  );
  const elapsed = Date.now() - t0;
  assert.strictEqual(r.status, "optimal");
  assert.strictEqual(r.placements.length, 7);
  assert(elapsed < 2000, `expected solve under 2s, took ${elapsed}ms`);

  const m = placementMap(r.placements);
  assert(shareCell(m.get("SCOTT"), m.get("TRISHA")), "SCOTT-TRISHA mustTouch");
  assert(shareCell(m.get("BRANDON"), m.get("EDWARD")), "BRANDON-EDWARD via-link");
  assert(shareCell(m.get("EDWARD"), m.get("EMILY")), "EDWARD-EMILY via-link");
});

test("solveBestCollage returns a metric-rich result via the CP engine", () => {
  const r = sc.solveBestCollage(
    ["BRANDON", "EDWARD", "EMILY", "MASON", "PRESTON", "TRISHA", "SCOTT"],
    {
      preferences: [
        { a: "SCOTT", b: "TRISHA", type: "mustTouch" },
        { a: "BRANDON", b: "EMILY", type: "preferConnected", via: ["EDWARD"] },
      ],
    }
  );
  assert(r.solver, "result.solver should be present");
  assert.strictEqual(r.solver.engine, "cp");
  assert.strictEqual(r.solver.optimal, true);
  assert.strictEqual(r.metrics.constraints.allSatisfied, true);
  assert.strictEqual(r.metrics.components, 1);
  assert.strictEqual(r.placements.length, 7);
});

test("solveBestCollage falls back to heuristic when CP gives up", () => {
  // 5-name case with strictCrossChecks: CP correctly determines the
  // chain CARRIE-DALE-ELLEN cannot be satisfied. solveBestCollage
  // should fall back to the heuristic so the demo never returns nothing.
  const r = sc.solveBestCollage(
    ["ALEX", "BENNY", "CARRIE", "DALE", "ELLEN"],
    {
      preferences: [
        { a: "ALEX", b: "BENNY", type: "mustTouch" },
        { a: "CARRIE", b: "ELLEN", via: ["DALE"] },
      ],
      seedCount: 12,
      maxAttempts: 60,
    }
  );
  assert(r.solver, "result.solver should be present");
  assert.strictEqual(r.solver.engine, "heuristic");
  assert(r.placements.length > 0, "fallback layout should still place words");
});

test("heuristic fallback keeps all names on one connected board", () => {
  const words = [
    "SARA",
    "PRESTON",
    "TRISHA",
    "SCOTT",
    "BRANDON",
    "BELLA",
    "MASON",
    "AMANDA",
    "EDWARD",
    "CAYDEN",
    "LINDSEY",
    "LILLY",
    "ALICE",
    "MACY",
    "OLGA",
  ];
  const r = sc.solveBestCollage(words, {
    preferences: [
      { a: "SCOTT", b: "TRISHA", type: "mustTouch" },
      { a: "BRANDON", b: "EMILY", type: "preferConnected", via: ["EDWARD"] },
    ],
    randomSeed: 20260524,
    seedCount: 80,
    maxAttempts: 120,
    cpSolver: { solveCollage: () => ({ placements: [], status: "forced-fail", optimal: false }) },
  });
  assert.strictEqual(r.solver.engine, "heuristic");
  assert.strictEqual(r.placements.length, words.length, "every name should be placed");
  assert.strictEqual(r.metrics.components, 1, "all names should share one crossword graph");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
