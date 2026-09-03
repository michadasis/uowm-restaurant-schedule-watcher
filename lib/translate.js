// Port of translate.py, which used deep_translator's GoogleTranslator (a thin
// wrapper around https://translate.google.com/m). Replicated directly here
// via fetch + a small regex instead of adding a translation-library
// dependency for a single endpoint.

function getAllStrings(weeks) {
  const seen = new Set();
  const result = [];
  const add = (item) => {
    if (item && !seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  };
  for (const week of weeks) {
    for (const day of Object.values(week)) {
      for (const meal of ["lunch", "dinner"]) {
        for (const course of ["first", "main"]) {
          for (const item of day[meal][course]) add(item);
        }
      }
      for (const key of ["lunchExtra", "dinnerExtra"]) {
        for (const item of day[key] || []) add(item);
      }
    }
  }
  return result;
}

const HTML_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
};

function decodeHtmlEntities(text) {
  return text.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z0-9]+);/g, (match, entity) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return entity in HTML_ENTITIES ? HTML_ENTITIES[entity] : match;
  });
}

async function translateOne(text, source, target) {
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (source === target) return text;

  const url = `https://translate.google.com/m?${new URLSearchParams({ sl: source, tl: target, q: trimmed })}`;
  const resp = await fetch(url);
  if (resp.status === 429) {
    throw new Error("Google Translate rate limit (429) hit.");
  }
  if (!resp.ok) {
    throw new Error(`Google Translate request failed: ${resp.status}`);
  }
  const html = await resp.text();
  const match = html.match(/<div class="result-container">([\s\S]*?)<\/div>/);
  if (!match) {
    throw new Error(`Could not find translation in response for: ${trimmed}`);
  }
  return decodeHtmlEntities(match[1]).trim();
}

export async function translateWeeks(weeks, source = "el", target = "en") {
  const strings = getAllStrings(weeks);
  if (!strings.length) return weeks;

  const translationMap = new Map();
  for (const s of strings) {
    translationMap.set(s, await translateOne(s, source, target));
  }

  const translateList = (items) => items.map((item) => translationMap.get(item) ?? item);

  return weeks.map((week) => {
    const translatedWeek = {};
    for (const [dayKey, day] of Object.entries(week)) {
      translatedWeek[dayKey] = {
        lunch: {
          first: translateList(day.lunch.first),
          main: translateList(day.lunch.main),
        },
        dinner: {
          first: translateList(day.dinner.first),
          main: translateList(day.dinner.main),
        },
        lunchExtra: translateList(day.lunchExtra || []),
        dinnerExtra: translateList(day.dinnerExtra || []),
      };
    }
    return translatedWeek;
  });
}
