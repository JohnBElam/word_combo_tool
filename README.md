# word_combo_tool

Builds "Scrabble collage" style layouts from names/words, with optional pair preferences:

- `mustTouch`: strongest preference to directly intersect.
- `preferTouch`: prefer direct intersection, but not required.
- `preferConnected`: allow a stitched path through other words.
- `preferNear`: keep words physically close.
- Optional `via`: enforce/encourage stitching through specific names (for example Brandon -> Edward -> Emily).
- `strictCrossChecks` (default `true`): rejects accidental fragments (for example invalid mini-combos like `MB` or `IND`).

## Files

- `src/scrabble-collage.js` - reusable JavaScript engine (browser + Node compatible).
- `demo/index.html` - standalone UI demo.
- `demo/main.js` - demo logic and rendering.

## Quick start (browser)

1. Serve the repo with any static server.
2. Open `demo/index.html`.
3. Enter words and preferences, then click **Find Best Mix** (searches many seeds for layouts that satisfy must-touch and bridge rules).
   - **Quick try (this seed only)** runs a single seed for comparison.
   - In the demo UI, "Bridge names" lines use `NameA,NameB,BridgeName` (example: `Brandon,Emily,Edward`).

## Integrate in a website

```html
<script src="/path/to/scrabble-collage.js"></script>
<script>
  const words = ["Brandon", "Edward", "Emily", "Mason", "Preston", "Trisha", "Scott"];
  const preferences = [
    { a: "Scott", b: "Trisha", type: "mustTouch" },
    { a: "Brandon", b: "Emily", type: "preferConnected", via: ["Edward"] }
  ];

  const result = window.ScrabbleCollage.buildScrabbleCollage(words, {
    preferences,
    randomSeed: 20260524,
    maxAttempts: 180,
    strictCrossChecks: true
  });

  console.log(result.placements);
  console.log(result.metrics.preferenceReports);
</script>
```

## Node usage

```js
const { buildScrabbleCollage } = require("./src/scrabble-collage");

const result = buildScrabbleCollage(
  ["Brandon", "Edward", "Emily", "Mason", "Preston", "Trisha", "Scott"],
  {
    preferences: [
      { a: "Scott", b: "Trisha", type: "mustTouch" },
      { a: "Brandon", b: "Emily", type: "preferConnected", via: ["Edward"] }
    ],
    randomSeed: 42
  }
);

console.log(result.metrics.preferenceReports);
```

## Search for better mixes

`searchBestCollage()` tries multiple seeds and keeps the layout that best satisfies must-touch and bridge (`via`) rules, then breaks ties by score:

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

`buildScrabbleCollage()` returns:

- `placements`: word positions and directions.
- `board`: 2D tile matrix.
- `metrics`:
  - `score`
  - `overlapCount`
  - `components`
  - `constraints` (`mustTouchSatisfied`, `bridgeSatisfied`, `allSatisfied`, …)
  - `preferenceReports[]` including:
    - `directTouch`
    - `hopDistance`
    - `centerDistance`
    - `stitchedPath` (e.g. `BRANDON -> EDWARD -> EMILY`)
    - `via` and `viaSatisfied` for requested stitch-through words
