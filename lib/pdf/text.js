// Port of pdfplumber's utils/text.py, restricted to the non-"layout" default
// path used by Table.extract() (upright, left-to-right, top-to-bottom text
// only, which is all this project's PDFs contain).
import { clusterObjects } from "./clustering.js";

const X_TOLERANCE = 3;
const Y_TOLERANCE = 3;

const LIGATURES = {
  "ﬀ": "ff",
  "ﬃ": "ffi",
  "ﬄ": "ffl",
  "ﬁ": "fi",
  "ﬂ": "fl",
  "ﬆ": "st",
  "ﬅ": "st",
};

function isSpace(text) {
  return /^\s+$/.test(text);
}

// Port of WordExtractor.char_begins_new_word for direction === "ltr"/"ttb" (upright text).
function charBeginsNewWord(prev, curr, xTolerance, yTolerance) {
  const ax = prev.x0;
  const bx = prev.x1;
  const cx = curr.x0;
  const ay = prev.top;
  const cy = curr.top;
  return cx < ax || cx > bx + xTolerance || Math.abs(cy - ay) > yTolerance;
}

function mergeChars(orderedChars) {
  const x0 = Math.min(...orderedChars.map((c) => c.x0));
  const x1 = Math.max(...orderedChars.map((c) => c.x1));
  const top = Math.min(...orderedChars.map((c) => c.top));
  const bottom = Math.max(...orderedChars.map((c) => c.bottom));
  return {
    text: orderedChars.map((c) => LIGATURES[c.text] ?? c.text).join(""),
    x0,
    x1,
    top,
    bottom,
  };
}

function iterCharsToWords(orderedChars) {
  const words = [];
  let current = [];
  for (const char of orderedChars) {
    const text = char.text;
    if (!text || isSpace(text)) {
      if (current.length) words.push(current);
      current = [];
    } else if (current.length && charBeginsNewWord(current[current.length - 1], char, X_TOLERANCE, Y_TOLERANCE)) {
      words.push(current);
      current = [char];
    } else {
      current.push(char);
    }
  }
  if (current.length) words.push(current);
  return words;
}

function iterCharsToLines(chars) {
  // Chars are assumed all upright (true for this project's PDFs).
  const clusters = clusterObjects(chars, (c) => c.top, Y_TOLERANCE);
  return clusters.map((cluster) => [...cluster].sort((a, b) => a.x0 - b.x0 || a.x0 - b.x0));
}

function extractWords(chars) {
  const words = [];
  for (const lineChars of iterCharsToLines(chars)) {
    for (const wordChars of iterCharsToWords(lineChars)) {
      words.push(mergeChars(wordChars));
    }
  }
  return words;
}

/**
 * Port of pdfplumber's utils.extract_text(chars) with default (non-layout) settings.
 */
export function extractText(chars) {
  if (!chars.length) return "";
  const words = extractWords(chars);
  const lines = clusterObjects(words, (w) => w.top, Y_TOLERANCE);
  return lines.map((line) => line.map((w) => w.text).join(" ")).join("\n");
}
