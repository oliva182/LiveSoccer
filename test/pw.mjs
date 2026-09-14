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
await page.click('[data-act="back"]');
await page.waitForSelector(".view-tab", { timeout: 30000 });

// step 3-4: view Oggi/Calendario/Storico con giornate reali (Serie A selezionata sopra)
const viewTabs = await page.locator(".view-tab").count();
if (viewTabs < 3) fail(`view tabs Oggi/Calendario/Storico: ${viewTabs}/3`);

// Calendario: giornate future, la corrente aperta, collasso nativo <details>
await page.click('.view-tab:has-text("Calendario")');
await page.waitForSelector("details.giornata, .empty-msg", { timeout: 30000 });
const calGroups = page.locator("details.giornata");
const calCount = await calGroups.count();
console.log(`  Calendario: ${calCount} giornate`);
if (calCount < 1) fail("Calendario: nessuna giornata renderizzata");
else {
  if (!(await calGroups.first().evaluate((d) => d.open))) fail("Calendario: giornata corrente non aperta");
  const calTeams = await calGroups.first().locator(".day-row .dr-team span").allTextContents();
  if (!calTeams.some((t) => ["Inter", "Milan", "Juventus", "Napoli"].includes(t))) fail("Calendario: nessuna squadra nota nella giornata corrente");
  const before = await calGroups.first().evaluate((d) => d.open);
  await calGroups.first().locator("summary").click();
  const after = await calGroups.first().evaluate((d) => d.open);
  if (before === after) fail("Calendario: collasso giornata non funziona");
}

// Storico: risultati passati, giornata piu recente aperta
await page.click('.view-tab:has-text("Storico")');
await page.waitForSelector("details.giornata, .empty-msg", { timeout: 30000 });
const histGroups = page.locator("details.giornata");
const histCount = await histGroups.count();
console.log(`  Storico: ${histCount} giornate`);
if (histCount < 1) fail("Storico: nessuna giornata renderizzata");
else {
  const scores = await histGroups.first().locator(".day-row .dr-score").allTextContents();
  if (!scores.some((s) => /\d+\s*:/.test(s))) fail("Storico: nessun risultato (score) nelle giornate passate");
  const histTeams = await histGroups.first().locator(".day-row .dr-team span").allTextContents();
  if (!histTeams.some((t) => ["Inter", "Milan", "Juventus", "Napoli"].includes(t))) fail("Storico: nessuna squadra nota nelle giornate passate");
}

// regressione: aprire una partita passata dallo Storico (prima: "L'evento ESPN non è più disponibile")
{
  const hist = page.locator("details.giornata").first();
  await hist.locator(".day-row").first().click();
  await page.waitForSelector('.scoreboard, .panel h2:has-text("Errore")', { timeout: 30000 });
  if (!(await page.locator(".scoreboard").count())) fail("Storico: partita passata → 'evento non più disponibile'");
  else console.log("  Storico: partita passata aperta (scoreboard ok)");
  await page.click('[data-act="back"]');
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
