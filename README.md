# word_combo_tool

Builds "Scrabble collage" style layouts from names/words, with optional pair preferences:

- `mustTouch`: strongest preference to directly intersect.
- `preferTouch`: prefer direct intersection, but not required.
- `preferConnected`: allow a stitched path through other words.
- `preferNear`: keep words physically close.
- Optional `via`: enforce/encourage stitching through specific names (for example Brandon -> Edward -> Emily).
- `strictCrossChecks` (default `true`): rejects accidental fragments (for example invalid mini-combos like `MB` or `IND`).

## Files

- `src/cp-solver.js` - constraint-programming solver (pure JS, browser + Node).
- `src/scrabble-collage.js` - reusable JavaScript engine wrapping the CP solver and the original heuristic.
- `demo/index.html` - standalone UI demo (works on GitHub Pages, no backend).
- `demo/main.js` - demo logic and rendering.
- `tests/cp-solver.test.js` - Node tests for the CP solver and the wrapper.

## Engines

There are two solvers available, both in pure JS:

1. **CP solver** (`src/cp-solver.js`) - backtracking constraint programming. Treats `mustTouch` and `via` as hard constraints rather than soft scoring terms. Phase 1 finds a feasible layout; phase 2 keeps searching with branch-and-bound to maximize intersections (then minimize bounding-box perimeter). When the search exhausts without timing out the answer is provably optimal.
2. **Greedy heuristic** (`src/scrabble-collage.js`, original engine) - randomized greedy placement with seed restarts. Fast, but only treats hard rules as soft scoring; can silently fail. Used as a fallback whenever CP cannot satisfy the hard constraints (or hits its time budget without producing a feasible layout) so the demo always returns something.

The recommended entry point is `solveBestCollage`, which calls CP first and falls back to the heuristic automatically.

## Quick start (browser)

1. Serve the repo with any static server.
2. Open `demo/index.html`.
3. Enter words and preferences, then click **Find Best Mix**. The CP solver runs first; the heuristic kicks in only if CP fails.
   - **Quick try (this seed only)** still runs the original single-seed heuristic for instant feedback.
   - In the demo UI, "Bridge names" lines use `NameA,NameB,BridgeName` (example: `Brandon,Emily,Edward`).

## Integrate in a website

```html
<script src="/path/to/cp-solver.js"></script>
<script src="/path/to/scrabble-collage.js"></script>
<script>
  const words = ["Brandon", "Edward", "Emily", "Mason", "Preston", "Trisha", "Scott"];
  const preferences = [
    { a: "Scott", b: "Trisha", type: "mustTouch" },
    { a: "Brandon", b: "Emily", type: "preferConnected", via: ["Edward"] }
  ];

  const result = window.ScrabbleCollage.solveBestCollage(words, {
    preferences,
    strictCrossChecks: true,
    feasibilityTimeBudget: 1500,
    optimizationTimeBudget: 2500
  });

  console.log(result.solver);              // { engine: "cp", optimal: true, ... }
  console.log(result.placements);
  console.log(result.metrics.constraints);
</script>
```

## Node usage

```js
const { solveBestCollage } = require("./src/scrabble-collage");

const result = solveBestCollage(
  ["Brandon", "Edward", "Emily", "Mason", "Preston", "Trisha", "Scott"],
  {
    preferences: [
      { a: "Scott", b: "Trisha", type: "mustTouch" },
      { a: "Brandon", b: "Emily", type: "preferConnected", via: ["Edward"] }
    ]
  }
);

console.log(result.solver);                 // engine + optimal flag
console.log(result.metrics.preferenceReports);
```

The CP solver is also exported on its own if you only need placements:

```js
const { solveCollage } = require("./src/cp-solver");
const cpResult = solveCollage(words, { preferences });
```

## Tiered objective and budgets

`solveCollage` runs in two phases that share one backtracking core:

- **Phase 1 - feasibility** searches until the first layout that satisfies every hard constraint (`mustTouch`, `via` chain, no incidental cross words). Stops as soon as one is found, or when the budget runs out.
- **Phase 2 - optimization** keeps searching with a branch-and-bound objective: maximize intersections, then minimize bounding-box perimeter. Stops on UNSAT (proof of optimality) or when the budget runs out (best feasible kept).

Budget options (all optional):

| Option                     | Default | Meaning                                              |
| -------------------------- | ------- | ---------------------------------------------------- |
| `strictCrossChecks`        | `true`  | Reject incidental cross-words.                       |
| `requireConnected`         | `true`  | Every word must be anchored on the partial board.    |
| `feasibilityTimeBudget`    | 1500 ms | Wall-clock cap for phase 1.                          |
| `feasibilityNodeBudget`    | 200000  | Search-node cap for phase 1.                         |
| `optimizationTimeBudget`   | 2500 ms | Wall-clock cap for phase 2.                          |
| `optimizationNodeBudget`   | 200000  | Search-node cap for phase 2.                         |
| `onProgress`               | `null`  | Optional callback `(event) => void` for status info. |

`solveBestCollage` accepts the same CP options, plus heuristic-fallback options (`seedCount`, `maxAttempts`, `randomSeed`, ...). Set `fallbackSearch: false` to skip the heuristic and surface the CP failure directly.

## Search the heuristic directly (legacy path)

The original heuristic search is still available when you want raw seed-based behavior:

```js
const result = searchBestCollage(words, {
  preferences,
  randomSeed: 20260524,
  seedCount: 120,
  maxAttempts: 240,
});
console.log(result.metrics.constraints);
console.log(result.search.bestSeed);
```

## Output shape

`solveBestCollage()` and `buildScrabbleCollage()` both return:

- `placements`: word positions and directions.
- `board`: 2D tile matrix.
- `metrics`:
  - `score`
  - `overlapCount`
  - `components`
  - `constraints` (`mustTouchSatisfied`, `bridgeSatisfied`, `allSatisfied`, ...)
  - `preferenceReports[]` including `directTouch`, `hopDistance`, `centerDistance`, `stitchedPath`, `via`, `viaSatisfied`.
- `solver` (`solveBestCollage` only): `{ engine: "cp" | "heuristic", optimal: boolean, status, stats }`.

## Tests

```bash
node tests/cp-solver.test.js
```
