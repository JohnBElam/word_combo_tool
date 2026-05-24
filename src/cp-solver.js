/* eslint-disable no-undef */
(function setupScrabbleCollageCp(globalScope) {
  "use strict";

  const DEFAULT_OPTIONS = {
    strictCrossChecks: true,
    requireConnected: true,
    feasibilityNodeBudget: 200000,
    feasibilityTimeBudget: 1500,
    optimizationNodeBudget: 200000,
    optimizationTimeBudget: 2500,
    yieldEvery: 0,
    onProgress: null,
  };

  // ===================================================================
  // Helpers
  // ===================================================================

  function normalizeWord(word) {
    return String(word || "")
      .trim()
      .replace(/\s+/g, "")
      .toUpperCase();
  }

  function sanitizeWords(words) {
    const out = [];
    const seen = new Set();
    for (const raw of words || []) {
      const n = normalizeWord(raw);
      if (n && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out;
  }

  function makePairKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  function getCellsForPlacement(placement) {
    const cells = [];
    for (let i = 0; i < placement.word.length; i += 1) {
      cells.push({
        row: placement.row + (placement.direction === "down" ? i : 0),
        col: placement.col + (placement.direction === "across" ? i : 0),
        letter: placement.word[i],
        index: i,
      });
    }
    return cells;
  }

  function placementsShareCell(pA, pB) {
    if (!pA || !pB) {
      return false;
    }
    const cellsA = getCellsForPlacement(pA);
    const cellsB = getCellsForPlacement(pB);
    const lookupB = new Map();
    for (const cell of cellsB) {
      lookupB.set(`${cell.row},${cell.col}`, cell.letter);
    }
    for (const cell of cellsA) {
      if (lookupB.get(`${cell.row},${cell.col}`) === cell.letter) {
        return true;
      }
    }
    return false;
  }

  // ===================================================================
  // Model construction
  //
  // We split the soft preferences from scrabble-collage.js into hard
  // constraints (mustTouch direct + via-chain) and soft hints. CP only
  // enforces the hard ones; the soft hints come back into play when the
  // wrapper recomputes the user-facing metrics.
  // ===================================================================

  function parsePreferences(rawPrefs, wordSet) {
    const mustTouchPairs = [];
    const viaChains = [];
    const seenMustTouch = new Set();
    const seenChain = new Set();

    for (const pref of rawPrefs || []) {
      if (!pref || !pref.a || !pref.b) {
        continue;
      }
      const a = normalizeWord(pref.a);
      const b = normalizeWord(pref.b);
      if (!a || !b || a === b || !wordSet.has(a) || !wordSet.has(b)) {
        continue;
      }

      const rawVia = Array.isArray(pref.via) ? pref.via : pref.via ? [pref.via] : [];
      const via = [];
      for (const v of rawVia) {
        const nv = normalizeWord(v);
        if (!nv || nv === a || nv === b || !wordSet.has(nv) || via.includes(nv)) {
          continue;
        }
        via.push(nv);
      }

      const type = String(pref.type || "preferTouch");

      if (via.length > 0) {
        const chainWords = [a, ...via, b];
        const chainKey = chainWords.join(">");
        const reverseKey = chainWords.slice().reverse().join(">");
        if (!seenChain.has(chainKey) && !seenChain.has(reverseKey)) {
          seenChain.add(chainKey);
          viaChains.push({ a, b, via, chainWords });
        }
      } else if (type === "mustTouch") {
        const k = makePairKey(a, b);
        if (!seenMustTouch.has(k)) {
          seenMustTouch.add(k);
          mustTouchPairs.push({ a, b });
        }
      }
    }

    return { mustTouchPairs, viaChains };
  }

  function relationDegree(word, hardConstraints) {
    let deg = 0;
    for (const pair of hardConstraints.mustTouchPairs) {
      if (pair.a === word || pair.b === word) {
        deg += 5;
      }
    }
    for (const chain of hardConstraints.viaChains) {
      for (const cw of chain.chainWords) {
        if (cw === word) {
          deg += 3;
          break;
        }
      }
    }
    return deg;
  }

  // ===================================================================
  // Board state (mutated in place during backtracking, with undo records)
  // ===================================================================

  function createState() {
    return {
      board: new Map(),
      placements: [],
      placementByWord: new Map(),
      bbox: { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 },
      overlapCount: 0,
    };
  }

  function readBoardLetter(state, transientLetters, row, col) {
    const key = `${row},${col}`;
    if (transientLetters && transientLetters.has(key)) {
      return transientLetters.get(key);
    }
    const e = state.board.get(key);
    return e ? e.letter : "";
  }

  function collectLineWord(state, transientLetters, row, col, rowStep, colStep) {
    let r = row;
    let c = col;
    while (readBoardLetter(state, transientLetters, r - rowStep, c - colStep)) {
      r -= rowStep;
      c -= colStep;
    }
    const out = [];
    while (true) {
      const ltr = readBoardLetter(state, transientLetters, r, c);
      if (!ltr) {
        break;
      }
      out.push(ltr);
      r += rowStep;
      c += colStep;
    }
    return out.join("");
  }

  function tryPlacementOnBoard(state, placement, allowedWordSet, strictCrossChecks) {
    let overlapCount = 0;
    const cells = getCellsForPlacement(placement);
    const transientLetters = new Map();
    const newCells = [];

    for (const cell of cells) {
      const key = `${cell.row},${cell.col}`;
      const existing = state.board.get(key);
      if (existing && existing.letter !== cell.letter) {
        return { ok: false };
      }
      if (existing) {
        overlapCount += 1;
      } else {
        transientLetters.set(key, cell.letter);
        newCells.push(cell);
      }
    }

    if (strictCrossChecks) {
      const first = cells[0];
      const last = cells[cells.length - 1];
      if (placement.direction === "across") {
        if (readBoardLetter(state, transientLetters, first.row, first.col - 1)) {
          return { ok: false };
        }
        if (readBoardLetter(state, transientLetters, last.row, last.col + 1)) {
          return { ok: false };
        }
      } else {
        if (readBoardLetter(state, transientLetters, first.row - 1, first.col)) {
          return { ok: false };
        }
        if (readBoardLetter(state, transientLetters, last.row + 1, last.col)) {
          return { ok: false };
        }
      }

      for (const cell of newCells) {
        const crossWord = placement.direction === "across"
          ? collectLineWord(state, transientLetters, cell.row, cell.col, 1, 0)
          : collectLineWord(state, transientLetters, cell.row, cell.col, 0, 1);
        if (crossWord.length > 1 && !allowedWordSet.has(crossWord)) {
          return { ok: false };
        }
      }
    }

    return { ok: true, overlapCount };
  }

  function applyPlacement(state, placement, overlapCount) {
    const cells = getCellsForPlacement(placement);
    const undo = {
      placement,
      addedKeys: [],
      sharedKeys: [],
      prevBBox: { ...state.bbox },
      prevOverlapCount: state.overlapCount,
      prevPlacementsLength: state.placements.length,
    };

    for (const cell of cells) {
      const key = `${cell.row},${cell.col}`;
      const existing = state.board.get(key);
      if (!existing) {
        state.board.set(key, { letter: cell.letter, words: [placement.word] });
        undo.addedKeys.push(key);
      } else if (!existing.words.includes(placement.word)) {
        existing.words.push(placement.word);
        undo.sharedKeys.push(key);
      }
    }

    state.placements.push(placement);
    state.placementByWord.set(placement.word, placement);
    state.overlapCount += overlapCount;

    if (state.placements.length === 1) {
      state.bbox = {
        minRow: Infinity,
        maxRow: -Infinity,
        minCol: Infinity,
        maxCol: -Infinity,
      };
    }
    for (const cell of cells) {
      if (cell.row < state.bbox.minRow) state.bbox.minRow = cell.row;
      if (cell.row > state.bbox.maxRow) state.bbox.maxRow = cell.row;
      if (cell.col < state.bbox.minCol) state.bbox.minCol = cell.col;
      if (cell.col > state.bbox.maxCol) state.bbox.maxCol = cell.col;
    }

    return undo;
  }

  function undoPlacement(state, undo) {
    for (const key of undo.addedKeys) {
      state.board.delete(key);
    }
    for (const key of undo.sharedKeys) {
      const cell = state.board.get(key);
      if (cell) {
        cell.words = cell.words.filter((w) => w !== undo.placement.word);
      }
    }
    state.placements.length = undo.prevPlacementsLength;
    state.placementByWord.delete(undo.placement.word);
    state.overlapCount = undo.prevOverlapCount;
    state.bbox = undo.prevBBox;
  }

  // ===================================================================
  // Domain enumeration
  //
  // Lazy: at every node we recompute candidates against the current
  // partial board. For each placed word, generate placements that put a
  // letter of `word` on top of a matching letter of the placed word
  // (perpendicular orientation). Validate via tryPlacementOnBoard, which
  // also enforces strictCrossChecks.
  // ===================================================================

  function enumerateAnchoredPlacements(word, state, allowedWordSet, strictCrossChecks) {
    const out = [];
    const seen = new Set();

    if (state.placements.length === 0) {
      const placement = { word, row: 0, col: 0, direction: "across" };
      const check = tryPlacementOnBoard(state, placement, allowedWordSet, strictCrossChecks);
      if (check.ok) {
        out.push({
          placement,
          overlapCount: check.overlapCount,
          intersectsWords: new Set(),
        });
      }
      return out;
    }

    for (const placed of state.placements) {
      for (let i = 0; i < word.length; i += 1) {
        for (let j = 0; j < placed.word.length; j += 1) {
          if (word[i] !== placed.word[j]) {
            continue;
          }
          let row;
          let col;
          let direction;
          if (placed.direction === "across") {
            row = placed.row - i;
            col = placed.col + j;
            direction = "down";
          } else {
            row = placed.row + j;
            col = placed.col - i;
            direction = "across";
          }
          const key = `${row}|${col}|${direction}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);

          const placement = { word, row, col, direction };
          const check = tryPlacementOnBoard(state, placement, allowedWordSet, strictCrossChecks);
          if (!check.ok) {
            continue;
          }

          const intersectsWords = new Set();
          const cells = getCellsForPlacement(placement);
          for (const cell of cells) {
            const ckey = `${cell.row},${cell.col}`;
            const ex = state.board.get(ckey);
            if (ex) {
              for (const w of ex.words) {
                intersectsWords.add(w);
              }
            }
          }
          out.push({
            placement,
            overlapCount: check.overlapCount,
            intersectsWords,
          });
        }
      }
    }

    return out;
  }

  // ===================================================================
  // Forward checking + propagators
  //
  // After every commit we verify:
  //   * each unplaced word still has a non-empty domain (connectivity);
  //   * for every mustTouch (A, B) with one side placed, the other side
  //     has at least one candidate that shares a cell with the placed
  //     side, and if both are placed they actually share a cell;
  //   * for every via chain, each consecutive (W_i, W_{i+1}) link is
  //     still satisfiable (mirror of the mustTouch logic, applied to
  //     each pair in the ordered chain).
  // ===================================================================

  function forwardCheckAndDomains(state, unplaced, hardConstraints, allowedWordSet, options) {
    const allCands = new Map();
    let anyHasCandidates = state.placements.length === 0;
    for (const word of unplaced) {
      const cands = enumerateAnchoredPlacements(
        word,
        state,
        allowedWordSet,
        options.strictCrossChecks
      );
      allCands.set(word, cands);
      if (cands.length > 0) {
        anyHasCandidates = true;
      }
    }
    if (unplaced.length > 0 && !anyHasCandidates) {
      // Total deadlock: no unplaced word can attach anywhere.
      return null;
    }

    // Hard constraints: only fail when both endpoints are already placed
    // and the geometric check fails. While one side is unplaced, we defer
    // because a future placement may still produce an intersecting
    // candidate for it (anchored on a not-yet-placed bridge word). We
    // do, however, prune candidates of an unplaced endpoint to those
    // that still keep the constraint reachable when the other side is
    // already placed -- this is a sound forward-check subset.
    for (const pair of hardConstraints.mustTouchPairs) {
      if (!enforceFixedLink(state, pair.a, pair.b)) {
        return null;
      }
    }
    for (const chain of hardConstraints.viaChains) {
      for (let i = 0; i < chain.chainWords.length - 1; i += 1) {
        if (!enforceFixedLink(state, chain.chainWords[i], chain.chainWords[i + 1])) {
          return null;
        }
      }
    }

    return allCands;
  }

  function enforceFixedLink(state, wordA, wordB) {
    const aPlacement = state.placementByWord.get(wordA);
    const bPlacement = state.placementByWord.get(wordB);
    if (aPlacement && bPlacement) {
      return placementsShareCell(aPlacement, bPlacement);
    }
    // While at least one endpoint is unplaced, defer: a future
    // placement of a bridge word might give the unplaced endpoint a
    // brand new candidate that satisfies the link. The leaf check
    // catches any leftover violations.
    return true;
  }

  function isLeafFeasible(state, hardConstraints) {
    for (const pair of hardConstraints.mustTouchPairs) {
      const a = state.placementByWord.get(pair.a);
      const b = state.placementByWord.get(pair.b);
      if (!a || !b || !placementsShareCell(a, b)) {
        return false;
      }
    }
    for (const chain of hardConstraints.viaChains) {
      for (let i = 0; i < chain.chainWords.length - 1; i += 1) {
        const a = state.placementByWord.get(chain.chainWords[i]);
        const b = state.placementByWord.get(chain.chainWords[i + 1]);
        if (!a || !b || !placementsShareCell(a, b)) {
          return false;
        }
      }
    }
    return true;
  }

  function structurallyImpossible(words, hardConstraints) {
    const lettersByWord = new Map();
    for (const w of words) {
      lettersByWord.set(w, new Set(w.split("")));
    }
    function shareLetters(a, b) {
      const sa = lettersByWord.get(a);
      const sb = lettersByWord.get(b);
      if (!sa || !sb) return false;
      for (const ch of sa) {
        if (sb.has(ch)) return true;
      }
      return false;
    }
    for (const pair of hardConstraints.mustTouchPairs) {
      if (!shareLetters(pair.a, pair.b)) {
        return true;
      }
    }
    for (const chain of hardConstraints.viaChains) {
      for (let i = 0; i < chain.chainWords.length - 1; i += 1) {
        if (!shareLetters(chain.chainWords[i], chain.chainWords[i + 1])) {
          return true;
        }
      }
    }
    return false;
  }

  // ===================================================================
  // Variable + value ordering
  // ===================================================================

  function chooseNextWord(unplaced, state, hardConstraints, allCands) {
    if (state.placements.length === 0) {
      let best = null;
      let bestKey = -Infinity;
      for (const u of unplaced) {
        const deg = relationDegree(u, hardConstraints);
        const key = deg * 10000 + u.length;
        if (key > bestKey) {
          bestKey = key;
          best = u;
        }
      }
      return best;
    }

    let best = null;
    let bestKey = Infinity;
    for (const u of unplaced) {
      const cands = allCands.get(u) || [];
      // Skip words that have no anchored placement right now -- they
      // are deferred and will get candidates once another word in their
      // letter cluster is placed. If every unplaced word ends up with
      // no candidates we'll just backtrack from this node.
      if (cands.length === 0) {
        continue;
      }
      const deg = relationDegree(u, hardConstraints);
      const key = cands.length * 10000 - deg * 100 - u.length;
      if (key < bestKey) {
        bestKey = key;
        best = u;
      }
    }
    return best;
  }

  function bboxGrowthOfCandidate(state, cand) {
    const cells = getCellsForPlacement(cand.placement);
    if (state.placements.length === 0) {
      return cand.placement.word.length - 1;
    }
    let minR = state.bbox.minRow;
    let maxR = state.bbox.maxRow;
    let minC = state.bbox.minCol;
    let maxC = state.bbox.maxCol;
    for (const cell of cells) {
      if (cell.row < minR) minR = cell.row;
      if (cell.row > maxR) maxR = cell.row;
      if (cell.col < minC) minC = cell.col;
      if (cell.col > maxC) maxC = cell.col;
    }
    const before = (state.bbox.maxRow - state.bbox.minRow) + (state.bbox.maxCol - state.bbox.minCol);
    const after = (maxR - minR) + (maxC - minC);
    return after - before;
  }

  function orderCandidates(cands, state) {
    const decorated = cands.map((c) => ({
      cand: c,
      growth: bboxGrowthOfCandidate(state, c),
      links: c.intersectsWords ? c.intersectsWords.size : 0,
    }));
    decorated.sort((x, y) => {
      if (y.cand.overlapCount !== x.cand.overlapCount) {
        return y.cand.overlapCount - x.cand.overlapCount;
      }
      if (y.links !== x.links) {
        return y.links - x.links;
      }
      return x.growth - y.growth;
    });
    return decorated.map((d) => d.cand);
  }

  // ===================================================================
  // Snapshots + objective
  // ===================================================================

  function snapshotSolution(state) {
    const placements = state.placements.map((p) => ({
      word: p.word,
      row: p.row,
      col: p.col,
      direction: p.direction,
    }));
    return {
      placements,
      overlapCount: state.overlapCount,
      bbox: { ...state.bbox },
    };
  }

  function bboxPerimeter(bbox) {
    if (
      !Number.isFinite(bbox.minRow) ||
      !Number.isFinite(bbox.maxRow) ||
      !Number.isFinite(bbox.minCol) ||
      !Number.isFinite(bbox.maxCol)
    ) {
      return 0;
    }
    return (bbox.maxRow - bbox.minRow) + (bbox.maxCol - bbox.minCol);
  }

  function isStrictlyBetter(candidate, currentBest) {
    if (!currentBest) {
      return true;
    }
    if (candidate.overlapCount !== currentBest.overlapCount) {
      return candidate.overlapCount > currentBest.overlapCount;
    }
    return bboxPerimeter(candidate.bbox) < bboxPerimeter(currentBest.bbox);
  }

  // ===================================================================
  // Search core
  // ===================================================================

  function shouldStop(ctx) {
    if (ctx.aborted) {
      return true;
    }
    if (ctx.nodes >= ctx.nodeBudget) {
      ctx.timedOut = true;
      return true;
    }
    if ((ctx.nodes & 1023) === 0) {
      if (Date.now() - ctx.startTime > ctx.timeBudget) {
        ctx.timedOut = true;
        return true;
      }
    }
    return false;
  }

  function anchorWordOrder(unplaced, hardConstraints) {
    return unplaced.slice().sort((a, b) => {
      const da = relationDegree(a, hardConstraints);
      const db = relationDegree(b, hardConstraints);
      if (db !== da) {
        return db - da;
      }
      if (b.length !== a.length) {
        return b.length - a.length;
      }
      return a.localeCompare(b);
    });
  }

  function search(state, unplaced, ctx) {
    if (shouldStop(ctx)) {
      return;
    }
    ctx.nodes += 1;

    if (unplaced.length === 0) {
      // All words are placed; verify hard constraints. With deferred
      // forward checks some leaves may still violate a mustTouch /
      // via-chain link, in which case we silently reject.
      if (!isLeafFeasible(state, ctx.hardConstraints)) {
        return;
      }
      const snap = snapshotSolution(state);
      if (isStrictlyBetter(snap, ctx.bestSolution)) {
        ctx.bestSolution = snap;
        ctx.bestOverlap = snap.overlapCount;
        ctx.bestBBoxPerimeter = bboxPerimeter(snap.bbox);
        if (ctx.onProgress) {
          ctx.onProgress({
            phase: ctx.phase,
            event: "improved",
            overlap: snap.overlapCount,
            bboxPerimeter: ctx.bestBBoxPerimeter,
            nodes: ctx.nodes,
          });
        }
      }
      ctx.feasibilityFound = true;
      return;
    }

    // Root: branch on which word becomes the anchor at (0, 0, across).
    // Symmetry-breaking: every layout has a translation that puts some
    // word at the origin in across orientation, so we only need to try
    // one orientation per anchor word.
    if (state.placements.length === 0) {
      const order = anchorWordOrder(unplaced, ctx.hardConstraints);
      for (const word of order) {
        if (shouldStop(ctx)) {
          return;
        }
        if (ctx.phase === "feasibility" && ctx.feasibilityFound) {
          return;
        }
        const placement = { word, row: 0, col: 0, direction: "across" };
        const check = tryPlacementOnBoard(
          state,
          placement,
          ctx.allowedWordSet,
          ctx.options.strictCrossChecks
        );
        if (!check.ok) {
          continue;
        }
        const undo = applyPlacement(state, placement, check.overlapCount);
        const idx = unplaced.indexOf(word);
        unplaced.splice(idx, 1);
        search(state, unplaced, ctx);
        unplaced.splice(idx, 0, word);
        undoPlacement(state, undo);
      }
      return;
    }

    const allCands = forwardCheckAndDomains(
      state,
      unplaced,
      ctx.hardConstraints,
      ctx.allowedWordSet,
      ctx.options
    );
    if (!allCands) {
      return;
    }

    if (ctx.phase === "optimization") {
      let extraOverlapBound = 0;
      for (const u of unplaced) {
        let mx = 0;
        const cs = allCands.get(u);
        for (const c of cs) {
          if (c.overlapCount > mx) {
            mx = c.overlapCount;
          }
        }
        extraOverlapBound += mx;
      }
      const upperBound = state.overlapCount + extraOverlapBound;
      if (ctx.bestOverlap >= 0 && upperBound < ctx.bestOverlap) {
        return;
      }
    }

    const word = chooseNextWord(unplaced, state, ctx.hardConstraints, allCands);
    if (!word) {
      return;
    }
    const cands = orderCandidates(allCands.get(word) || [], state);

    for (const cand of cands) {
      if (shouldStop(ctx)) {
        return;
      }
      if (ctx.phase === "feasibility" && ctx.feasibilityFound) {
        return;
      }

      const undo = applyPlacement(state, cand.placement, cand.overlapCount);
      const idx = unplaced.indexOf(word);
      unplaced.splice(idx, 1);
      search(state, unplaced, ctx);
      unplaced.splice(idx, 0, word);
      undoPlacement(state, undo);
    }
  }

  // ===================================================================
  // Top-level solver
  // ===================================================================

  function makeEmptyResult(reason) {
    return {
      placements: [],
      bbox: { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 },
      status: reason,
      optimal: false,
      overlapCount: 0,
      stats: {
        feasibilityNodes: 0,
        feasibilityMillis: 0,
        feasibilityTimedOut: false,
        optimizationNodes: 0,
        optimizationMillis: 0,
        optimizationTimedOut: false,
      },
    };
  }

  function solveCollage(rawWords, rawOptions) {
    const options = { ...DEFAULT_OPTIONS, ...(rawOptions || {}) };
    const words = sanitizeWords(rawWords);
    if (words.length === 0) {
      return makeEmptyResult("empty");
    }

    const wordSet = new Set(words);
    const allowedWordSet = wordSet;
    const hardConstraints = parsePreferences(options.preferences || [], wordSet);

    if (structurallyImpossible(words, hardConstraints)) {
      return {
        placements: [],
        bbox: { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 },
        status: "unsat-structural",
        optimal: true,
        overlapCount: 0,
        stats: {
          feasibilityNodes: 0,
          feasibilityMillis: 0,
          feasibilityTimedOut: false,
          optimizationNodes: 0,
          optimizationMillis: 0,
          optimizationTimedOut: false,
        },
      };
    }

    const ctx = {
      phase: "feasibility",
      startTime: Date.now(),
      timeBudget: options.feasibilityTimeBudget,
      nodeBudget: options.feasibilityNodeBudget,
      nodes: 0,
      bestSolution: null,
      bestOverlap: -1,
      bestBBoxPerimeter: Infinity,
      hardConstraints,
      allowedWordSet,
      options,
      timedOut: false,
      aborted: false,
      feasibilityFound: false,
      onProgress: typeof options.onProgress === "function" ? options.onProgress : null,
    };

    if (ctx.onProgress) {
      ctx.onProgress({ phase: "feasibility", event: "start", words: words.length });
    }

    const state = createState();
    search(state, words.slice(), ctx);

    const phase1Stats = {
      nodes: ctx.nodes,
      millis: Date.now() - ctx.startTime,
      timedOut: ctx.timedOut,
    };

    if (!ctx.bestSolution) {
      return {
        placements: [],
        bbox: { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 },
        status: ctx.timedOut ? "timeout-infeasible" : "unsat",
        optimal: !ctx.timedOut,
        overlapCount: 0,
        stats: {
          feasibilityNodes: phase1Stats.nodes,
          feasibilityMillis: phase1Stats.millis,
          feasibilityTimedOut: phase1Stats.timedOut,
          optimizationNodes: 0,
          optimizationMillis: 0,
          optimizationTimedOut: false,
        },
      };
    }

    const phase1Solution = ctx.bestSolution;

    ctx.phase = "optimization";
    ctx.startTime = Date.now();
    ctx.timeBudget = options.optimizationTimeBudget;
    ctx.nodeBudget = options.optimizationNodeBudget;
    ctx.nodes = 0;
    ctx.timedOut = false;
    ctx.feasibilityFound = false;

    if (ctx.onProgress) {
      ctx.onProgress({
        phase: "optimization",
        event: "start",
        overlap: phase1Solution.overlapCount,
        bboxPerimeter: bboxPerimeter(phase1Solution.bbox),
      });
    }

    const optState = createState();
    search(optState, words.slice(), ctx);

    const phase2Stats = {
      nodes: ctx.nodes,
      millis: Date.now() - ctx.startTime,
      timedOut: ctx.timedOut,
    };

    const finalSolution = ctx.bestSolution || phase1Solution;
    const optimal = !phase1Stats.timedOut && !phase2Stats.timedOut;

    if (ctx.onProgress) {
      ctx.onProgress({
        phase: "done",
        event: "done",
        overlap: finalSolution.overlapCount,
        bboxPerimeter: bboxPerimeter(finalSolution.bbox),
        optimal,
      });
    }

    return {
      placements: finalSolution.placements.slice(),
      bbox: { ...finalSolution.bbox },
      status: optimal ? "optimal" : "feasible",
      optimal,
      overlapCount: finalSolution.overlapCount,
      stats: {
        feasibilityNodes: phase1Stats.nodes,
        feasibilityMillis: phase1Stats.millis,
        feasibilityTimedOut: phase1Stats.timedOut,
        optimizationNodes: phase2Stats.nodes,
        optimizationMillis: phase2Stats.millis,
        optimizationTimedOut: phase2Stats.timedOut,
      },
    };
  }

  // ===================================================================
  // Async wrapper that yields to the event loop periodically. Used by
  // the demo so a 1.5s phase never freezes the GitHub Pages tab.
  // ===================================================================

  function solveCollageAsync(rawWords, rawOptions) {
    if (typeof Promise === "undefined") {
      return Promise.resolve(solveCollage(rawWords, rawOptions));
    }
    return new Promise((resolve) => {
      const start = () => {
        try {
          const result = solveCollage(rawWords, rawOptions);
          resolve(result);
        } catch (err) {
          resolve({
            placements: [],
            bbox: { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 },
            status: "error",
            optimal: false,
            overlapCount: 0,
            error: String((err && err.message) || err),
            stats: {
              feasibilityNodes: 0,
              feasibilityMillis: 0,
              feasibilityTimedOut: false,
              optimizationNodes: 0,
              optimizationMillis: 0,
              optimizationTimedOut: false,
            },
          });
        }
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => setTimeout(start, 0));
      } else if (typeof setTimeout === "function") {
        setTimeout(start, 0);
      } else {
        start();
      }
    });
  }

  const publicApi = {
    solveCollage,
    solveCollageAsync,
    parsePreferences,
    placementsShareCell,
    sanitizeWords,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = publicApi;
  }
  if (typeof globalScope !== "undefined") {
    globalScope.ScrabbleCollageCP = publicApi;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
