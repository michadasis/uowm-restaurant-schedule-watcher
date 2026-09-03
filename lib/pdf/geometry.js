// Port of pdfplumber's utils/geometry.py (only what table.js / text.js need)
import { clusterObjects } from "./clustering.js";

export function objToBbox(obj) {
  return [obj.x0, obj.top, obj.x1, obj.bottom];
}

export function mergeBboxes(bboxes) {
  const x0 = Math.min(...bboxes.map((b) => b[0]));
  const top = Math.min(...bboxes.map((b) => b[1]));
  const x1 = Math.max(...bboxes.map((b) => b[2]));
  const bottom = Math.max(...bboxes.map((b) => b[3]));
  return [x0, top, x1, bottom];
}

export function objectsToBbox(objects) {
  return mergeBboxes(objects.map(objToBbox));
}

export function getBboxOverlap(a, b) {
  const [aLeft, aTop, aRight, aBottom] = a;
  const [bLeft, bTop, bRight, bBottom] = b;
  const oLeft = Math.max(aLeft, bLeft);
  const oRight = Math.min(aRight, bRight);
  const oBottom = Math.min(aBottom, bBottom);
  const oTop = Math.max(aTop, bTop);
  const oWidth = oRight - oLeft;
  const oHeight = oBottom - oTop;
  if (oHeight >= 0 && oWidth >= 0 && oHeight + oWidth > 0) {
    return [oLeft, oTop, oRight, oBottom];
  }
  return null;
}

export function moveObject(obj, axis, value) {
  if (axis === "h") {
    return { ...obj, x0: obj.x0 + value, x1: obj.x1 + value };
  }
  return { ...obj, top: obj.top + value, bottom: obj.bottom + value };
}

export function snapObjects(objs, attr, tolerance) {
  const axis = { x0: "h", x1: "h", top: "v", bottom: "v" }[attr];
  const clusters = clusterObjects(objs, (o) => o[attr], tolerance);
  const avgs = clusters.map(
    (cluster) => cluster.reduce((s, o) => s + o[attr], 0) / cluster.length
  );
  const snapped = clusters.map((cluster, i) =>
    cluster.map((obj) => moveObject(obj, axis, avgs[i] - obj[attr]))
  );
  return snapped.flat();
}

export function resizeObject(obj, key, value) {
  const oldValue = obj[key];
  const diff = value - oldValue;
  const updates = { [key]: value };
  if (key === "x0") {
    updates.width = obj.x1 - value;
  } else if (key === "x1") {
    updates.width = value - obj.x0;
  } else if (key === "top") {
    updates.height = obj.height - diff;
  } else if (key === "bottom") {
    updates.height = obj.height + diff;
  }
  return { ...obj, ...updates };
}

export function rectToEdges(rect) {
  const top = {
    ...rect,
    object_type: "rect_edge",
    height: 0,
    y0: rect.y1,
    bottom: rect.top,
    orientation: "h",
  };
  const bottom = {
    ...rect,
    object_type: "rect_edge",
    height: 0,
    y1: rect.y0,
    top: rect.top + rect.height,
    orientation: "h",
  };
  const left = {
    ...rect,
    object_type: "rect_edge",
    width: 0,
    x1: rect.x0,
    orientation: "v",
  };
  const right = {
    ...rect,
    object_type: "rect_edge",
    width: 0,
    x0: rect.x1,
    orientation: "v",
  };
  return [top, bottom, left, right];
}

export function filterEdges(edges, orientation = null, minLength = 1) {
  return edges.filter((e) => {
    const dim = e.orientation === "v" ? "height" : "width";
    const orientOk = orientation === null || e.orientation === orientation;
    return orientOk && e[dim] >= minLength;
  });
}
