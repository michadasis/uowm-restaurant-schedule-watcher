// Extracts pdfplumber-equivalent `rects` and `chars` for one page from a
// pdfjs-dist page, by walking its raw operator list. See README-DEV notes in
// this repo's history for how this was validated against pdfplumber's own
// output (page.rects / page.chars) for the real menu PDF.
//
// Known gap: text positioning via Tm (setTextMatrix) and the Td/TD/T*/TL/Ts
// family is handled, but a `cm` transform (or a q/Q graphics-state stack
// around one) is not. Confirmed via the real PDF's operator list that
// neither page ever emits a `transform` op, only `save`/`restore` around
// plain rect clips with no accompanying `cm`, so this doesn't affect the
// menu PDFs this project actually processes. A PDF that positions content
// via `cm` would need a real CTM stack here, which isn't implemented.
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

const PAINT_OPS = new Set([
  OPS.fill,
  OPS.eoFill,
  OPS.stroke,
  OPS.closeStroke,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
]);

// Fraction of font size used above/below the baseline to approximate a
// glyph's vertical extent, since we don't load embedded font metrics.
// Row heights in these table PDFs are generously larger than any single
// text line, so this only needs to keep same-line chars clustered together
// and separated from neighboring lines/cells, not be pixel-exact.
const ASCENT_RATIO = 0.8;
const DESCENT_RATIO = 0.2;

export async function extractPageGeometry(page) {
  const pageHeight = page.view[3] - page.view[1];
  const opList = await page.getOperatorList();
  const { fnArray, argsArray } = opList;

  const rects = [];
  const chars = [];

  let pendingRect = null;

  let tm = [1, 0, 0, 1, 0, 0];
  let tlm = [1, 0, 0, 1, 0, 0]; // text line matrix, the base Td/TD/T* offset from
  let fontSize = 0;
  let charSpacing = 0;
  let wordSpacing = 0;
  let leading = 0;
  let textRise = 0;

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];

    if (fn === OPS.constructPath) {
      const subops = args[0];
      if (subops.length === 1 && subops[0] === OPS.rectangle) {
        const [x, y, w, h] = args[1];
        pendingRect = { x0: x, y0: y, x1: x + w, y1: y + h, width: w, height: h };
      } else {
        pendingRect = null;
      }
      continue;
    }

    if (pendingRect) {
      if (PAINT_OPS.has(fn)) {
        rects.push({
          x0: pendingRect.x0,
          x1: pendingRect.x1,
          top: pageHeight - pendingRect.y1,
          bottom: pageHeight - pendingRect.y0,
          width: pendingRect.width,
          height: pendingRect.height,
        });
      }
      pendingRect = null;
    }

    if (fn === OPS.beginText) {
      tm = [1, 0, 0, 1, 0, 0];
      tlm = [1, 0, 0, 1, 0, 0];
      continue;
    }
    if (fn === OPS.setFont) {
      fontSize = args[1];
      continue;
    }
    if (fn === OPS.setTextMatrix) {
      tm = args;
      tlm = args;
      continue;
    }
    if (fn === OPS.setCharSpacing) {
      charSpacing = args[0];
      continue;
    }
    if (fn === OPS.setWordSpacing) {
      wordSpacing = args[0];
      continue;
    }
    if (fn === OPS.setLeading) {
      leading = args[0];
      continue;
    }
    if (fn === OPS.setTextRise) {
      textRise = args[0];
      continue;
    }
    if (fn === OPS.moveText || fn === OPS.setLeadingMoveText) {
      const [tx, ty] = args;
      if (fn === OPS.setLeadingMoveText) leading = -ty;
      const [a, b, c, d, e, f] = tlm;
      tlm = [a, b, c, d, tx * a + ty * c + e, tx * b + ty * d + f];
      tm = tlm;
      continue;
    }
    if (fn === OPS.nextLine) {
      const [a, b, c, d, e, f] = tlm;
      tlm = [a, b, c, d, -leading * c + e, -leading * d + f];
      tm = tlm;
      continue;
    }
    if (fn === OPS.showText) {
      const glyphs = args[0];
      for (const g of glyphs) {
        if (typeof g === "number") {
          const shift = (-g / 1000) * fontSize;
          tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + shift * tm[0], tm[5] + shift * tm[1]];
          continue;
        }

        const text = g.unicode || g.fontChar || "";
        const isSpace = Boolean(g.isSpace) || text === " ";
        const glyphWidthPts = (g.width / 1000) * fontSize;
        const tx = glyphWidthPts + charSpacing + (isSpace ? wordSpacing : 0);

        const x0 = tm[4];
        const y0 = tm[5]; // true baseline, used to advance tm below
        const glyphY = y0 + textRise * tm[3]; // risen position, for this glyph's bbox only
        const dx = tx * tm[0];
        const dy = tx * tm[1];
        const x1 = x0 + dx;

        const vScale = Math.hypot(tm[1], tm[3]) || 1;
        const ascent = ASCENT_RATIO * fontSize * vScale;
        const descent = DESCENT_RATIO * fontSize * vScale;

        if (text) {
          chars.push({
            text,
            x0: Math.min(x0, x1),
            x1: Math.max(x0, x1),
            top: pageHeight - (glyphY + ascent),
            bottom: pageHeight - (glyphY - descent),
            upright: Math.abs(tm[1]) < 1e-6 && Math.abs(tm[2]) < 1e-6 && tm[0] > 0 && tm[3] > 0,
          });
        }

        tm = [tm[0], tm[1], tm[2], tm[3], x0 + dx, y0 + dy];
      }
      continue;
    }
    if (fn === OPS.endText) {
      charSpacing = 0;
      wordSpacing = 0;
      leading = 0;
      textRise = 0;
      continue;
    }
  }

  return { rects, chars };
}
