import { DAYS_EN, SKIP_RE } from "./constants.js";
import { extractTables } from "./pdf/table.js";
import { extractText } from "./pdf/text.js";

export function clean(text) {
  if (text === null || text === undefined) return "";
  return String(text).replace(/\s+/g, " ").trim();
}

export function shouldSkip(cell) {
  return !cell || SKIP_RE.test(cell.trim());
}

const DAY_NAMES_GR = ["Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο", "Κυριακή"];

export function getDayColIndices(rows) {
  const colHits = new Map();
  let inData = false;
  for (const row of rows) {
    const cells = row.map(clean);
    const joined = cells.join(" ");
    if (joined.includes("ΓΕΥΜΑ") || joined.includes("ΔΕΙΠΝΟ") || joined.includes("Πρώτο Πιάτο") || joined.includes("Κυρίως Πιάτο")) {
      inData = true;
      continue;
    }
    if (!inData) continue;
    cells.forEach((c, i) => {
      if (c && !shouldSkip(c)) {
        colHits.set(i, (colHits.get(i) || 0) + 1);
      }
    });
  }

  if (colHits.size >= 7) {
    return [...colHits.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([col]) => col)
      .sort((a, b) => a - b);
  }

  for (const row of rows) {
    const cells = row.map(clean);
    const found = new Map();
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      for (const d of DAY_NAMES_GR) {
        if (c.includes(d)) {
          found.set(d, i);
          break;
        }
      }
    }
    if (found.size >= 5) {
      const indices = DAY_NAMES_GR.map((d) => (found.has(d) ? found.get(d) : null));
      if (indices[0] === 1 && (colHits.get(0) || 0) > 0) {
        indices[0] = 0;
      }
      return indices;
    }
  }

  return [0, 1, 2, 3, 4, 5, 6];
}

export function parseSectionFromRows(rows, dayColIndices) {
  const numDays = 7;
  let inFirst = false;
  let inMain = false;

  const firstRows = [];
  const mainRows = [];
  let extraRow = null;

  for (const row of rows) {
    const cells = row.map(clean);
    const joined = cells.join(" ");

    if (joined.includes("Πρώτο Πιάτο")) {
      inFirst = true;
      inMain = false;
      continue;
    }
    if (joined.includes("Κυρίως Πιάτο")) {
      inFirst = false;
      inMain = true;
      continue;
    }
    if (shouldSkip(cells[0] || "")) {
      const vals = dayColIndices.map((idx) => (idx !== null && idx < cells.length ? cells[idx] : ""));
      if (vals.some((v) => v === "Γλυκό" || v === "Φρούτο")) {
        extraRow = vals;
      }
      continue;
    }

    const mapped = dayColIndices.map((idx) => (idx !== null && idx < cells.length ? cells[idx] : ""));

    if (inFirst) firstRows.push(mapped);
    else if (inMain) mainRows.push(mapped);
  }

  const days = [];
  for (let d = 0; d < numDays; d++) {
    const first = firstRows.map((r) => r[d]).filter(Boolean);
    const main = mainRows.map((r) => r[d]).filter(Boolean);
    const extra = extraRow && d < extraRow.length && extraRow[d] ? [extraRow[d]] : [];
    days.push({ first, main, extra });
  }
  return days;
}

export function parseWeekFromPage(rects, chars) {
  const tables = extractTables(rects, chars, extractText);
  const week = {};

  let lunchRowsByCols = null;
  let dinnerRowsByCols = null;

  for (const table of tables) {
    const colIndices = getDayColIndices(table);
    let current = null;
    const lunchRows = [];
    const dinnerRows = [];

    for (const row of table) {
      const cells = row.map(clean);
      const joined = cells.join(" ");
      if (joined.includes("ΓΕΥΜΑ")) {
        current = "lunch";
        continue;
      }
      if (joined.includes("ΔΕΙΠΝΟ")) {
        current = "dinner";
        continue;
      }
      if (current === "lunch") lunchRows.push(row);
      else if (current === "dinner") dinnerRows.push(row);
    }

    if (lunchRows.length && lunchRowsByCols === null) lunchRowsByCols = [lunchRows, colIndices];
    if (dinnerRows.length && dinnerRowsByCols === null) dinnerRowsByCols = [dinnerRows, colIndices];
  }

  const lunchDays = parseSectionFromRows(...(lunchRowsByCols || [[], [0, 1, 2, 3, 4, 5, 6]]));
  const dinnerDays = parseSectionFromRows(...(dinnerRowsByCols || [[], [0, 1, 2, 3, 4, 5, 6]]));

  DAYS_EN.forEach((dayEn, i) => {
    week[dayEn] = {
      lunch: { first: lunchDays[i].first, main: lunchDays[i].main },
      dinner: { first: dinnerDays[i].first, main: dinnerDays[i].main },
      lunchExtra: lunchDays[i].extra,
      dinnerExtra: dinnerDays[i].extra,
    };
  });

  return week;
}

export function sqlEscape(text) {
  return text.replace(/'/g, "''");
}

// Idempotent and non-destructive: safe to run before deciding whether
// there's anything new to apply. CREATE TABLE IF NOT EXISTS alone doesn't
// retrofit columns onto a table that already existed before source_pdf_url
// was added, hence the explicit ALTER TABLE.
export const ENSURE_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS menu_meta (
    id SMALLINT PRIMARY KEY DEFAULT 1,
    cycle_weeks INTEGER NOT NULL,
    CONSTRAINT menu_meta_singleton CHECK (id = 1)
);

ALTER TABLE menu_meta ADD COLUMN IF NOT EXISTS source_pdf_url TEXT;

CREATE TABLE IF NOT EXISTS breakfast_items (
    id SERIAL PRIMARY KEY,
    category TEXT NOT NULL,
    position INTEGER NOT NULL,
    item_gr TEXT NOT NULL,
    item_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS menu_items (
    id SERIAL PRIMARY KEY,
    week_num INTEGER NOT NULL,
    day_name TEXT NOT NULL,
    meal_type TEXT NOT NULL,
    course TEXT NOT NULL,
    position INTEGER NOT NULL,
    item_gr TEXT NOT NULL,
    item_en TEXT NOT NULL
);
`;

export const SCHEMA_SQL = `${ENSURE_SCHEMA_SQL}
TRUNCATE TABLE menu_meta, breakfast_items, menu_items RESTART IDENTITY;
`;

export function renderBreakfastSql(bGr, bEn) {
  const rows = [];
  for (const category of Object.keys(bGr)) {
    bGr[category].forEach((gr, i) => {
      const en = bEn[category][i];
      rows.push(`('${sqlEscape(category)}', ${i + 1}, '${sqlEscape(gr)}', '${sqlEscape(en)}')`);
    });
  }
  if (!rows.length) return "";
  return `INSERT INTO breakfast_items (category, position, item_gr, item_en) VALUES\n${rows.join(",\n")};\n`;
}

function courseRows(dayGr, dayEn, mealType, course) {
  const grItems = course === "first" || course === "main" ? dayGr[mealType][course] : dayGr[`${mealType}Extra`];
  const enItems = course === "first" || course === "main" ? dayEn[mealType][course] : dayEn[`${mealType}Extra`];
  return grItems.map((gr, i) => [gr, enItems[i]]);
}

export function renderMenuItemsSql(weeksGr, weeksEn) {
  const rows = [];
  weeksGr.forEach((weekGr, weekIdx) => {
    const weekEn = weeksEn[weekIdx];
    const weekNum = weekIdx + 1;
    for (const day of DAYS_EN) {
      const dayGr = weekGr[day];
      const dayEn = weekEn[day];
      for (const mealType of ["lunch", "dinner"]) {
        for (const course of ["first", "main", "extra"]) {
          const items = courseRows(dayGr, dayEn, mealType, course);
          items.forEach(([gr, en], i) => {
            rows.push(`(${weekNum}, '${day}', '${mealType}', '${course}', ${i + 1}, '${sqlEscape(gr)}', '${sqlEscape(en)}')`);
          });
        }
      }
    }
  });
  if (!rows.length) return "";
  return `INSERT INTO menu_items (week_num, day_name, meal_type, course, position, item_gr, item_en) VALUES\n${rows.join(",\n")};\n`;
}

export function buildSql(weeksGr, weeksEn, cycleWeeks, sourcePdfUrl, breakfastGr, breakfastEn) {
  const parts = [`-- Menu auto generated from PDF  (${cycleWeeks}-week cycle)\n`, "BEGIN;\n", SCHEMA_SQL];
  const urlSql = sourcePdfUrl ? `'${sqlEscape(sourcePdfUrl)}'` : "NULL";
  parts.push(`INSERT INTO menu_meta (id, cycle_weeks, source_pdf_url) VALUES (1, ${cycleWeeks}, ${urlSql});\n`);

  const breakfastSql = renderBreakfastSql(breakfastGr, breakfastEn);
  if (breakfastSql) parts.push(breakfastSql);

  const menuItemsSql = renderMenuItemsSql(weeksGr, weeksEn);
  if (menuItemsSql) parts.push(menuItemsSql);

  parts.push("COMMIT;\n");
  return parts.join("\n");
}
