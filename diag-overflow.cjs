const { chromium } = require("C:/Users/oliva/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright");
const W = Number(process.argv[2] || 375);
const STATE = process.argv[3] || "esp1";
const URL = "file:///E:/Download/IA/test/prova/qwen3.8_v2/index.html";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: W, height: 812 } });
  await p.goto(URL);
  if (STATE === "esp1") {
    await p.evaluate(() => { S.view = "oggi"; S.weekSel = null; switchLeague("esp.1"); });
    await p.waitForSelector(".day-row", { timeout: 60000 });
  }
  const info = await p.evaluate((W) => {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.right > W + 1) out.push(el.tagName + "." + String(el.className).slice(0, 50) + " right=" + Math.round(r.right) + " w=" + Math.round(r.width) + " (" + String(el.textContent || "").trim().slice(0, 24) + ")");
    }
    return { sw: document.documentElement.scrollWidth, items: out.slice(0, 30) };
  }, W);
  console.log(JSON.stringify(info, null, 1));
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
