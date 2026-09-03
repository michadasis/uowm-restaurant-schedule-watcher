// Port of pdfplumber's table.py, restricted to the code paths exercised when
// vertical_strategy/horizontal_strategy are left at their default ("lines"),
// which is what this project's PDFs use (extract_tables() called with no
// custom table_settings).
import { clusterObjects } from "./clustering.js";
import { objToBbox, snapObjects, resizeObject, filterEdges, rectToEdges } from "./geometry.js";

const SNAP_TOLERANCE = 3;
const JOIN_TOLERANCE = 3;
const EDGE_MIN_LENGTH_PREFILTER = 1;
const EDGE_MIN_LENGTH = 3;
const INTERSECTION_TOLERANCE = 3;

function snapEdges(edges, xTolerance, yTolerance) {
  const v = edges.filter((e) => e.orientation === "v");
  const h = edges.filter((e) => e.orientation === "h");
  return [...snapObjects(v, "x0", xTolerance), ...snapObjects(h, "top", yTolerance)];
}

function joinEdgeGroup(edges, orientation, tolerance) {
  const [minProp, maxProp] = orientation === "h" ? ["x0", "x1"] : ["top", "bottom"];
  const sorted = [...edges].sort((a, b) => a[minProp] - b[minProp]);
  const joined = [sorted[0]];
  for (const e of sorted.slice(1)) {
    const last = joined[joined.length - 1];
    if (e[minProp] <= last[maxProp] + tolerance) {
      if (e[maxProp] > last[maxProp]) {
        joined[joined.length - 1] = resizeObject(last, maxProp, e[maxProp]);
      }
    } else {
      joined.push(e);
    }
  }
  return joined;
}

function mergeEdges(edges, snapXTolerance, snapYTolerance, joinXTolerance, joinYTolerance) {
  let result = edges;
  if (snapXTolerance > 0 || snapYTolerance > 0) {
    result = snapEdges(result, snapXTolerance, snapYTolerance);
  }

  const getGroupKey = (e) => (e.orientation === "h" ? `h:${e.top}` : `v:${e.x0}`);
  const sorted = [...result].sort((a, b) => (getGroupKey(a) < getGroupKey(b) ? -1 : getGroupKey(a) > getGroupKey(b) ? 1 : 0));

  const groups = [];
  let currentKey = null;
  let currentGroup = null;
  for (const e of sorted) {
    const k = getGroupKey(e);
    if (currentGroup === null || k !== currentKey) {
      currentGroup = [];
      groups.push({ orientation: e.orientation, items: currentGroup });
      currentKey = k;
    }
    currentGroup.push(e);
  }

  const out = [];
  for (const { orientation, items } of groups) {
    const tolerance = orientation === "h" ? joinXTolerance : joinYTolerance;
    out.push(...joinEdgeGroup(items, orientation, tolerance));
  }
  return out;
}

function edgesToIntersections(edges, xTolerance, yTolerance) {
  const vEdges = edges.filter((e) => e.orientation === "v");
  const hEdges = edges.filter((e) => e.orientation === "h");
  const intersections = new Map(); // key: "x,y" -> {point, v:[], h:[]}

  const sortedV = [...vEdges].sort((a, b) => a.x0 - b.x0 || a.top - b.top);
  const sortedH = [...hEdges].sort((a, b) => a.top - b.top || a.x0 - b.x0);

  for (const v of sortedV) {
    for (const h of sortedH) {
      if (
        v.top <= h.top + yTolerance &&
        v.bottom >= h.top - yTolerance &&
        v.x0 >= h.x0 - xTolerance &&
        v.x0 <= h.x1 + xTolerance
      ) {
        const key = `${v.x0},${h.top}`;
        if (!intersections.has(key)) {
          intersections.set(key, { point: [v.x0, h.top], v: [], h: [] });
        }
        const entry = intersections.get(key);
        entry.v.push(v);
        entry.h.push(h);
      }
    }
  }
  return intersections;
}

function bboxKey(obj) {
  return objToBbox(obj).join(",");
}

function intersectionsToCells(intersections) {
  function edgeConnects(p1, p2) {
    const e1 = intersections.get(`${p1[0]},${p1[1]}`);
    const e2 = intersections.get(`${p2[0]},${p2[1]}`);
    if (p1[0] === p2[0]) {
      const set1 = new Set(e1.v.map(bboxKey));
      if (e2.v.some((e) => set1.has(bboxKey(e)))) return true;
    }
    if (p1[1] === p2[1]) {
      const set1 = new Set(e1.h.map(bboxKey));
      if (e2.h.some((e) => set1.has(bboxKey(e)))) return true;
    }
    return false;
  }

  const points = [...intersections.keys()]
    .map((k) => intersections.get(k).point)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const pointSet = new Set(points.map((p) => `${p[0]},${p[1]}`));
  const nPoints = points.length;

  function findSmallestCell(i) {
    if (i === nPoints - 1) return null;
    const pt = points[i];
    const rest = points.slice(i + 1);
    const below = rest.filter((x) => x[0] === pt[0]);
    const right = rest.filter((x) => x[1] === pt[1]);
    for (const belowPt of below) {
      if (!edgeConnects(pt, belowPt)) continue;
      for (const rightPt of right) {
        if (!edgeConnects(pt, rightPt)) continue;
        const bottomRight = [rightPt[0], belowPt[1]];
        if (
          pointSet.has(`${bottomRight[0]},${bottomRight[1]}`) &&
          edgeConnects(bottomRight, rightPt) &&
          edgeConnects(bottomRight, belowPt)
        ) {
          return [pt[0], pt[1], bottomRight[0], bottomRight[1]];
        }
      }
    }
    return null;
  }

  const cells = [];
  for (let i = 0; i < nPoints; i++) {
    const cell = findSmallestCell(i);
    if (cell) cells.push(cell);
  }
  return cells;
}

function bboxToCorners(bbox) {
  const [x0, top, x1, bottom] = bbox;
  return [
    `${x0},${top}`,
    `${x0},${bottom}`,
    `${x1},${top}`,
    `${x1},${bottom}`,
  ];
}

function cellsToTables(cells) {
  let remaining = [...cells];
  let currentCorners = new Set();
  let currentCells = [];
  const tables = [];

  while (remaining.length) {
    const initialCount = currentCells.length;
    for (const cell of [...remaining]) {
      const cellCorners = bboxToCorners(cell);
      if (currentCells.length === 0) {
        cellCorners.forEach((c) => currentCorners.add(c));
        currentCells.push(cell);
        remaining = remaining.filter((c) => c !== cell);
      } else {
        const cornerCount = cellCorners.filter((c) => currentCorners.has(c)).length;
        if (cornerCount > 0) {
          cellCorners.forEach((c) => currentCorners.add(c));
          currentCells.push(cell);
          remaining = remaining.filter((c) => c !== cell);
        }
      }
    }
    if (currentCells.length === initialCount) {
      tables.push(currentCells);
      currentCorners = new Set();
      currentCells = [];
    }
  }
  if (currentCells.length) tables.push(currentCells);

  const sorted = [...tables].sort((a, b) => {
    const minA = a.reduce((m, c) => (c[1] < m[0] || (c[1] === m[0] && c[0] < m[1]) ? [c[1], c[0]] : m), [Infinity, Infinity]);
    const minB = b.reduce((m, c) => (c[1] < m[0] || (c[1] === m[0] && c[0] < m[1]) ? [c[1], c[0]] : m), [Infinity, Infinity]);
    return minA[0] - minB[0] || minA[1] - minB[1];
  });
  return sorted.filter((t) => t.length > 1);
}

function getEdges(rects) {
  // vertical_strategy = horizontal_strategy = "lines" (the pdfplumber default)
  const pageEdges = rects.flatMap(rectToEdges);
  const vBase = filterEdges(pageEdges, "v", EDGE_MIN_LENGTH_PREFILTER);
  const hBase = filterEdges(pageEdges, "h", EDGE_MIN_LENGTH_PREFILTER);
  const merged = mergeEdges(
    [...vBase, ...hBase],
    SNAP_TOLERANCE,
    SNAP_TOLERANCE,
    JOIN_TOLERANCE,
    JOIN_TOLERANCE
  );
  return filterEdges(merged, null, EDGE_MIN_LENGTH);
}

function charInBbox(char, bbox) {
  const vMid = (char.top + char.bottom) / 2;
  const hMid = (char.x0 + char.x1) / 2;
  const [x0, top, x1, bottom] = bbox;
  return hMid >= x0 && hMid < x1 && vMid >= top && vMid < bottom;
}

function tableRows(cells, extractCellText) {
  // Sort cells into rows (grouped by "top"), each row spanning all distinct x0
  // column positions found across the whole table (matches pdfplumber's Table.rows).
  const xs = [...new Set(cells.map((c) => c[0]))].sort((a, b) => a - b);
  const sorted = [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0]);

  const groups = [];
  let currentTop = null;
  let currentGroup = null;
  for (const cell of sorted) {
    if (currentGroup === null || cell[1] !== currentTop) {
      currentGroup = [];
      groups.push(currentGroup);
      currentTop = cell[1];
    }
    currentGroup.push(cell);
  }

  return groups.map((rowCells) => {
    const byX0 = new Map(rowCells.map((c) => [c[0], c]));
    const rowBbox = [
      Math.min(...rowCells.map((c) => c[0])),
      Math.min(...rowCells.map((c) => c[1])),
      Math.max(...rowCells.map((c) => c[2])),
      Math.max(...rowCells.map((c) => c[3])),
    ];
    return xs.map((x) => {
      const cell = byX0.get(x);
      return cell ? extractCellText(cell, rowBbox) : null;
    });
  });
}

/**
 * @param {Array} rects - page.rects equivalent: [{x0,top,x1,bottom,width,height}, ...]
 * @param {Array} chars - page.chars equivalent: [{x0,top,x1,bottom,text,upright}, ...]
 * @param {(chars: Array) => string} extractText - pdfplumber's utils.extract_text port
 */
export function extractTables(rects, chars, extractText) {
  const edges = getEdges(rects);
  const intersections = edgesToIntersections(edges, INTERSECTION_TOLERANCE, INTERSECTION_TOLERANCE);
  const cells = intersectionsToCells(intersections);
  const tables = cellsToTables(cells);

  function extractCellText(cell, rowBbox) {
    const rowChars = chars.filter((c) => charInBbox(c, rowBbox));
    const cellChars = rowChars.filter((c) => charInBbox(c, cell));
    if (cellChars.length === 0) return "";
    return extractText(cellChars);
  }

  return tables.map((tableCells) => tableRows(tableCells, extractCellText));
}
