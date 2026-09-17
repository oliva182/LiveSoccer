// Verifica live: dot colorati della classifica ben visibili e distinguibili (tema matrix)
const { chromium } = require("C:/Users/oliva/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright");
const LEAGUES = [["ita.1", "Serie A"], ["eng.1", "Premier League"], ["fra.1", "Ligue 1"]];
const URL = "file:///E:/Download/IA/test/prova/qwen3.8_v2/index.html";

function parseRGB(c) {
  const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  if (m[4] !== undefined && parseFloat(m[4]) < 0.05) return null; // trasparente
  return [m[1], m[2], m[3]].map(Number);
}
function lum(rgb) {
  const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function rgbStr(rgb) { return rgb.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase(); }
function srgb2lab(rgb) {
  const [r, g, b] = rgb.map((v) => {
    v /= 255; const lin = v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92;
    return lin;
  });
  const X = 0.4124 * r + 0.3576 * g + 0.1805 * b;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  const f = (t) => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(X / 0.95047), f(Y), f(Z / 1.08883)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function deltaE(a, b) {
  const [l1, a1, b1] = srgb2lab(a); const [l2, a2, b2] = srgb2lab(b);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
  await page.goto(URL);
  await page.evaluate(() => setTheme("matrix"));
  let failures = 0;
  for (const [slug, name] of LEAGUES) {
    await page.evaluate((s) => switchLeague(s), slug);
    await page.waitForSelector(`h2:has-text("Classifica · ${name}")`, { timeout: 30000 });
    await page.waitForSelector("table.cls tbody tr", { timeout: 30000 });
    const data = await page.evaluate(() => {
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
      const dots = [...document.querySelectorAll("table.cls .zone-dot")].map((d) => getComputedStyle(d).backgroundColor);
      const legend = [...document.querySelectorAll(".zone-legend .zone-dot")].map((d) => getComputedStyle(d).backgroundColor);
      return { bg, dots, legend };
    });
    const bg = parseRGB(data.bg) || [1, 7, 1];
    const colors = [...new Set(data.dots.filter(Boolean))].map(parseRGB).filter(Boolean);
    const transparent = data.dots.filter((c) => parseRGB(c) === null).length;
    const badContrast = colors.filter((c) => contrast(c, bg) < 3);
    const pairwise = []; // coppie non distinguibili (ΔE CIE76 < 10 = soglia JND)
    for (let i = 0; i < colors.length; i++)
      for (let j = i + 1; j < colors.length; j++)
        if (deltaE(colors[i], colors[j]) < 10) pairwise.push([rgbStr(colors[i]), rgbStr(colors[j]), deltaE(colors[i], colors[j]).toFixed(0)]);
    const legendColors = [...new Set(data.legend.filter(Boolean))].map(parseRGB).filter(Boolean);
    const legendUndistinct = legendColors.length !== new Set(legendColors.map(rgbStr)).size;
    const legendMinDE = Math.min(...legendColors.flatMap((c, i) => legendColors.slice(i + 1).map((d) => deltaE(c, d))).concat([999]));
    const ok = !transparent && !badContrast.length && !pairwise.length && !legendUndistinct && colors.length > 0;
    if (!ok) failures++;
    console.log(`\n${name} (matrix): ${data.dots.length} dot, ${colors.length} colori distinti`);
    console.log(`  colori: ${colors.map(rgbStr).join(", ")}`);
    console.log(`  contrasto col bg: ${colors.map((c) => `${rgbStr(c)}=${contrast(c, bg).toFixed(1)}x`).join(", ")}`);
    console.log(`  trasparenti: ${transparent} | sotto 3:1: ${badContrast.length} | coppie confondibili (ΔE<10): ${pairwise.length}${pairwise.length ? " " + JSON.stringify(pairwise) : ""} | legenda: ${legendUndistinct ? "KO" : "ok"}`);
    console.log(`  ΔE minimo legenda: ${legendMinDE === 999 ? "n/a" : legendMinDE.toFixed(0)} | => ${ok ? "PASS" : "FAIL"}`);
  }
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
