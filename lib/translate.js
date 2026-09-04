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
      // Valid Unicode code points only; String.fromCodePoint throws for
      // anything outside that range (e.g. a stray &#99999999;).
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    // hasOwn, not `in`, so an entity like &constructor; can't resolve to
    // something inherited from Object.prototype.
    return Object.hasOwn(HTML_ENTITIES, entity) ? HTML_ENTITIES[entity] : match;
  });
}

// Thrown for responses worth a retry (rate limiting, transient server
// errors), as opposed to a permanent failure like a malformed response.
class RetryableTranslateError extends Error {
  constructor(status) {
    super(`Google Translate returned ${status}`);
    this.status = status;
  }
}

const RETRY_DELAY_MS = 500;

async function translateOnce(text, source, target) {
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (source === target) return text;

  const url = `https://translate.google.com/m?${new URLSearchParams({ sl: source, tl: target, q: trimmed })}`;
  const resp = await fetch(url);
  if (resp.status === 429 || resp.status >= 500) {
    throw new RetryableTranslateError(resp.status);
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

async function translateOne(text, source, target) {
  try {
    return await translateOnce(text, source, target);
  } catch (err) {
    if (!(err instanceof RetryableTranslateError)) throw err;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return translateOnce(text, source, target); // a second failure here throws for real
  }
}

// Runs `fn` over `items` with at most `limit` in flight at once, since
// translating a full menu one string at a time is slow enough to risk
// hitting a Vercel function's maxDuration.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const TRANSLATE_CONCURRENCY = 6;

export async function translateWeeks(weeks, source = "el", target = "en") {
  const strings = getAllStrings(weeks);
  if (!strings.length) return weeks;

  const translated = await mapWithConcurrency(strings, TRANSLATE_CONCURRENCY, (s) => translateOne(s, source, target));
  const translationMap = new Map(strings.map((s, i) => [s, translated[i]]));

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
