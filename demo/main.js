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
  const seedEl = document.getElementById("seedInput");
  const seedSearchCountEl = document.getElementById("seedSearchCount");

  let searchGeneration = 0;
  const SEARCH_MAX_ATTEMPTS = 120;
  const STOP_AFTER_SATISFIED = 8;

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

  function readSeedStart() {
    const parsed = Number(seedEl.value);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }

  function readSeedSearchCount() {
    const parsed = Number(seedSearchCountEl.value);
    if (!Number.isFinite(parsed)) {
      return 80;
    }
    return Math.min(500, Math.max(1, Math.floor(parsed)));
  }

  function tileScore(letter) {
    return SCORE_MAP[letter] || 1;
  }

  function setBusy(isBusy) {
    buildBtn.disabled = isBusy;
    searchBtn.disabled = isBusy;
    searchProgressWrapEl.hidden = !isBusy;
  }

  function setSearchProgress(tried, total) {
    const pct = total > 0 ? Math.min(100, Math.round((tried / total) * 100)) : 0;
    progressBarEl.style.width = `${pct}%`;
    progressPercentEl.textContent = `${pct}%`;
    progressTextEl.textContent = `Searching seeds ${tried} of ${total}`;
  }

  function setSearchStatus(message, tone) {
    searchStatusEl.textContent = message;
    searchStatusEl.className = `status-banner ${tone || "info"}`;
  }

  function renderConstraintStatus(result, searchMeta) {
    const summary = result.metrics.constraints;
    const parts = [];

    if (summary.mustTouchTotal > 0) {
      parts.push(`must-touch ${summary.mustTouchSatisfied}/${summary.mustTouchTotal}`);
    }
    if (summary.bridgeTotal > 0) {
      parts.push(`bridges ${summary.bridgeSatisfied}/${summary.bridgeTotal}`);
    }

    const detail = parts.length ? parts.join(" · ") : "no connection rules configured";
    const seedNote = searchMeta ? ` · best seed ${searchMeta.bestSeed} (${searchMeta.seedsTried} tried)` : "";

    if (summary.allSatisfied) {
      constraintStatusEl.className = "status-banner ok";
      constraintStatusEl.textContent = `All connection rules satisfied (${detail})${seedNote}.`;
      return;
    }

    constraintStatusEl.className = "status-banner warn";
    constraintStatusEl.textContent = `Best mix so far is incomplete (${detail})${seedNote}. Try more seeds or adjust words.`;
  }

  function renderBoard(board) {
    boardEl.innerHTML = "";
    const rows = board.rows || [];
    if (!rows.length) {
      boardEl.textContent = "Add words, then click Find Best Mix.";
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

  function renderMeta(result, searchMeta) {
    const stats = [
      ["Score", result.metrics.score],
      ["Intersections", result.metrics.overlapCount],
      ["Components", result.metrics.components],
      ["Words Placed", result.placements.length],
    ];

    if (searchMeta) {
      stats.push(["Best Seed", searchMeta.bestSeed]);
      stats.push(["Seeds Tried", searchMeta.seedsTried]);
    } else {
      stats.push(["Seed", readSeedStart()]);
    }

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
      const isMustTouch = report.type === "mustTouch";
      const ruleOk = isMustTouch
        ? report.directTouch
        : report.via && report.via.length
          ? report.viaSatisfied
          : report.directTouch;
      const ruleLabel = isMustTouch
        ? report.directTouch
          ? "must-touch ok"
          : "must-touch missing"
        : report.via && report.via.length
          ? report.viaSatisfied
            ? "bridge ok"
            : "bridge missing"
          : report.directTouch
            ? "touching"
            : "not touching";
      const viaChip =
        report.via && report.via.length
          ? `<span class="chip ${report.viaSatisfied ? "ok" : "warn"}">${report.viaSatisfied ? "via satisfied" : "via missing"}</span>`
          : "";

      return `
        <div class="connection-item">
          <div class="connection-title">
            ${report.a} x ${report.b}
            <span class="chip ${ruleOk ? "ok" : "warn"}">${ruleLabel}</span>
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

  function showResult(result, searchMeta) {
    renderBoard(result.board);
    renderMeta(result, searchMeta);
    renderConstraintStatus(result, searchMeta);
    renderConnections(result);

    if (searchMeta) {
      seedEl.value = String(searchMeta.bestSeed);
    }
  }

  function generateOnce() {
    const seed = readSeedStart();
    const result = window.ScrabbleCollage.buildScrabbleCollage(readWords(), {
      preferences: buildPreferences(),
      randomSeed: seed,
      maxAttempts: 220,
      strictCrossChecks: true,
    });
    showResult(result, null);
    setSearchStatus(`Quick layout for seed ${seed}.`, result.metrics.constraints.allSatisfied ? "ok" : "warn");
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
    const seedStart = readSeedStart();
    const seedCount = readSeedSearchCount();

    if (!words.length) {
      setSearchStatus("Add at least one word before searching.", "warn");
      return;
    }

    setBusy(true);
    setSearchProgress(0, seedCount);
    setSearchStatus(`Searching up to ${seedCount} seeds…`, "info");

    let bestResult = null;
    let bestRank = -Infinity;
    let bestSeed = seedStart;
    let seedsTried = 0;
    let satisfiedStreak = 0;
    let finished = false;

    try {
      for (let i = 0; i < seedCount; i += 1) {
        if (generation !== searchGeneration) {
          return;
        }

        const seed = (seedStart + i) >>> 0;
        const result = window.ScrabbleCollage.buildScrabbleCollage(words, {
          preferences,
          randomSeed: seed,
          maxAttempts: SEARCH_MAX_ATTEMPTS,
          strictCrossChecks: true,
        });
        seedsTried += 1;

        const rankScore = window.ScrabbleCollage.layoutQualityRank(result.metrics);
        if (!bestResult || rankScore > bestRank) {
          bestResult = result;
          bestRank = rankScore;
          bestSeed = seed;
        }

        const constraints = result.metrics.constraints;
        if (constraints.allSatisfied) {
          satisfiedStreak += 1;
          if (satisfiedStreak >= STOP_AFTER_SATISFIED) {
            break;
          }
        } else {
          satisfiedStreak = 0;
        }

        setSearchProgress(seedsTried, seedCount);

        const interim = bestResult.metrics.constraints;
        setSearchStatus(
          `Tried ${seedsTried}/${seedCount} · must-touch ${interim.mustTouchSatisfied}/${interim.mustTouchTotal} · bridges ${interim.bridgeSatisfied}/${interim.bridgeTotal}`,
          interim.allSatisfied ? "ok" : "info"
        );

        // Refresh preview every 4 seeds (and on the last seed) to keep UI responsive.
        if (seedsTried % 4 === 0 || seedsTried === seedCount) {
          showResult(bestResult, { bestSeed, seedsTried, seedCount });
        }

        await yieldToBrowser();
      }

      finished = true;
      setSearchProgress(seedCount, seedCount);

      const searchMeta = {
        bestSeed,
        seedsTried,
        seedCount,
        allSatisfied: bestResult.metrics.constraints.allSatisfied,
      };

      showResult(bestResult, searchMeta);

      if (searchMeta.allSatisfied) {
        setSearchStatus(`Done — full match after ${seedsTried} seeds (best seed ${bestSeed}).`, "ok");
      } else {
        setSearchStatus(
          `Done — best mix after ${seedsTried} seeds (best seed ${bestSeed}). Try more seeds if needed.`,
          "warn"
        );
      }
    } catch (error) {
      console.error(error);
      setSearchStatus(`Search failed: ${error.message}`, "warn");
    } finally {
      if (generation === searchGeneration) {
        setBusy(false);
        if (finished) {
          setSearchProgress(seedsTried, seedCount);
        } else {
          searchProgressWrapEl.hidden = true;
        }
      }
    }
  }

  buildBtn.addEventListener("click", generateOnce);
  searchBtn.addEventListener("click", () => {
    searchBestMix();
  });
})();
