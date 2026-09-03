// Port of pdfplumber's utils/clustering.py

export function clusterList(xs, tolerance = 0) {
  const sorted = [...xs].sort((a, b) => a - b);
  if (tolerance === 0 || sorted.length < 2) {
    return sorted.map((x) => [x]);
  }
  const groups = [];
  let current = [sorted[0]];
  let last = sorted[0];
  for (const x of sorted.slice(1)) {
    if (x <= last + tolerance) {
      current.push(x);
    } else {
      groups.push(current);
      current = [x];
    }
    last = x;
  }
  groups.push(current);
  return groups;
}

function makeClusterMap(values, tolerance) {
  const unique = [...new Set(values)];
  const clusters = clusterList(unique, tolerance);
  const map = new Map();
  clusters.forEach((cluster, i) => {
    for (const val of cluster) map.set(val, i);
  });
  return map;
}

// keyFn: (obj) => number. Returns array of arrays of original objects.
export function clusterObjects(xs, keyFn, tolerance, preserveOrder = false) {
  const values = xs.map(keyFn);
  const clusterMap = makeClusterMap(values, tolerance);

  let tuples = xs.map((x) => [x, clusterMap.get(keyFn(x))]);
  if (!preserveOrder) {
    tuples = [...tuples].sort((a, b) => a[1] - b[1]);
  }

  const grouped = [];
  let currentKey = null;
  let currentGroup = null;
  for (const [x, k] of tuples) {
    if (currentGroup === null || k !== currentKey) {
      currentGroup = [];
      grouped.push(currentGroup);
      currentKey = k;
    }
    currentGroup.push(x);
  }
  return grouped;
}
