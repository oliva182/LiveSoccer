// Audit responsive: verifica coerenza desktop/mobile — nessun overflow orizzontale,
// nessun testo tagliato, elementi chiave visibili. Uso: node responsive.cjs [outDir] [--shots]
const { chromium } = require("C:/Users/oliva/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright");
const path = require("path");
const fs = require("fs");

const OUT = process.argv[2] || "shots-resp";
const SHOT = process.argv.includes("--shots");
const URL = "file:///E:/Download/IA/test/prova/qwen3.8_v2/index.html";

const VIEWPORTS = [
  { name: "m375", width: 375, height: 812 },
  { name: "m414", width: 414, height: 896 },
  { name: "t768", width: 768, height: 1024 },
  { name: "d1280", width: 1280, height: 900 },
  { name: "d1440", width: 1440, height: 900 },
];

// stati applicabili con evaluate (funzioni globali dell'app)
const STATES = [
  {
    name: "landing-esp1",
    apply: () => { S.view = "oggi"; S.weekSel = null; switchLeague("esp.1"); },
    wait: ".day-row",
    waitExtra: "table.cls tbody tr",
    need: [".lg-tabs", ".wk-nav", ".day-row", "table.cls tbody tr", ".foot"],
  },
  {
    name: "landing-cup",
    apply: () => { S.view = "oggi"; S.weekSel = null; switchLeague("uefa.europa"); },
    wait: ".day-row",
    need: [".lg-tabs", ".view-tab", ".day-row", ".foot"],
  },
  {
    name: "landing-cal",
    apply: () => { S.view = "cal"; S.weekSel = null; switchLeague("ita.1"); },
    wait: "details.giornata",
    after: () => document.querySelector("details.giornata").open = true,
    need: [".giornata", ".day-row", ".foot"],
  },
  {
    name: "match",
    async: true,
    need: [".scoreboard", ".status-pill", "section.panel", ".foot"],
  },
];

// elementi che per design scorrono/scrollano (esclusi dal controllo di clipping)
const SCROLL_OK = (el) => {
  const cs = getComputedStyle(el);
  return /(auto|scroll)/.test(cs.overflowX + cs.overflowY);
};
// elementi con ellissi di design
const ELLIPSIS_OK = (el) => !!el.closest("td.team-cell, .pname, .highlight-item, .highlight-title, .team .name");

async function auditPage(page, label) {
  const issues = [];
  const ovf = await page.evaluate(() => {
    const de = document.documentElement;
    return { sw: de.scrollWidth, cw: de.clientWidth, bw: document.body.scrollWidth };
  });
  if (ovf.sw > ovf.cw) issues.push(`overflow orizzontale: scrollWidth ${ovf.sw} > clientWidth ${ovf.cw}`);
  const clipped = await page.evaluate(({ scrollSrc, ellSrc }) => {
    const scrollOk = eval("(" + scrollSrc + ")");
    const ellOk = eval("(" + ellSrc + ")");
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      if (scrollOk(el) || ellOk(el)) continue;
      if (el.scrollWidth - el.clientWidth > 2 && el.scrollWidth > 0 && el.children.length === 0) {
        out.push(`${el.tagName}.${el.className?.toString().slice(0, 40)}: sw=${el.scrollWidth} cw=${el.clientWidth} ("${String(el.textContent || "").slice(0, 28)}")`);
      }
    }
    return out.slice(0, 12);
  }, { scrollSrc: String(SCROLL_OK), ellSrc: String(ELLIPSIS_OK) });
  if (clipped.length) issues.push("testo tagliato: " + clipped.join(" | "));
  return issues;
}

async function checkNeed(page, s) {
  const missing = [];
  for (const sel of s.need) {
    const ok = await page.evaluate((sel) => {
      const els = [...document.querySelectorAll(sel)];
      return els.some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    }, sel);
    if (!ok) missing.push(sel);
  }
  return missing;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  let failures = 0;
  for (const vp of VIEWPORTS) {
    for (const s of STATES) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.goto(URL);
      if (s.async) {
        // apre una partita IN CORSO (max dati: stats/formazioni/eventi/highlights)
        await page.evaluate(() => { S.view = "oggi"; S.weekSel = null; switchLeague("uefa.europa"); });
        await page.waitForSelector(".day-row[data-match]", { timeout: 60000 });
        const id = await page.evaluate(() =>
          [...document.querySelectorAll(".day-row[data-match]")].find((r) => (r.querySelector(".st.live") ? true : false))?.dataset.match
          || document.querySelector(".day-row[data-match]")?.dataset.match);
        if (!id) { await page.close(); continue; }
        await page.evaluate((id) => openMatch(id), id);
        await page.waitForSelector(".scoreboard", { timeout: 60000 });
        await page.waitForTimeout(3000); // lascia partire summary (stats/formazioni/eventi)
      } else {
        await page.evaluate(s.apply);
        await page.waitForSelector(s.wait, { timeout: 60000 });
        if (s.waitExtra) await page.waitForSelector(s.waitExtra, { timeout: 60000 });
        if (s.after) await page.evaluate(s.after);
      }
      const issues = await auditPage(page, vp.name + s.name);
      const missing = await checkNeed(page, s);
      if (missing.length) issues.push("manca/non visibile: " + missing.join(", "));
      if (SHOT) await page.screenshot({ path: path.join(OUT, `${vp.name}_${s.name}.png`), fullPage: true });
      const status = issues.length ? "FAIL" : "PASS";
      if (issues.length) failures++;
      console.log(`[${status}] ${vp.name} (${vp.width}px) · ${s.name}`);
      for (const i of issues) console.log(`    - ${i}`);
      await page.close();
    }
  }
  await browser.close();
  console.log(failures ? `\n${failures} combinazioni con problemi` : "\nTUTTO PASS");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
