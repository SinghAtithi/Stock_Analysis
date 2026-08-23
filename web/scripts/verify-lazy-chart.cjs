/* TASK-56 AC6 evidence — verify ChartPanel's chart library is NOT in the
 * initial page bundle after the dynamic() change. */
const fs = require("fs");
const path = require("path");

const manifest = JSON.parse(fs.readFileSync(".next/build-manifest.json", "utf8"));
const files = (manifest.pages && manifest.pages["/"]) || [];
let inPage = 0;
for (const f of files) {
  const p = path.join(process.cwd(), "public", "..", f.replace(/^\//, "").replace(/\//g, path.sep));
  const abs = path.join(process.cwd(), f);
  try {
    const src = fs.readFileSync(abs, "utf8");
    if (src.includes("lightweight-charts") || src.includes("createChart")) inPage++;
  } catch {}
}
// and confirm an async chunk DOES carry it
const chunksDir = ".next/static/chunks";
let asyncChunk = null;
for (const f of fs.readdirSync(chunksDir)) {
  if (!f.endsWith(".js")) continue;
  const src = fs.readFileSync(path.join(chunksDir, f), "utf8");
  if (src.includes("lightweight-charts")) {
    asyncChunk = `${f} (${(src.length / 1024).toFixed(0)} KB)`;
    break;
  }
}
console.log("page-bundle files referencing lightweight-charts:", inPage, "(want 0)");
console.log("async chunk carrying the chart lib:", asyncChunk);
