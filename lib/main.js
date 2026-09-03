import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
// pdfjs-dist loads its worker via a *dynamic* import() at runtime (even in
// Node, where it runs "in-process" rather than as a real worker thread).
// Vercel's build-time dependency tracing can't see dynamic imports with a
// computed specifier, so without this static side-effect import the worker
// file gets left out of the deployed function bundle.
import "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { extractPageGeometry } from "./pdf/extract.js";
import { parseWeekFromPage, buildSql } from "./utils.js";
import { translateWeeks } from "./translate.js";
import { BREAKFAST_GR, BREAKFAST_EN } from "./constants.js";

export async function parsePdfBytes(data) {
  const doc = await getDocument({ data, disableFontFace: true, isEvalSupported: false }).promise;

  console.log(`Pages found: ${doc.numPages}  ->  ${doc.numPages} week(s) in menu cycle`);

  const weeksGr = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const { rects, chars } = await extractPageGeometry(page);
    weeksGr.push(parseWeekFromPage(rects, chars));
  }
  return weeksGr;
}

export async function parsePdf(pdfPath) {
  return parsePdfBytes(new Uint8Array(fs.readFileSync(pdfPath)));
}

export async function convertPdfBytesToSql(data, sourcePdfUrl = null) {
  const weeksGr = await parsePdfBytes(data);

  console.log(`Translating unique meal strings via Google Translate...`);
  const weeksEn = await translateWeeks(weeksGr);
  console.log("Done.");

  return buildSql(weeksGr, weeksEn, weeksGr.length, sourcePdfUrl, BREAKFAST_GR, BREAKFAST_EN);
}

export async function convertPdfToSql(pdfPath, sourcePdfUrl = null) {
  console.log(`Reading PDF: ${pdfPath}`);
  return convertPdfBytesToSql(new Uint8Array(fs.readFileSync(pdfPath)), sourcePdfUrl);
}

async function main() {
  const [, , pdfPath, sqlPathArg, sourcePdfUrl] = process.argv;
  if (!pdfPath) {
    console.error(`Usage: node lib/main.js <input.pdf> [output.sql] [source_pdf_url]`);
    process.exit(1);
  }
  const sqlPath = sqlPathArg || "restaurantMenu.sql";

  const sqlContent = await convertPdfToSql(pdfPath, sourcePdfUrl || null);
  fs.writeFileSync(sqlPath, sqlContent, "utf-8");
  console.log(`Written to: ${sqlPath}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
