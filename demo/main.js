"use strict";

(function runDemo() {
  const boardEl = document.getElementById("board");
  const metaEl = document.getElementById("meta");
  const connectionsEl = document.getElementById("connections");
  const constraintStatusEl = document.getElementById("constraintStatus");
  const searchStatusEl = document.getElementById("searchStatus");
  const searchProgressWrapEl = document.getElementById("searchProgressWrap");
  const progressBarEl = document.getElementById("progressBar");
  const progressTextEl = document.getElementById("progressText");
  const progressPercentEl = document.getElementById("progressPercent");
  const buildBtn = document.getElementById("buildBtn");
  const searchBtn = document.getElementById("searchBtn");
  const wordsEl = document.getElementById("words");
  const mustTouchEl = document.getElementById("mustTouch");
  const bridgePairsEl = document.getElementById("bridgePairs");

  let searchGeneration = 0;
  const SEARCH_MAX_ATTEMPTS = 120;
  const HEURISTIC_SEED_COUNT = 80;
  const STOP_AFTER_SATISFIED = 8;
  const CP_FEASIBILITY_TIME_BUDGET = 1500;
  const CP_OPTIMIZATION_TIME_BUDGET = 2500;

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

  function setBusy(isBusy) {
    buildBtn.disabled = isBusy;
    searchBtn.disabled = isBusy;
    searchProgressWrapEl.hidden = !isBusy;
  }

  function setSolveProgress(label, pct) {
    const clamped = Math.max(0, Math.min(100, pct));
    progressBarEl.style.width = `${clamped}%`;
    progressPercentEl.textContent = `${Math.round(clamped)}%`;
    progressTextEl.textContent = label;
  }

  function setSearchStatus(message, tone) {
    searchStatusEl.textContent = message;
    searchStatusEl.className = `status-banner ${tone || "info"}`;
  }

  function renderConstraintStatus(result) {
    const summary = result.metrics.constraints;
    const parts = [];

    if (summary.mustTouchTotal > 0) {
      parts.push(`touching pairs ${summary.mustTouchSatisfied}/${summary.mustTouchTotal}`);
    }
    if (summary.bridgeTotal > 0) {
      parts.push(`middle-name links ${summary.bridgeSatisfied}/${summary.bridgeTotal}`);
    }
    if (result.metrics.components > 1) {
      parts.push(`${result.metrics.components} separate groups`);
    }

    const detail = parts.length ? parts.join(" · ") : "no special connection rules";
    const connectedNote =
      summary.allConnected === false ? " · some names aren't on the same board yet" : "";
    const solver = (result && result.solver) || null;
    const solverNote = solver ? solverNoteFor(solver) : "";

    if (summary.allSatisfied) {
      constraintStatusEl.className = "status-banner ok";
      constraintStatusEl.textContent = `Looks great — all your names connect the way you wanted (${detail})${solverNote}.`;
      return;
    }

    constraintStatusEl.className = "status-banner warn";
    constraintStatusEl.textContent = `Almost there — not every rule is met yet (${detail})${connectedNote}${solverNote}. Try changing your name list or connection rules.`;
  }

  function solverNoteFor(solver) {
    if (!solver) {
      return "";
    }
    if (solver.engine === "cp") {
      return solver.optimal
        ? " · our best possible layout"
        : " · a strong layout (we ran out of time to check for an even better one)";
    }
    if (solver.engine === "heuristic") {
      if (solver.status === "cp-incomplete") {
        return " · quick layout after the thorough search couldn't meet every rule";
      }
      if (solver.status === "cp-unavailable") {
        return " · quick layout (thorough search wasn't available)";
      }
      return " · quick layout";
    }
    return "";
  }

  function renderBoard(board) {
    boardEl.innerHTML = "";
    const rows = board.rows || [];
    if (!rows.length) {
      boardEl.textContent = "Add your names, then click Find my best layout.";
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
          cell.title = `${ch} — ${tileScore(ch)} point${tileScore(ch) === 1 ? "" : "s"}`;
        }
        fragment.appendChild(cell);
      }
    }

    boardEl.appendChild(fragment);
  }

  function renderMeta(result) {
    const stats = [
      ["Total score", result.metrics.score],
      ["Shared letters", result.metrics.overlapCount],
      ["Groups", result.metrics.components],
      ["Names placed", result.placements.length],
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
      connectionsEl.innerHTML = `<h3>Name connections</h3><div class="row">You didn't ask for any special touching rules.</div>`;
      return;
    }

    const blocks = result.metrics.preferenceReports.map((report) => {
      const pathText = report.stitchedPath ? report.stitchedPath.join(" → ") : "not connected yet";
      const viaText = report.via && report.via.length ? report.via.join(" → ") : "";
      const isMustTouch = report.type === "mustTouch";
      const ruleOk = isMustTouch
        ? report.directTouch
        : report.via && report.via.length
          ? report.viaSatisfied
          : report.directTouch;
      const ruleLabel = isMustTouch
        ? report.directTouch
          ? "Touching"
          : "Not touching yet"
        : report.via && report.via.length
          ? report.viaSatisfied
            ? "Connected through middle name"
            : "Middle name link missing"
          : report.directTouch
            ? "Touching"
            : "Not touching yet";
      const viaChip =
        report.via && report.via.length
          ? `<span class="chip ${report.viaSatisfied ? "ok" : "warn"}">${report.viaSatisfied ? "Middle name works" : "Middle name missing"}</span>`
          : "";

      const viaRow =
        viaText
          ? `<div class="row">Through: <span class="mono">${viaText}</span></div>`
          : "";
      const pathRow =
        pathText !== "not connected yet"
          ? `<div class="row">How they link: <span class="mono">${pathText}</span></div>`
          : `<div class="row">How they link: not connected yet</div>`;

      return `
        <div class="connection-item">
          <div class="connection-title">
            ${report.a} &amp; ${report.b}
            <span class="chip ${ruleOk ? "ok" : "warn"}">${ruleLabel}</span>
            ${viaChip}
          </div>
          ${viaRow}
          ${pathRow}
        </div>
      `;
    });

    connectionsEl.innerHTML = `
      <h3>Name connections</h3>
      <div class="connection-list">${blocks.join("")}</div>
    `;
  }

  function showResult(result) {
    renderBoard(result.board);
    renderMeta(result);
    renderConstraintStatus(result);
    renderConnections(result);
  }

  function generateOnce() {
    const result = window.ScrabbleCollage.buildScrabbleCollage(readWords(), {
      preferences: buildPreferences(),
      randomSeed: Date.now(),
      maxAttempts: 220,
      strictCrossChecks: true,
    });
    showResult(result);
    setSearchStatus(
      "Here's a quick layout to peek at.",
      result.metrics.constraints.allSatisfied ? "ok" : "warn"
    );
  }

  function yieldToBrowser() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.setTimeout(resolve, 0);
      });
    });
  }

  async function searchBestMix() {
    const generation = searchGeneration + 1;
    searchGeneration = generation;

    const words = readWords();
    const preferences = buildPreferences();

    if (!words.length) {
      setSearchStatus("Please add at least one name first.", "warn");
      return;
    }

    setBusy(true);
    setSolveProgress("Checking if your rules can work…", 5);
    setSearchStatus("Looking for the best arrangement…", "info");

    try {
      // Yield once so the busy state and progress bar render before the
      // CP solver starts blocking the JS thread.
      await yieldToBrowser();

      if (generation !== searchGeneration) {
        return;
      }

      const result = window.ScrabbleCollage.solveBestCollage(words, {
        preferences,
        strictCrossChecks: true,
        feasibilityTimeBudget: CP_FEASIBILITY_TIME_BUDGET,
        optimizationTimeBudget: CP_OPTIMIZATION_TIME_BUDGET,
        // Heuristic fallback config
        randomSeed: Date.now(),
        maxAttempts: SEARCH_MAX_ATTEMPTS,
        seedCount: HEURISTIC_SEED_COUNT,
        stopAfterSatisfied: STOP_AFTER_SATISFIED,
        fallbackSearch: true,
      });

      if (generation !== searchGeneration) {
        return;
      }

      setSolveProgress("All set!", 100);
      showResult(result);
      setSearchStatus(buildFinishedStatus(result), pickStatusTone(result));
    } catch (error) {
      console.error(error);
      setSearchStatus(`Something went wrong: ${error.message}`, "warn");
    } finally {
      if (generation === searchGeneration) {
        setBusy(false);
      }
    }
  }

  function buildFinishedStatus(result) {
    const solver = result && result.solver;
    const constraints = result && result.metrics && result.metrics.constraints;
    const allSatisfied = constraints && constraints.allSatisfied;

    if (solver && solver.engine === "cp" && solver.optimal && allSatisfied) {
      return "Found the best layout for your rules.";
    }
    if (solver && solver.engine === "cp" && allSatisfied) {
      return "Found a layout that follows your rules. We stopped before checking every possibility.";
    }
    if (solver && solver.engine === "cp" && !allSatisfied) {
      return "We couldn't fit every rule with these names. Try fewer rules or different names.";
    }
    if (solver && solver.engine === "heuristic" && allSatisfied) {
      return "Found a layout that works — we used a quicker method after the thorough search needed more time.";
    }
    if (solver && solver.engine === "heuristic" && !allSatisfied) {
      return "Here's the closest layout we could make. Try adjusting your names or rules.";
    }
    return "All set!";
  }

  function pickStatusTone(result) {
    const constraints = result && result.metrics && result.metrics.constraints;
    if (!constraints) {
      return "info";
    }
    return constraints.allSatisfied ? "ok" : "warn";
  }

  buildBtn.addEventListener("click", generateOnce);
  searchBtn.addEventListener("click", () => {
    searchBestMix();
  });
})();
