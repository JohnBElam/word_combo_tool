"use strict";

(function runDemo() {
  const boardEl = document.getElementById("board");
  const metaEl = document.getElementById("meta");
  const connectionsEl = document.getElementById("connections");
  const buildBtn = document.getElementById("buildBtn");
  const wordsEl = document.getElementById("words");
  const mustTouchEl = document.getElementById("mustTouch");
  const bridgePairsEl = document.getElementById("bridgePairs");
  const seedEl = document.getElementById("seedInput");

  const SCORE_MAP = {
    A: 1,
    B: 3,
    C: 3,
    D: 2,
    E: 1,
    F: 4,
    G: 2,
    H: 4,
    I: 1,
    J: 8,
    K: 5,
    L: 1,
    M: 3,
    N: 1,
    O: 1,
    P: 3,
    Q: 10,
    R: 1,
    S: 1,
    T: 1,
    U: 1,
    V: 4,
    W: 4,
    X: 8,
    Y: 4,
    Z: 10,
  };

  function readWords() {
    return wordsEl.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function parseBridgePairs() {
    const bridges = [];
    const lines = String(bridgePairsEl.value || "").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const [a, b, viaRaw] = trimmed.split(",").map((part) => part.trim());
      if (!a || !b || !viaRaw) {
        continue;
      }

      const via = viaRaw.split("|").map((part) => part.trim()).filter(Boolean);
      if (via.length === 0) {
        continue;
      }

      bridges.push({
        a,
        b,
        type: "preferConnected",
        via,
      });
    }
    return bridges;
  }

  function buildPreferences() {
    const mustTouch = window.ScrabbleCollage.parsePairLines(mustTouchEl.value, "mustTouch");
    return [...mustTouch, ...parseBridgePairs()];
  }

  function tileScore(letter) {
    return SCORE_MAP[letter] || 1;
  }

  function renderBoard(board) {
    boardEl.innerHTML = "";
    const rows = board.rows || [];
    if (!rows.length) {
      boardEl.textContent = "Add words, then click Generate.";
      return;
    }

    boardEl.style.gridTemplateColumns = `repeat(${rows[0].length}, 38px)`;
    const fragment = document.createDocumentFragment();

    for (const row of rows) {
      for (const ch of row) {
        const cell = document.createElement("div");
        cell.className = `cell ${ch ? "tile" : "empty"}`;
        if (ch) {
          const letter = document.createElement("span");
          letter.className = "letter";
          letter.textContent = ch;

          const score = document.createElement("span");
          score.className = "score";
          score.textContent = String(tileScore(ch));

          cell.appendChild(letter);
          cell.appendChild(score);
          cell.title = `Letter ${ch} (${tileScore(ch)} points)`;
        }
        fragment.appendChild(cell);
      }
    }

    boardEl.appendChild(fragment);
  }

  function renderMeta(result) {
    const stats = [
      ["Score", result.metrics.score],
      ["Intersections", result.metrics.overlapCount],
      ["Components", result.metrics.components],
      ["Words Placed", result.placements.length],
    ];

    metaEl.innerHTML = stats
      .map(
        ([k, v]) => `
          <div class="stat">
            <div class="k">${k}</div>
            <div class="v">${v}</div>
          </div>
        `
      )
      .join("");
  }

  function renderConnections(result) {
    if (!result.metrics.preferenceReports.length) {
      connectionsEl.innerHTML = `<h3>Connection Report</h3><div class="row">No pair preferences were provided.</div>`;
      return;
    }

    const blocks = result.metrics.preferenceReports.map((report) => {
      const hopText = Number.isFinite(report.hopDistance) ? String(report.hopDistance) : "unconnected";
      const pathText = report.stitchedPath ? report.stitchedPath.join(" -> ") : "(none)";
      const viaText = report.via && report.via.length ? report.via.join(" -> ") : "(none)";
      const connectionMode = report.via && report.via.length ? "bridge" : report.type;
      const viaChip =
        report.via && report.via.length
          ? `<span class="chip ${report.viaSatisfied ? "ok" : "warn"}">${report.viaSatisfied ? "via satisfied" : "via missing"}</span>`
          : "";

      return `
        <div class="connection-item">
          <div class="connection-title">
            ${report.a} x ${report.b}
            <span class="chip ${report.directTouch ? "ok" : "warn"}">${report.directTouch ? "touching" : "not touching"}</span>
            ${viaChip}
          </div>
          <div class="row">mode: <span class="mono">${connectionMode}</span> | hops: <span class="mono">${hopText}</span> | distance: <span class="mono">${report.centerDistance}</span></div>
          <div class="row">stitched path: <span class="mono">${pathText}</span></div>
          <div class="row">via request: <span class="mono">${viaText}</span></div>
        </div>
      `;
    });

    connectionsEl.innerHTML = `
      <h3>Connection Report</h3>
      <div class="connection-list">${blocks.join("")}</div>
    `;
  }

  function generate() {
    const seed = Number(seedEl.value) || Date.now();
    const words = readWords();
    const preferences = buildPreferences();

    const result = window.ScrabbleCollage.buildScrabbleCollage(words, {
      preferences,
      randomSeed: seed,
      maxAttempts: 220,
      strictCrossChecks: true,
    });

    renderBoard(result.board);
    renderMeta(result);
    renderConnections(result);
  }

  buildBtn.addEventListener("click", generate);
  generate();
})();
