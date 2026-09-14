// Scratch: screenshot tabella classifica ×3 temi ×3 leghe (verifica before/after)
const { chromium } = require("C:/Users/oliva/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright");
const path = require("path");

const OUT = process.argv[2] || "shots";
const ASSERT = process.argv.includes("--assert");
const LEAGUES = [["ita.1", "Serie A", "ita1"], ["eng.1", "Premier League", "eng1"], ["fra.1", "Ligue 1", "fra1"]];
const THEMES = ["stadio", "cartoon", "sketch"];
const URL = "file:///E:/Download/IA/test/prova/qwen3.8_v2/index.html";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
  await page.goto(URL);
  for (const [slug, name, tag] of LEAGUES) {
    await page.evaluate((s) => switchLeague(s), slug);
    await page.waitForSelector(`h2:has-text("Classifica · ${name}")`, { timeout: 30000 });
    await page.waitForSelector("table.cls tbody tr", { timeout: 30000 });
    await page.evaluate(() => { const w = document.querySelector(".tbl-wrap"); if (w) { w.style.maxHeight = "none"; w.style.overflow = "visible"; } });
    for (const th of THEMES) {
      await page.evaluate((t) => setTheme(t), th);
      await page.locator("section.panel").filter({ hasText: `Classifica · ${name}` })
        .screenshot({ path: path.join(OUT, `${tag}_${th}.png`) });
    }
  }
  if (ASSERT) {
    // invariante: nessun dot trasparente (bug "##color" ESPN sanificato)
    await page.evaluate(() => switchLeague("eng.1"));
    await page.waitForSelector("table.cls tbody tr", { timeout: 30000 });
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll("table.cls .zone-dot")]
        .filter((d) => getComputedStyle(d).backgroundColor === "rgba(0, 0, 0, 0)").length);
    console.log(bad === 0 ? "PASS nessun dot trasparente (eng.1)" : `FAIL ${bad} dot trasparenti`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
