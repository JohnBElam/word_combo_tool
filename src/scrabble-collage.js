/* eslint-disable no-undef */
(function setupScrabbleCollage(globalScope) {
  "use strict";

  const DEFAULT_OPTIONS = {
    maxAttempts: 140,
    randomSeed: Date.now(),
    randomTopChoices: 4,
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

  function canPlaceWord(state, placement) {
    let overlapCount = 0;
    const cells = getCellsForPlacement(placement);
    for (const cell of cells) {
      const key = `${cell.row},${cell.col}`;
      const existing = state.board.get(key);
      if (existing && existing.letter !== cell.letter) {
        return { ok: false, overlapCount: 0 };
      }
      if (existing && existing.letter === cell.letter) {
        overlapCount += 1;
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
          delta += 85 * pref.weight;
        } else {
          delta -= 110 * pref.weight;
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

    score -= (Math.abs(center.row) + Math.abs(center.col)) * 0.08;
    return score;
  }

  function choosePlacementForWord(word, state, relationIndex, rng, randomTopChoices) {
    let rawCandidates = [];
    rawCandidates = rawCandidates.concat(getCrossCandidates(word, state));
    rawCandidates = rawCandidates.concat(getNearCandidates(word, state, relationIndex));
    rawCandidates = rawCandidates.concat(getBoundingBoxFallbackCandidates(state, word.length, rng));

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
      const check = canPlaceWord(state, placement);
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
      // This should be rare, but keeps the algorithm moving.
      const emergency = { word, row: 0, col: 0, direction: "across" };
      return emergency;
    }

    scored.sort((a, b) => b.score - a.score);
    const bucket = scored.slice(0, Math.max(1, randomTopChoices));
    const chosen = bucket[Math.floor(rng() * bucket.length)] || scored[0];
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

    for (const word of orderedWords) {
      const placement = choosePlacementForWord(word, state, relationIndex, rng, randomTopChoices);
      const check = canPlaceWord(state, placement);
      if (!check.ok) {
        continue;
      }
      placeWord(state, placement, Number.isFinite(placement._overlapCount) ? placement._overlapCount : check.overlapCount);
    }

    return {
      state,
      orderedWords,
      metrics: computeGlobalScore(state, orderedWords, relationIndex),
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
        },
      };
    }

    const wordSet = new Set(words);
    const preferences = parsePreferences(options.preferences || [], wordSet);
    const relationIndex = buildRelationIndex(words, preferences);

    let best = null;
    for (let i = 0; i < options.maxAttempts; i += 1) {
      const attempt = runSingleAttempt(words, relationIndex, options, i + 1);
      if (!best || attempt.metrics.score > best.metrics.score) {
        best = attempt;
      }
    }

    const placements = best.state.placements.map((placement) => ({
      word: placement.word,
      row: placement.row,
      col: placement.col,
      direction: placement.direction,
    }));

    placements.sort((a, b) => a.word.localeCompare(b.word));

    return {
      placements,
      board: buildBoard(best.state),
      metrics: {
        score: Number(best.metrics.score.toFixed(2)),
        overlapCount: best.metrics.overlapCount,
        components: best.metrics.components,
        preferenceReports: best.metrics.preferenceReports,
      },
    };
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
    parsePairLines,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = publicApi;
  }
  if (typeof globalScope !== "undefined") {
    globalScope.ScrabbleCollage = publicApi;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
