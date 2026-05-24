# word_combo_tool

Builds "Scrabble collage" style layouts from names/words, with optional pair preferences:

- `mustTouch`: strongest preference to directly intersect.
- `preferTouch`: prefer direct intersection, but not required.
- `preferConnected`: allow a stitched path through other words.
- `preferNear`: keep words physically close.
- Optional `via`: enforce/encourage stitching through specific names (for example Brandon -> Edward -> Emily).

## Files

- `src/scrabble-collage.js` - reusable JavaScript engine (browser + Node compatible).
- `demo/index.html` - standalone UI demo.
- `demo/main.js` - demo logic and rendering.

## Quick start (browser)

1. Serve the repo with any static server.
2. Open `demo/index.html`.
3. Enter words and preferences, then click **Generate Collage**.

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
    maxAttempts: 180
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

## Output shape

`buildScrabbleCollage()` returns:

- `placements`: word positions and directions.
- `board`: 2D tile matrix.
- `metrics`:
  - `score`
  - `overlapCount`
  - `components`
  - `preferenceReports[]` including:
    - `directTouch`
    - `hopDistance`
    - `centerDistance`
    - `stitchedPath` (e.g. `BRANDON -> EDWARD -> EMILY`)
    - `via` and `viaSatisfied` for requested stitch-through words
