// Self-check: navigazione week (stessa logica di weekPanelHtml in index.html)
function nav(all, tk, weekSel) {
  let idx = weekSel ? all.findIndex((g) => g.key === weekSel) : all.findIndex((g) => g.key === tk);
  if (idx < 0) { idx = all.findIndex((g) => g.key > tk); if (idx < 0) idx = all.length; }
  const g = idx < all.length && all[idx].key === (weekSel || tk) ? all[idx] : null;
  return {
    g,
    prev: idx > 0 ? all[idx - 1] : null,
    next: g ? (idx + 1 < all.length ? all[idx + 1] : null) : (idx < all.length ? all[idx] : null),
  };
}
const W = (n) => ({ key: String(n).padStart(2, "0"), n });
let fails = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};
const K = (o) => (o ? o.key : null);

// 1. week corrente esiste
{
  const all = [W(1), W(2), W(3), W(4)];
  const r = nav(all, "02", null);
  t("1.g", K(r.g), "02"); t("1.prev", K(r.prev), "01"); t("1.next", K(r.next), "03");
}
// 2. week corrente vuota (pausa): prev = ultima passata, next = prima futura
{
  const all = [W(1), W(2), W(4), W(5)]; // settimana 3 in pausa
  const r = nav(all, "03", null);
  t("2.g", K(r.g), null); t("2.prev", K(r.prev), "02"); t("2.next", K(r.next), "04");
}
// 3. stagione finita (tutto passato)
{
  const all = [W(1), W(2), W(3)];
  const r = nav(all, "04", null);
  t("3.g", K(r.g), null); t("3.prev", K(r.prev), "03"); t("3.next", K(r.next), null);
}
// 4. inizio stagione (tutto futuro)
{
  const all = [W(2), W(3), W(4)];
  const r = nav(all, "01", null);
  t("4.g", K(r.g), null); t("4.prev", K(r.prev), null); t("4.next", K(r.next), "02");
}
// 5. weekSel esplicita (navigazione in-place)
{
  const all = [W(1), W(2), W(3)];
  const r = nav(all, "01", "03");
  t("5.g", K(r.g), "03"); t("5.prev", K(r.prev), "02"); t("5.next", K(r.next), null);
}
// 6. weekSel stallo (key non piu' presente) → non crash, nav coerente
{
  const all = [W(1), W(2)];
  const r = nav(all, "02", "99");
  t("6.g", K(r.g), null); t("6.prev", K(r.prev), "02"); t("6.next", K(r.next), null);
}
// ===== split turno infrasettimanale (stessa logica di seasonGroupsAll in index.html) =====
// Carry: il resto della week passa alla successiva; key = data prima partita (con -N su collisioni)
function groups(weeks, exp, todayStr) {
  const flat = [];
  const emit = (evs) => { const d0 = evs[0].date.slice(0, 10); let k = d0; for (let i = 2; flat.some((f) => f.key === k); i++) k = `${d0}-${i}`; flat.push({ key: k, evs }); };
  let carry = [];
  for (const [key, evs] of [...weeks].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
    if (!exp) { evs.sort((a, b) => String(a.date).localeCompare(String(b.date))); emit(evs); continue; }
    const pool = [...carry, ...evs].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    carry = [];
    while (pool.length > exp) emit(pool.splice(0, exp));
    carry = pool;
  }
  if (carry.length) emit(carry);
  const openIdx = flat.reduce((acc, g, i) => (g.evs[0].date.slice(0, 10) <= todayStr ? i : acc), -1);
  return flat.map((g, i) => ({ key: g.key, n: i + 1, evs: g.evs, open: i === openIdx }));
}
const M = (day, n) => Array.from({ length: n }, (_, j) => ({ date: `${day}T${14 + j}:00Z` }));
const days = (gs, k) => gs.find((g) => g.key === k).evs.map((e) => e.date.slice(0, 10));
const SAT = "2025-09-13", WED = "2025-09-17";

// 7. Serie A week 8 con 20 partite (sab+mer): si divide 10+10, key = data prima partita
{
  const gs = groups([["08", [...M(SAT, 10), ...M(WED, 10)]]], 10, WED);
  t("7.len", gs.length, 2);
  t("7.k1", gs[0].key, SAT); t("7.k2", gs[1].key, WED);
  t("7.n1", gs[0].n, 1); t("7.n2", gs[1].n, 2);
  t("7.d1", new Set(days(gs, SAT)).size, 1); t("7.d1day", days(gs, SAT)[0], SAT);
  t("7.d2day", days(gs, WED)[0], WED);
  t("7.cnt", gs.map((g) => g.evs.length), [10, 10]);
}
// 8. scalamento: week 1-7 normali, week 8 da 20 → si divide, week 9 torna a 10
{
  const weeks = [];
  for (let w = 1; w <= 7; w++) weeks.push([String(w).padStart(2, "0"), M(`2025-08-${String(w).padStart(2, "0")}`, 10)]);
  weeks.push(["08", [...M(SAT, 10), ...M(WED, 10)]]);
  weeks.push(["09", M("2025-09-20", 10)]);
  const gs = groups(weeks, 10, WED);
  t("8.len", gs.length, 10);
  t("8.n", gs.map((g) => g.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  t("8.firsts", gs.map((g) => g.evs[0].date.slice(0, 10)), ["2025-08-01", "2025-08-02", "2025-08-03", "2025-08-04", "2025-08-05", "2025-08-06", "2025-08-07", SAT, WED, "2025-09-20"]);
  t("8.cnt", gs.map((g) => g.evs.length), [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
}
// 9. Bundesliga/Ligue 1: 18 squadre → 9 partite per week, week da 18 si divide 9+9
{
  const gs = groups([["08", [...M(SAT, 9), ...M(WED, 9)]]], 9, WED);
  t("9.cnt", gs.map((g) => g.evs.length), [9, 9]);
}
// 10. week normale (10 partite, Serie A) → non si divide
{
  const gs = groups([["08", M(SAT, 10)]], 10, SAT);
  t("10.len", gs.length, 1); t("10.key", gs[0].key, SAT);
}
// 11. coppe (senza exp) → mai divise
{
  const gs = groups([["08", M(SAT, 12)]], 0, SAT);
  t("11.len", gs.length, 1); t("11.cnt", gs[0].evs.length, 12);
}
// 12. open: oggi = mercoledi' → parte 2; oggi = sabato → parte 1
{
  const wk = [["08", [...M(SAT, 10), ...M(WED, 10)]]];
  t("12.openWed", groups(wk, 10, WED).find((g) => g.open).key, WED);
  t("12.openSat", groups(wk, 10, SAT).find((g) => g.open).key, SAT);
}
// 13. Ligue 1/Bundesliga: week da 9+1 (giovedì) e week da 8 → carry, sempre 9/giornata, mai 35
{
  const d1 = "2026-08-22", d2 = "2026-08-29", d3 = "2026-09-03", d4 = "2026-09-05", d5 = "2026-09-12";
  const weeks = [["01", M(d1, 9)], ["02", [...M(d2, 9), ...M(d3, 1)]], ["03", M(d4, 8)], ["04", M(d5, 9)]];
  const gs = groups(weeks, 9, d4);
  t("13.len", gs.length, 4);
  t("13.cnt", gs.map((g) => g.evs.length), [9, 9, 9, 9]);
  t("13.g2pure", new Set(gs[1].evs.map((e) => e.date.slice(0, 10))).size, 1); // g2 = solo le 9 di d2
  t("13.g3first", gs[2].evs[0].date.slice(0, 10), d3); // g3 = 1 carry (giovedì) + 8
  t("13.g3days", gs[2].evs.map((e) => e.date.slice(0, 10)).filter((d) => d === d3).length, 1);
}
// 14. pausa (week vuota) → il carry passa dritto, nessun gruppo fantasma
{
  const gs = groups([["01", M("2025-08-01", 9)], ["02", []], ["03", M("2025-08-15", 9)]], 9, "2025-08-15");
  t("14.len", gs.length, 2);
  t("14.cnt", gs.map((g) => g.evs.length), [9, 9]);
  t("14.firsts", gs.map((g) => g.evs[0].date.slice(0, 10)), ["2025-08-01", "2025-08-15"]);
}
if (fails) { console.log(`${fails} FAIL`); process.exit(1); }
console.log("ALL OK");
