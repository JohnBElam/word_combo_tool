/* eslint-disable no-undef */
(function setupScrabbleCollage(globalScope) {
  "use strict";

  const DEFAULT_OPTIONS = {
    maxAttempts: 140,
    randomSeed: Date.now(),
    randomTopChoices: 4,
    strictCrossChecks: true,
    requireConnected: true,
  };

  function normalizeWord(word) {
    return String(word || "")
      .trim()
      .replace(/\s+/g, "")
      .toUpperCase();
  }

  function createSeededRandom(seed) {
    let state = seed >>> 0;
    return function nextRandom() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makePairKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  function parsePreferences(preferences, wordSet) {
    const parsed = [];
    for (const pref of preferences || []) {
      if (!pref || !pref.a || !pref.b) {
        continue;
      }

      const a = normalizeWord(pref.a);
      const b = normalizeWord(pref.b);
      if (!a || !b || a === b) {
        continue;
      }
      if (!wordSet.has(a) || !wordSet.has(b)) {
        continue;
      }

      const type = String(pref.type || "preferTouch");
      const via = [];
      const rawVia = Array.isArray(pref.via) ? pref.via : pref.via ? [pref.via] : [];
      for (const viaWord of rawVia) {
        const normalizedVia = normalizeWord(viaWord);
        if (!normalizedVia || normalizedVia === a || normalizedVia === b || !wordSet.has(normalizedVia)) {
          continue;
        }
        if (!via.includes(normalizedVia)) {
          via.push(normalizedVia);
        }
      }
      parsed.push({
        a,
        b,
        type,
        weight: Number.isFinite(pref.weight) ? pref.weight : 1,
        via,
      });
    }
    return parsed;
  }

  function lettersOverlap(a, b) {
    const letters = new Set(a.split(""));
    for (const ch of b) {
      if (letters.has(ch)) {
        return true;
      }
    }
    return false;
  }

  function buildRelationIndex(words, preferences) {
    const byWord = new Map();
    const byPair = new Map();
    const overlapByPair = new Map();

    for (const word of words) {
      byWord.set(word, []);
    }

    for (const pref of preferences) {
      const key = makePairKey(pref.a, pref.b);
      byPair.set(key, pref);
      byWord.get(pref.a).push(pref);
      byWord.get(pref.b).push(pref);
    }

    for (let i = 0; i < words.length; i += 1) {
      for (let j = i + 1; j < words.length; j += 1) {
        overlapByPair.set(makePairKey(words[i], words[j]), lettersOverlap(words[i], words[j]));
      }
    }

    return { byWord, byPair, overlapByPair };
  }

  function computeWordOrder(words, relationIndex, rng) {
    const decorated = words.map((word) => {
      let relationScore = 0;
      const relations = relationIndex.byWord.get(word) || [];
      for (const rel of relations) {
        if (rel.type === "mustTouch") {
          relationScore += 5 * rel.weight;
        } else if (rel.type === "preferConnected") {
          relationScore += 3 * rel.weight;
        } else if (rel.type === "preferNear") {
          relationScore += 2 * rel.weight;
        } else {
          relationScore += 2.5 * rel.weight;
        }
      }

      return {
        word,
        score: relationScore * 100 + word.length * 10 + rng(),
      };
    });

    decorated.sort((a, b) => b.score - a.score);
    return decorated.map((entry) => entry.word);
  }

  function getCellsForPlacement(placement) {
    const cells = [];
    for (let i = 0; i < placement.word.length; i += 1) {
      const row = placement.row + (placement.direction === "down" ? i : 0);
      const col = placement.col + (placement.direction === "across" ? i : 0);
      cells.push({ row, col, letter: placement.word[i], index: i });
    }
    return cells;
  }

  function getPlacementCenter(placement) {
    if (!placement) {
      return { row: 0, col: 0 };
    }
    const mid = (placement.word.length - 1) / 2;
    return {
      row: placement.row + (placement.direction === "down" ? mid : 0),
      col: placement.col + (placement.direction === "across" ? mid : 0),
    };
  }

  function centerDistance(a, b) {
    return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
  }

  function createState() {
    return {
      board: new Map(),
      placements: [],
      placementByWord: new Map(),
      bbox: { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 },
      overlapCount: 0,
    };
  }

  function setBBoxFromPlacement(bbox, placement) {
    const cells = getCellsForPlacement(placement);
    for (const cell of cells) {
      bbox.minRow = Math.min(bbox.minRow, cell.row);
      bbox.maxRow = Math.max(bbox.maxRow, cell.row);
      bbox.minCol = Math.min(bbox.minCol, cell.col);
      bbox.maxCol = Math.max(bbox.maxCol, cell.col);
    }
  }

  function readBoardLetter(state, transientLetters, row, col) {
    const key = `${row},${col}`;
    if (transientLetters.has(key)) {
      return transientLetters.get(key);
    }
    const existing = state.board.get(key);
    return existing ? existing.letter : "";
  }

  function collectLineWord(state, transientLetters, row, col, rowStep, colStep) {
    let startRow = row;
    let startCol = col;

    while (readBoardLetter(state, transientLetters, startRow - rowStep, startCol - colStep)) {
      startRow -= rowStep;
      startCol -= colStep;
    }

    const letters = [];
    let currentRow = startRow;
    let currentCol = startCol;
    while (true) {
      const letter = readBoardLetter(state, transientLetters, currentRow, currentCol);
      if (!letter) {
        break;
      }
      letters.push(letter);
      currentRow += rowStep;
      currentCol += colStep;
    }

    return letters.join("");
  }

  function canPlaceWord(state, placement, allowedWordSet, options) {
    let overlapCount = 0;
    const cells = getCellsForPlacement(placement);
    const transientLetters = new Map();

    for (const cell of cells) {
      const key = `${cell.row},${cell.col}`;
      const existing = state.board.get(key);
      if (existing && existing.letter !== cell.letter) {
        return { ok: false, overlapCount: 0 };
      }
      if (existing && existing.letter === cell.letter) {
        overlapCount += 1;
      } else {
        transientLetters.set(key, cell.letter);
      }
    }

    if (options.strictCrossChecks) {
      const first = cells[0];
      const last = cells[cells.length - 1];
      if (placement.direction === "across") {
        if (readBoardLetter(state, transientLetters, first.row, first.col - 1)) {
          return { ok: false, overlapCount: 0 };
        }
        if (readBoardLetter(state, transientLetters, last.row, last.col + 1)) {
          return { ok: false, overlapCount: 0 };
        }
      } else {
        if (readBoardLetter(state, transientLetters, first.row - 1, first.col)) {
          return { ok: false, overlapCount: 0 };
        }
        if (readBoardLetter(state, transientLetters, last.row + 1, last.col)) {
          return { ok: false, overlapCount: 0 };
        }
      }

      for (const cell of cells) {
        const key = `${cell.row},${cell.col}`;
        const existing = state.board.get(key);
        if (existing) {
          continue;
        }

        const crossWord =
          placement.direction === "across"
            ? collectLineWord(state, transientLetters, cell.row, cell.col, 1, 0)
            : collectLineWord(state, transientLetters, cell.row, cell.col, 0, 1);

        if (crossWord.length > 1 && !allowedWordSet.has(crossWord)) {
          return { ok: false, overlapCount: 0 };
        }
      }
    }

    return { ok: true, overlapCount };
  }

  function placeWord(state, placement, overlapCount) {
    const cells = getCellsForPlacement(placement);
    for (const cell of cells) {
      const key = `${cell.row},${cell.col}`;
      const existing = state.board.get(key);
      if (!existing) {
        state.board.set(key, { letter: cell.letter, words: [placement.word] });
      } else if (!existing.words.includes(placement.word)) {
        existing.words.push(placement.word);
      }
    }

    state.placements.push(placement);
    state.placementByWord.set(placement.word, placement);
    state.overlapCount += overlapCount;
    setBBoxFromPlacement(state.bbox, placement);
  }

  function computeIntersections(state) {
    const adjacency = new Map();
    for (const placement of state.placements) {
      adjacency.set(placement.word, new Set());
    }

    for (const [, value] of state.board) {
      if (value.words.length < 2) {
        continue;
      }
      for (let i = 0; i < value.words.length; i += 1) {
        for (let j = i + 1; j < value.words.length; j += 1) {
          adjacency.get(value.words[i]).add(value.words[j]);
          adjacency.get(value.words[j]).add(value.words[i]);
        }
      }
    }

    return adjacency;
  }

  function computeHopDistances(adjacency, words) {
    const distances = new Map();
    const paths = new Map();

    function bfsFrom(start) {
      const queue = [start];
      const seen = new Set([start]);
      const parent = new Map();
      const dist = new Map([[start, 0]]);

      while (queue.length > 0) {
        const current = queue.shift();
        const neighbors = adjacency.get(current) || new Set();
        for (const next of neighbors) {
          if (seen.has(next)) {
            continue;
          }
          seen.add(next);
          parent.set(next, current);
          dist.set(next, dist.get(current) + 1);
          queue.push(next);
        }
      }

      for (const target of words) {
        if (target === start) {
          continue;
        }
        const key = makePairKey(start, target);
        if (!dist.has(target)) {
          distances.set(key, Infinity);
          continue;
        }

        distances.set(key, dist.get(target));

        const path = [target];
        let walker = target;
        while (walker !== start) {
          walker = parent.get(walker);
          path.push(walker);
        }
        path.reverse();
        paths.set(key, path);
      }
    }

    for (const word of words) {
      bfsFrom(word);
    }

    return { distances, paths };
  }

  function countComponents(adjacency, words) {
    const seen = new Set();
    let components = 0;

    for (const word of words) {
      if (seen.has(word)) {
        continue;
      }
      components += 1;
      const stack = [word];
      seen.add(word);
      while (stack.length > 0) {
        const current = stack.pop();
        const neighbors = adjacency.get(current) || new Set();
        for (const next of neighbors) {
          if (!seen.has(next)) {
            seen.add(next);
            stack.push(next);
          }
        }
      }
    }

    return components;
  }

  function computeGlobalScore(state, words, relationIndex) {
    const adjacency = computeIntersections(state);
    const { distances, paths } = computeHopDistances(adjacency, words);
    const components = countComponents(adjacency, words);
    let score = state.overlapCount * 22;

    const prefReports = [];
    for (const pref of relationIndex.byPair.values()) {
      const key = makePairKey(pref.a, pref.b);
      const dist = distances.get(key);
      const hop = Number.isFinite(dist) ? dist : Infinity;
      const directTouch = hop === 1;
      const pA = state.placementByWord.get(pref.a);
      const pB = state.placementByWord.get(pref.b);
      const centerDist = centerDistance(getPlacementCenter(pA), getPlacementCenter(pB));
      const hasLetterOverlap = relationIndex.overlapByPair.get(key);
      const stitchedPath = paths.get(key) || null;
      const viaSatisfied =
        !pref.via ||
        pref.via.length === 0 ||
        (stitchedPath && pref.via.every((viaWord) => stitchedPath.includes(viaWord)));

      let delta = 0;
      if (pref.type === "mustTouch") {
        if (directTouch) {
          delta += 260 * pref.weight;
        } else if (hasLetterOverlap) {
          delta -= (240 + centerDist * 2) * pref.weight;
        } else if (Number.isFinite(hop)) {
          // Impossible direct touch: reward a short stitched path.
          delta += (120 / Math.max(1, hop) - centerDist * 1.25) * pref.weight;
        } else {
          delta -= (220 + centerDist * 2) * pref.weight;
        }
      } else if (pref.type === "preferTouch") {
        if (directTouch) {
          delta += 120 * pref.weight;
        } else if (Number.isFinite(hop)) {
          delta += (45 / hop - centerDist * 0.75) * pref.weight;
        } else {
          delta -= (80 + centerDist) * pref.weight;
        }
      } else if (pref.type === "preferConnected") {
        if (Number.isFinite(hop)) {
          delta += (140 / hop - centerDist * 0.4) * pref.weight;
        } else {
          delta -= (130 + centerDist * 0.8) * pref.weight;
        }
      } else {
        // preferNear
        const nearBonus = Math.max(0, 70 - centerDist * 3);
        delta += nearBonus * pref.weight;
        if (Number.isFinite(hop)) {
          delta += (22 / hop) * pref.weight;
        }
      }

      if (pref.via && pref.via.length > 0) {
        if (viaSatisfied) {
          delta += 180 * pref.weight;
        } else if (Number.isFinite(hop) && hop <= pref.via.length + 2) {
          delta -= 60 * pref.weight;
        } else {
          delta -= 220 * pref.weight;
        }
      }

      score += delta;
      prefReports.push({
        a: pref.a,
        b: pref.b,
        type: pref.type,
        weight: pref.weight,
        directTouch,
        hopDistance: hop,
        centerDistance: Number(centerDist.toFixed(2)),
        stitchedPath,
        via: pref.via || [],
        viaSatisfied,
      });
    }

    score -= Math.max(0, components - 1) * 70;
    score -= (state.bbox.maxRow - state.bbox.minRow + state.bbox.maxCol - state.bbox.minCol) * 0.15;

    return {
      score,
      overlapCount: state.overlapCount,
      components,
      preferenceReports: prefReports,
      adjacency,
    };
  }

  function dedupeCandidates(candidates) {
    const seen = new Set();
    const out = [];
    for (const candidate of candidates) {
      const key = `${candidate.row}|${candidate.col}|${candidate.direction}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(candidate);
    }
    return out;
  }

  function getBoundingBoxFallbackCandidates(state, wordLength, rng) {
    const candidates = [];
    const pad = 2;
    const minRow = state.bbox.minRow - pad;
    const maxRow = state.bbox.maxRow + pad;
    const minCol = state.bbox.minCol - pad;
    const maxCol = state.bbox.maxCol + pad;

    for (let col = minCol; col <= maxCol; col += 1) {
      candidates.push({ row: minRow, col, direction: "across" });
      candidates.push({ row: maxRow, col, direction: "across" });
    }
    for (let row = minRow; row <= maxRow; row += 1) {
      candidates.push({ row, col: minCol, direction: "down" });
      candidates.push({ row, col: maxCol, direction: "down" });
    }

    // Add random nudges to help break local plateaus.
    for (let i = 0; i < 18; i += 1) {
      candidates.push({
        row: Math.round((rng() - 0.5) * (wordLength + 10)),
        col: Math.round((rng() - 0.5) * (wordLength + 10)),
        direction: rng() > 0.5 ? "across" : "down",
      });
    }

    return dedupeCandidates(candidates);
  }

  function getPreferredNeighbors(word, state, relationIndex) {
    const relations = relationIndex.byWord.get(word) || [];
    const neighbors = [];
    for (const rel of relations) {
      const other = rel.a === word ? rel.b : rel.a;
      const placement = state.placementByWord.get(other);
      if (!placement) {
        continue;
      }
      neighbors.push({ rel, placement });
    }
    return neighbors;
  }

  function getNearCandidates(word, state, relationIndex) {
    const candidates = [];
    const neighbors = getPreferredNeighbors(word, state, relationIndex);

    for (const neighbor of neighbors) {
      const anchor = getPlacementCenter(neighbor.placement);
      for (const direction of ["across", "down"]) {
        for (let delta = -3; delta <= 3; delta += 1) {
          const centeredCol = Math.round(anchor.col - (direction === "across" ? word.length / 2 : 0));
          const centeredRow = Math.round(anchor.row - (direction === "down" ? word.length / 2 : 0));
          candidates.push({
            row: centeredRow + (direction === "across" ? delta : 0),
            col: centeredCol + (direction === "down" ? delta : 0),
            direction,
          });
        }
      }
    }

    return dedupeCandidates(candidates);
  }

  function getCrossCandidates(word, state) {
    const candidates = [];
    for (const placed of state.placements) {
      for (let i = 0; i < word.length; i += 1) {
        for (let j = 0; j < placed.word.length; j += 1) {
          if (word[i] !== placed.word[j]) {
            continue;
          }

          if (placed.direction === "across") {
            candidates.push({
              row: placed.row - i,
              col: placed.col + j,
              direction: "down",
            });
          } else {
            candidates.push({
              row: placed.row + j,
              col: placed.col - i,
              direction: "across",
            });
          }
        }
      }
    }

    return dedupeCandidates(candidates);
  }

  function scoreCandidate(word, candidate, state, relationIndex, overlapCount) {
    let score = overlapCount * 42;

    if (state.placements.length > 0 && overlapCount === 0) {
      score -= 40;
    }

    const predictedPlacement = {
      word,
      row: candidate.row,
      col: candidate.col,
      direction: candidate.direction,
    };
    const center = getPlacementCenter(predictedPlacement);

    const neighbors = getPreferredNeighbors(word, state, relationIndex);
    for (const neighbor of neighbors) {
      const otherCenter = getPlacementCenter(neighbor.placement);
      const dist = centerDistance(center, otherCenter);
      const rel = neighbor.rel;
      if (rel.type === "mustTouch") {
        score -= dist * 3.2 * rel.weight;
      } else if (rel.type === "preferTouch") {
        score -= dist * 1.9 * rel.weight;
      } else if (rel.type === "preferConnected") {
        score -= dist * 1.5 * rel.weight;
      } else {
        score -= dist * 1.2 * rel.weight;
      }
    }

    const relations = relationIndex.byWord.get(word) || [];
    for (const rel of relations) {
      if (!rel.via || !rel.via.includes(word)) {
        continue;
      }
      const anchorA = state.placementByWord.get(rel.a);
      const anchorB = state.placementByWord.get(rel.b);
      if (!anchorA || !anchorB) {
        continue;
      }
      const distA = centerDistance(center, getPlacementCenter(anchorA));
      const distB = centerDistance(center, getPlacementCenter(anchorB));
      score -= (distA + distB) * 2.8 * rel.weight;
    }

    score -= (Math.abs(center.row) + Math.abs(center.col)) * 0.08;
    return score;
  }

  function choosePlacementForWord(word, state, relationIndex, rng, randomTopChoices, allowedWordSet, options) {
    const requireConnected = options.requireConnected !== false;
    let rawCandidates = [];
    rawCandidates = rawCandidates.concat(getCrossCandidates(word, state));
    rawCandidates = rawCandidates.concat(getNearCandidates(word, state, relationIndex));
    if (!requireConnected || state.placements.length === 0) {
      rawCandidates = rawCandidates.concat(getBoundingBoxFallbackCandidates(state, word.length, rng));
    }

    if (state.placements.length === 0) {
      return { word, row: 0, col: 0, direction: "across" };
    }

    const scored = [];
    for (const candidate of dedupeCandidates(rawCandidates)) {
      const placement = {
        word,
        row: candidate.row,
        col: candidate.col,
        direction: candidate.direction,
      };
      const check = canPlaceWord(state, placement, allowedWordSet, options);
      if (!check.ok) {
        continue;
      }

      scored.push({
        placement,
        score: scoreCandidate(word, candidate, state, relationIndex, check.overlapCount),
        overlapCount: check.overlapCount,
      });
    }

    if (scored.length === 0) {
      if (requireConnected && state.placements.length > 0) {
        return null;
      }
      return { word, row: 0, col: 0, direction: "across" };
    }

    let rankingPool = scored;
    if (state.placements.length > 0) {
      const overlapOnly = scored.filter((candidate) => candidate.overlapCount > 0);
      if (requireConnected) {
        if (overlapOnly.length === 0) {
          return null;
        }
        rankingPool = overlapOnly;
      } else if (overlapOnly.length > 0) {
        rankingPool = overlapOnly;
      }
    }

    rankingPool.sort((a, b) => b.score - a.score);
    const bucket = rankingPool.slice(0, Math.max(1, randomTopChoices));
    const chosen = bucket[Math.floor(rng() * bucket.length)] || rankingPool[0] || scored[0];
    chosen.placement._overlapCount = chosen.overlapCount;
    return chosen.placement;
  }

  function buildBoard(state) {
    const minRow = state.bbox.minRow;
    const maxRow = state.bbox.maxRow;
    const minCol = state.bbox.minCol;
    const maxCol = state.bbox.maxCol;

    const rows = [];
    for (let r = minRow; r <= maxRow; r += 1) {
      const row = [];
      for (let c = minCol; c <= maxCol; c += 1) {
        const cell = state.board.get(`${r},${c}`);
        row.push(cell ? cell.letter : "");
      }
      rows.push(row);
    }

    return {
      minRow,
      maxRow,
      minCol,
      maxCol,
      rows,
    };
  }

  function runSingleAttempt(words, relationIndex, options, seedOffset) {
    const rng = createSeededRandom((options.randomSeed + seedOffset * 9973) >>> 0);
    const state = createState();
    const orderedWords = computeWordOrder(words, relationIndex, rng);
    const randomTopChoices = options.randomTopChoices;
    const allowedWordSet = new Set(words);

    for (const word of orderedWords) {
      const placement = choosePlacementForWord(word, state, relationIndex, rng, randomTopChoices, allowedWordSet, options);
      if (!placement) {
        continue;
      }
      const check = canPlaceWord(state, placement, allowedWordSet, options);
      if (!check.ok) {
        continue;
      }
      placeWord(state, placement, Number.isFinite(placement._overlapCount) ? placement._overlapCount : check.overlapCount);
    }

    const metrics = computeGlobalScore(state, orderedWords, relationIndex);
    metrics.placementCount = state.placements.length;

    return {
      state,
      orderedWords,
      metrics,
    };
  }

  function sanitizeWords(words) {
    const out = [];
    const seen = new Set();
    for (const raw of words || []) {
      const normalized = normalizeWord(raw);
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  }

  function summarizeConstraints(preferenceReports, components, placementCount, wordCount) {
    const reports = preferenceReports || [];
    const mustTouch = reports.filter((report) => report.type === "mustTouch");
    const bridges = reports.filter((report) => report.via && report.via.length > 0);

    const mustTouchSatisfied = mustTouch.filter((report) => report.directTouch).length;
    const bridgeSatisfied = bridges.filter((report) => report.viaSatisfied).length;

    const allMustTouch = mustTouch.length === 0 || mustTouchSatisfied === mustTouch.length;
    const allBridges = bridges.length === 0 || bridgeSatisfied === bridges.length;
    const allConnected = !Number.isFinite(components) || components === 1;
    const allPlaced =
      !Number.isFinite(placementCount) ||
      !Number.isFinite(wordCount) ||
      wordCount === 0 ||
      placementCount === wordCount;

    return {
      mustTouchTotal: mustTouch.length,
      mustTouchSatisfied,
      bridgeTotal: bridges.length,
      bridgeSatisfied,
      allMustTouch,
      allBridges,
      allConnected,
      allPlaced,
      allSatisfied: allMustTouch && allBridges && allConnected && allPlaced,
    };
  }

  function layoutQualityRank(metrics) {
    const summary = summarizeConstraints(
      metrics.preferenceReports,
      metrics.components,
      metrics.placementCount,
      metrics.wordCount
    );
    const satisfiedPairs = summary.mustTouchSatisfied + summary.bridgeSatisfied;
    const connectedTier = metrics.components === 1 ? 10_000_000 : 0;
    const placedTier = (metrics.placementCount || 0) * 10_000;
    // Prefer one connected board, then constraint satisfaction, then score.
    const rank =
      connectedTier +
      placedTier +
      satisfiedPairs * 1_000_000 +
      (summary.allSatisfied ? 500_000 : 0) +
      metrics.score;
    return rank;
  }

  function buildScrabbleCollage(rawWords, rawOptions) {
    const options = { ...DEFAULT_OPTIONS, ...(rawOptions || {}) };
    const words = sanitizeWords(rawWords);
    if (words.length === 0) {
      return {
        placements: [],
        board: { rows: [], minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 },
        metrics: {
          score: 0,
          overlapCount: 0,
          components: 0,
          preferenceReports: [],
          constraints: summarizeConstraints([]),
        },
      };
    }

    const wordSet = new Set(words);
    const preferences = parsePreferences(options.preferences || [], wordSet);
    const relationIndex = buildRelationIndex(words, preferences);

    let best = null;
    let bestRank = -Infinity;
    for (let i = 0; i < options.maxAttempts; i += 1) {
      const attempt = runSingleAttempt(words, relationIndex, options, i + 1);
      attempt.metrics.wordCount = words.length;
      const rank = layoutQualityRank(attempt.metrics);
      if (!best || rank > bestRank) {
        best = attempt;
        bestRank = rank;
      }
    }

    const placements = best.state.placements.map((placement) => ({
      word: placement.word,
      row: placement.row,
      col: placement.col,
      direction: placement.direction,
    }));

    placements.sort((a, b) => a.word.localeCompare(b.word));

    const constraints = summarizeConstraints(
      best.metrics.preferenceReports,
      best.metrics.components,
      best.state.placements.length,
      words.length
    );

    return {
      placements,
      board: buildBoard(best.state),
      metrics: {
        score: Number(best.metrics.score.toFixed(2)),
        overlapCount: best.metrics.overlapCount,
        components: best.metrics.components,
        preferenceReports: best.metrics.preferenceReports,
        constraints,
      },
    };
  }

  function searchBestCollage(rawWords, rawOptions) {
    const options = { ...DEFAULT_OPTIONS, ...(rawOptions || {}) };
    const words = sanitizeWords(rawWords);
    const seedCount = Math.max(1, Number(options.seedCount) || 80);
    const seedStart = Number(options.randomSeed) || Date.now();
    const stopWhenSatisfied = options.stopWhenSatisfied !== false;
    const stopAfterSatisfied = Math.max(0, Number(options.stopAfterSatisfied) || 12);

    let bestResult = null;
    let bestRank = -Infinity;
    let bestSeed = seedStart;
    let seedsTried = 0;
    let satisfiedStreak = 0;

    for (let i = 0; i < seedCount; i += 1) {
      const seed = (seedStart + i) >>> 0;
      const result = buildScrabbleCollage(rawWords, {
        ...options,
        randomSeed: seed,
      });
      seedsTried += 1;

      const rank = layoutQualityRank({
        score: result.metrics.score,
        preferenceReports: result.metrics.preferenceReports,
        components: result.metrics.components,
        placementCount: result.placements.length,
        wordCount: words.length,
      });

      if (!bestResult || rank > bestRank) {
        bestResult = result;
        bestRank = rank;
        bestSeed = seed;
      }

      if (result.metrics.constraints.allSatisfied && result.metrics.components === 1) {
        satisfiedStreak += 1;
        if (stopWhenSatisfied && satisfiedStreak >= stopAfterSatisfied) {
          break;
        }
      } else {
        satisfiedStreak = 0;
      }
    }

    return {
      ...bestResult,
      search: {
        seedsTried,
        seedCount,
        bestSeed,
        allSatisfied: Boolean(bestResult && bestResult.metrics.constraints.allSatisfied),
      },
    };
  }

  function materializeFromPlacements(rawWords, placements, rawOptions) {
    const options = { ...DEFAULT_OPTIONS, ...(rawOptions || {}) };
    const words = sanitizeWords(rawWords);
    if (words.length === 0 || !placements || placements.length === 0) {
      return {
        placements: [],
        board: { rows: [], minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 },
        metrics: {
          score: 0,
          overlapCount: 0,
          components: 0,
          preferenceReports: [],
          constraints: summarizeConstraints([]),
        },
      };
    }

    const wordSet = new Set(words);
    const preferences = parsePreferences(options.preferences || [], wordSet);
    const relationIndex = buildRelationIndex(words, preferences);
    const allowedWordSet = new Set(words);
    const state = createState();

    for (const raw of placements) {
      const word = normalizeWord(raw.word);
      if (!wordSet.has(word)) {
        continue;
      }
      const placement = {
        word,
        row: Number(raw.row) || 0,
        col: Number(raw.col) || 0,
        direction: raw.direction === "down" ? "down" : "across",
      };
      const check = canPlaceWord(state, placement, allowedWordSet, options);
      if (!check.ok) {
        // Skip any placement that does not validate; the wrapper falls
        // back to the heuristic when this happens for the CP path.
        continue;
      }
      placeWord(state, placement, check.overlapCount);
    }

    const metrics = computeGlobalScore(state, words, relationIndex);
    metrics.placementCount = state.placements.length;
    const constraints = summarizeConstraints(
      metrics.preferenceReports,
      metrics.components,
      metrics.placementCount,
      words.length
    );
    const sortedPlacements = state.placements
      .map((p) => ({ word: p.word, row: p.row, col: p.col, direction: p.direction }))
      .sort((a, b) => a.word.localeCompare(b.word));

    return {
      placements: sortedPlacements,
      board: buildBoard(state),
      metrics: {
        score: Number(metrics.score.toFixed(2)),
        overlapCount: metrics.overlapCount,
        components: metrics.components,
        preferenceReports: metrics.preferenceReports,
        constraints,
      },
    };
  }

  function getCpSolver(rawOptions) {
    const options = rawOptions || {};
    if (options.cpSolver && typeof options.cpSolver.solveCollage === "function") {
      return options.cpSolver;
    }
    if (typeof globalScope !== "undefined" && globalScope && globalScope.ScrabbleCollageCP) {
      return globalScope.ScrabbleCollageCP;
    }
    if (typeof require !== "undefined") {
      try {
        // eslint-disable-next-line global-require
        return require("./cp-solver");
      } catch (err) {
        // CP module not bundled; fall back silently.
      }
    }
    return null;
  }

  function solveBestCollage(rawWords, rawOptions) {
    const options = { ...(rawOptions || {}) };
    const words = sanitizeWords(rawWords);
    if (words.length === 0) {
      const empty = buildScrabbleCollage(rawWords, rawOptions);
      empty.solver = { engine: "none", optimal: false, status: "empty" };
      return empty;
    }

    const cp = getCpSolver(options);
    if (cp) {
      const cpResult = cp.solveCollage(rawWords, options);
      if (cpResult && cpResult.placements && cpResult.placements.length > 0) {
        const materialized = materializeFromPlacements(rawWords, cpResult.placements, options);
        const everyWordPlaced = materialized.placements.length === words.length;
        if (everyWordPlaced) {
          materialized.solver = {
            engine: "cp",
            optimal: Boolean(cpResult.optimal),
            status: cpResult.status,
            stats: cpResult.stats || null,
          };
          return materialized;
        }
      }
    }

    const fallback = options.fallbackSearch !== false
      ? searchBestCollage(rawWords, rawOptions)
      : buildScrabbleCollage(rawWords, rawOptions);
    fallback.solver = {
      engine: "heuristic",
      optimal: false,
      status: cp ? "cp-incomplete" : "cp-unavailable",
    };
    return fallback;
  }

  function parsePairLines(text, defaultType) {
    const pairs = [];
    for (const line of String(text || "").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const tokens = trimmed.split(/[,\-:>]+/).map((token) => token.trim()).filter(Boolean);
      if (tokens.length < 2) {
        continue;
      }
      const [a, b, maybeType, maybeVia] = tokens;
      pairs.push({
        a,
        b,
        type: maybeType || defaultType,
        via: maybeVia ? maybeVia.split("|").map((part) => part.trim()).filter(Boolean) : [],
      });
    }
    return pairs;
  }

  const publicApi = {
    buildScrabbleCollage,
    searchBestCollage,
    solveBestCollage,
    materializeFromPlacements,
    summarizeConstraints,
    layoutQualityRank,
    parsePairLines,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = publicApi;
  }
  if (typeof globalScope !== "undefined") {
    globalScope.ScrabbleCollage = publicApi;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
