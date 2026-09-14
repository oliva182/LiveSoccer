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

// ogni tab apre una giornata senza crash, e i dati ESPN arrivano davvero (scoreboard + classifica via CLI)
let totalMatches = 0;
for (const label of tabs) {
  await page.click(`.lg-tab:has-text("${label}")`);
  await page.waitForSelector(".day-row, .empty-msg", { timeout: 30000 });
  await page.waitForTimeout(1200);
  const matches = await page.$$eval(".day-row", (els) => els.length);
  const clsRows = await page.$$eval("table.cls tbody tr", (trs) => trs.length);
  console.log(`  ${label}: ${matches} partite, ${clsRows} righe classifica`);
  totalMatches += matches; // ok se 0: oggi la lega potrebbe non giocare
  if (!clsRows) fail(`${label}: classifica vuota`);
}
if (!totalMatches) fail("nessuna partita caricata in nessuna lega");

// route summary: apri una partita — il view della partita deve rendersi senza errori
const port = server.address().port;
{
  const sb = await (await fetch(`http://127.0.0.1:${port}/api/apis/site/v2/sports/soccer/ita.1/scoreboard?dates=${new Date().toISOString().slice(0, 10).replace(/-/g, "")}&limit=5`)).json();
  const ev = (sb.events || [])[0];
  if (!ev) fail("summary: nessuna partita ita.1 per il probe");
  else {
    const sum = await (await fetch(`http://127.0.0.1:${port}/api/apis/site/v2/sports/soccer/ita.1/summary?event=${ev.id}`)).json();
    if (!sum.boxscore && !sum.keyEvents) fail("summary: payload senza boxscore né keyEvents");
    console.log(`  summary probe: event ${ev.id} → boxscore=${!!sum.boxscore} keyEvents=${(sum.keyEvents || []).length}`);
  }
}
await page.click('.lg-tab:has-text("Serie A")');
await page.waitForSelector(".day-row", { timeout: 30000 });
await page.click(".day-row");
await page.waitForSelector(".scoreboard", { timeout: 30000 });
console.log("  view partita: scoreboard renderizzato");

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

// un 404 (es. favicon) non deve uccidere il server
{
  const a = await fetch(`http://127.0.0.1:${server.address().port}/nope-404`);
  const b = await fetch(`http://127.0.0.1:${server.address().port}/`);
  if (a.status !== 404 || b.status !== 200) fail(`server morto dopo 404 (404=${a.status}, follow-up=${b.status})`);
}

const realErrors = consoleErrors.filter((t) => !/net::|Failed to load resource/i.test(t));
if (realErrors.length) fail("console errors: " + realErrors.slice(0, 3).join(" ;; "));

await browser.close();
server.close();
console.log(failures ? `\n${failures} FAILURES` : "\nALL GREEN");
process.exit(failures ? 1 : 0);
