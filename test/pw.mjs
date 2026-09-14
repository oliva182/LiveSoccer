import { chromium } from "playwright";
import { start } from "../server.mjs";

// stesso server dell'uso reale: static + proxy ESPN (porta 0 = casuale per i test)
const server = await start(0);
const page_url = `http://127.0.0.1:${server.address().port}/index.html`;

const expectedTabs = 8; // 3 europee + Serie A + Big 5 domestiche (step 1)
let failures = 0;
const fail = (msg) => { failures++; console.error("  FAIL:", msg); };

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

console.log("smoke: apri index.html");
await page.goto(page_url, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".lg-tab, .empty-msg", { timeout: 30000 });
await page.waitForTimeout(2500); // lascia finire i fetch ESPN

const tabs = await page.$$eval(".lg-tab", (ts) => ts.map((t) => t.textContent.trim()));
console.log("  tab leghe:", tabs.join(" | "));
if (tabs.length !== expectedTabs) fail(`attese ${expectedTabs} tab, trovate ${tabs.length}`);

// ogni tab apre una giornata senza crash
for (const label of tabs) {
  await page.click(`.lg-tab:has-text("${label}")`);
  await page.waitForTimeout(1200);
}

// tab Calendario/Storico (step 3-4)
for (const view of ["Calendario", "Storico"]) {
  const btn = page.locator(`.lg-tab:has-text("${view}")`);
  if (await btn.count()) {
    await btn.first().click();
    await page.waitForTimeout(1500);
    const days = await page.$$eval(".day-group", (g) => g.length);
    console.log(`  ${view}: ${days} giornate`);
    if (!days) fail(`tab ${view} non mostra giornate`);
  } else {
    console.log(`  ${view}: tab non presente (ok se prima step 3/4)`);
  }
}

const realErrors = consoleErrors.filter((t) => !/net::|Failed to load resource/i.test(t));
if (realErrors.length) fail("console errors: " + realErrors.slice(0, 3).join(" ;; "));

await browser.close();
server.close();
console.log(failures ? `\n${failures} FAILURES` : "\nALL GREEN");
process.exit(failures ? 1 : 0);
