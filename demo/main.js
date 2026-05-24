"use strict";

(function runDemo() {
  const boardEl = document.getElementById("board");
  const metaEl = document.getElementById("meta");
  const connectionsEl = document.getElementById("connections");
  const buildBtn = document.getElementById("buildBtn");
  const wordsEl = document.getElementById("words");
  const mustTouchEl = document.getElementById("mustTouch");
  const softPairsEl = document.getElementById("softPairs");
  const seedEl = document.getElementById("seedInput");

  function readWords() {
    return wordsEl.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function buildPreferences() {
    const mustTouch = window.ScrabbleCollage.parsePairLines(mustTouchEl.value, "mustTouch");
    const soft = window.ScrabbleCollage.parsePairLines(softPairsEl.value, "preferConnected").map((pref) => {
      const allowed = new Set(["preferConnected", "preferNear", "preferTouch", "mustTouch"]);
      return {
        ...pref,
        type: allowed.has(pref.type) ? pref.type : "preferConnected",
      };
    });
    return [...mustTouch, ...soft];
  }

  function renderBoard(board) {
    boardEl.innerHTML = "";
    const rows = board.rows || [];
    if (!rows.length) {
      boardEl.textContent = "No words to render yet.";
      return;
    }

    boardEl.style.gridTemplateColumns = `repeat(${rows[0].length}, 32px)`;
    for (const row of rows) {
      for (const ch of row) {
        const cell = document.createElement("div");
        cell.className = `cell ${ch ? "tile" : "empty"}`;
        cell.textContent = ch || "";
        boardEl.appendChild(cell);
      }
    }
  }

  function renderMetrics(result) {
    metaEl.innerHTML = `
      <strong>Score:</strong> ${result.metrics.score}
      &nbsp; | &nbsp;
      <strong>Intersections:</strong> ${result.metrics.overlapCount}
      &nbsp; | &nbsp;
      <strong>Components:</strong> ${result.metrics.components}
    `;

    if (!result.metrics.preferenceReports.length) {
      connectionsEl.textContent = "No pair preferences were provided.";
      return;
    }

    const blocks = result.metrics.preferenceReports.map((report) => {
      const hopText = Number.isFinite(report.hopDistance) ? String(report.hopDistance) : "unconnected";
      const pathText = report.stitchedPath ? report.stitchedPath.join(" -> ") : "(none)";
      const touchClass = report.directTouch ? "ok" : "warn";
      return `
        <div>
          <strong>${report.a} x ${report.b}</strong>
          (${report.type})
          <span class="${touchClass}">${report.directTouch ? "touching" : "not touching"}</span>
          <br />
          hopDistance: ${hopText}, centerDistance: ${report.centerDistance}
          <br />
          stitched path: ${pathText}
          <br />
          via request: ${report.via && report.via.length ? report.via.join(" -> ") : "(none)"}
          ${report.via && report.via.length ? ` <span class="${report.viaSatisfied ? "ok" : "warn"}">${report.viaSatisfied ? "via satisfied" : "via not satisfied"}</span>` : ""}
        </div>
      `;
    });

    connectionsEl.innerHTML = `<h4>Connection Report</h4>${blocks.join("<hr />")}`;
  }

  function generate() {
    const seed = Number(seedEl.value) || Date.now();
    const words = readWords();
    const preferences = buildPreferences();

    const result = window.ScrabbleCollage.buildScrabbleCollage(words, {
      preferences,
      randomSeed: seed,
      maxAttempts: 180,
    });

    renderBoard(result.board);
    renderMetrics(result);
  }

  buildBtn.addEventListener("click", generate);
  generate();
})();
