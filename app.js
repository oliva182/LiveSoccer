"use strict";
/* ===== Calcio Live — dashboard live ESPN Soccer (vanilla JS, no deps) ===== */
const LEAGUES = [
  { slug: "uefa.champions", name: "Champions League" },
  { slug: "uefa.europa", name: "Europa League" },
  { slug: "uefa.europa.conf", name: "Conference League" },
  { slug: "ita.1", name: "Serie A" },
  { slug: "eng.1", name: "Premier League" },
  { slug: "esp.1", name: "La Liga" },
  { slug: "ger.1", name: "Bundesliga" },
  { slug: "fra.1", name: "Ligue 1" },
];
const STANDINGS_TTL = 15 * 60 * 1000;
// stesso origin: server.mjs proxy /api/* → site.api.espn.com (il WAF ESPN blocca i client browser)
const BASE = (slug) => `/api/apis/site/v2/sports/soccer/${slug}`;
const STANDINGS_URL = (slug) => `/api/apis/v2/sports/soccer/${slug}/standings`;
const SS_EVENT = "cldash_espn_event_id", SS_SPORT = "cldash_espn_sport", SS_LEAGUE = "cldash_espn_league", SS_THEME = "cldash_theme";
const GONE_MSG = "L'evento ESPN non è più disponibile.";
const OFFSETS = [0, -1, 1, -2, 2];

const S = {
  matchId: null, sport: null, league: LEAGUES[0].slug,
  match: null, summary: null, stats: null, standings: null,
  pollMs: 60000, calls: 0, lastUpdated: null, error: null, lastScore: null,
  events: [], dayOffset: 0, landingReady: false,
};
let pollTimer = null, cdTimer = null;

/* ===== utils ===== */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const el = (id) => document.getElementById(id);
const validLeag = (slug) => LEAGUES.some((l) => l.slug === slug) ? slug : null;
const leagueName = (slug) => (LEAGUES.find((l) => l.slug === slug) || {}).name || "";
const ssGet = (k) => { try { return sessionStorage.getItem(k); } catch (_) { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch (_) {} };
const ssDel = (k) => { try { sessionStorage.removeItem(k); } catch (_) {} };
const isNum = (v) => typeof v === "number" && isFinite(v);
const numOrNull = (v) => (v == null || v === "" ? null : isFinite(Number(v)) ? Number(v) : null);

async function apiGet(url) {
  S.calls++;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`ESPN HTTP ${r.status}`);
  return r.json();
}
const dateStr = (off) => { const d = new Date(Date.now() + off * 864e5); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`; };
const kickoffTime = (d) => new Date(d).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

/* ===== temi (extra rispetto alla spec §13.1) ===== */
const THEMES = [
  { slug: "stadio", label: "Stadio" },
  { slug: "cartoon", label: "Cartoon" },
  { slug: "sketch", label: "Sketch" },
];
function currentTheme() { return THEMES.some((t) => t.slug === ssGet(SS_THEME)) ? ssGet(SS_THEME) : "stadio"; }
function setTheme(t) { document.documentElement.dataset.theme = t; ssSet(SS_THEME, t); const s = el("themeSel"); if (s) s.value = t; }

/* ===== caricamento dati (§6-§8) ===== */
async function fetchDay(slug, offset) {
  const data = await apiGet(`${BASE(slug)}/scoreboard?dates=${dateStr(offset)}&limit=100`);
  return { lg: slug, events: data.events || [] };
}

async function findEvent(id) {
  for (const off of OFFSETS) {
    const groups = await Promise.all(LEAGUES.map((l) => fetchDay(l.slug, off).catch(() => ({ lg: l.slug, events: [] }))));
    for (const g of groups) {
      const ev = g.events.find((e) => String(e.id) === String(id));
      if (ev) return { event: ev, offset: off, slug: g.lg };
    }
  }
  return null;
}

async function loadLanding() {
  const day = await fetchDay(S.league, 0);
  let entries = [];
  const c = S.standings;
  if (c && c.slug === S.league && Date.now() - c.at < STANDINGS_TTL) entries = c.entries;
  else {
    try {
      const st = await apiGet(STANDINGS_URL(S.league));
      entries = (st.children?.[0]?.standings?.entries) || [];
      S.standings = { slug: S.league, at: Date.now(), entries };
    } catch (_) { /* §12: errore classifica ignorato */ }
  }
  S.events = [day];
  S.dayOffset = 0;
  S.landingReady = true;
  S.lastUpdated = new Date();
}

async function loadMatch() {
  const found = await findEvent(S.matchId);
  if (!found) throw new Error(GONE_MSG);
  S.match = found.event;
  S.dayOffset = found.offset;
  if (found.slug) {
    S.sport = found.slug; S.league = found.slug;
    ssSet(SS_SPORT, found.slug); ssSet(SS_LEAGUE, found.slug);
  }
}

async function loadSummary() {
  const data = await apiGet(`${BASE(S.sport || S.league)}/summary?event=${encodeURIComponent(S.matchId)}`);
  S.summary = data;
  S.stats = normalizeStats(data.boxscore);
}

/* §8.1 */
function normalizeStats(box) {
  const rows = box?.teams || (box?.team ? [box.team] : null);
  if (!rows || !rows.length) return null;
  return rows.map((row) => {
    const st = row.statistics || row.stats || [];
    const findVal = (names) => {
      for (const n of names) {
        const s = st.find((x) => (x.name || x.label || "").toLowerCase() === n.toLowerCase());
        if (s != null) return numOrNull(s.displayValue ?? s.value);
      }
      return null;
    };
    const possession = findVal(["possessionPct", "possession", "ball possession"]);
    const shots = findVal(["totalShots", "shots", "total shots"]);
    const onTarget = findVal(["shotsOnTarget", "shots on target", "shots on goal"]);
    const blocked = findVal(["blockedShots", "blocked shots"]);
    const corners = findVal(["wonCorners", "corner kicks", "corners"]);
    const fouls = findVal(["foulsCommitted", "fouls"]);
    const offsides = findVal(["offsides"]);
    const yellow = findVal(["yellowCards", "yellow cards"]);
    let offTarget = null;
    if (isNum(shots) && isNum(onTarget)) offTarget = Math.max(0, shots - onTarget - (blocked || 0));
    return { team: row.team || {}, possession, shots, onTarget, offTarget, corners, fouls, offsides, yellow };
  });
}

const friendlyErr = (e) => e instanceof TypeError && location.protocol === "file:" ? "Apri http://localhost:8080 (avvia prima: npm start) — l'app non funziona da file://." : e instanceof TypeError ? "Errore di rete verso ESPN." : String(e?.message || e);

async function apply() {
  try {
    if (S.matchId) await Promise.all([loadMatch(), loadSummary()]);
    else await loadLanding();
    S.error = null;
    S.lastUpdated = new Date();
  } catch (e) {
    S.error = friendlyErr(e);
  }
  render();
}

async function boot() {
  stopTimers();
  const urlEv = new URLSearchParams(location.search).get("event");
  if (urlEv) ssSet(SS_EVENT, urlEv);
  S.matchId = ssGet(SS_EVENT) || null;
  S.sport = validLeag(ssGet(SS_SPORT));
  S.league = validLeag(ssGet(SS_LEAGUE)) || LEAGUES[0].slug;
  render();
  if (S.matchId) {
    const found = await findEvent(S.matchId).catch(() => null);
    if (!found) { ssDel(SS_EVENT); S.matchId = null; }
    else {
      S.match = found.event; S.dayOffset = found.offset;
      if (found.slug) { S.sport = found.slug; S.league = found.slug; ssSet(SS_SPORT, found.slug); ssSet(SS_LEAGUE, found.slug); }
      try { await loadSummary(); } catch (e) { S.error = friendlyErr(e); }
      S.lastUpdated = new Date();
    }
  }
  if (!S.matchId && !S.landingReady) { try { await loadLanding(); S.error = null; } catch (e) { S.error = friendlyErr(e); } }
  startTimers();
  render();
}

/* ===== timer ===== */
function stopTimers() { if (pollTimer) clearInterval(pollTimer); if (cdTimer) clearInterval(cdTimer); pollTimer = cdTimer = null; }
function startTimers() {
  stopTimers();
  pollTimer = setInterval(poll, S.pollMs);
  cdTimer = setInterval(tickCountdown, 1000);
}

async function poll() { await apply(); }

/* ===== render LANDING (§9) ===== */
function tabsHtml() {
  return `<div class="lg-tabs">${LEAGUES.map((l) => `<button type="button" class="lg-tab${S.league === l.slug ? " active" : ""}" data-league="${esc(l.slug)}">${esc(l.name)}</button>`).join("")}</div>`;
}

function dayRowHtml(ev) {
  const comp = ev.competitions?.[0];
  const home = comp?.competitors?.find((c) => c.homeAway === "home");
  const away = comp?.competitors?.find((c) => c.homeAway === "away");
  const st = comp?.status?.type || {};
  const date = ev.date ? new Date(ev.date) : null;
  const liveClock = st.state === "in" && st.displayClock ? ` · ${esc(st.displayClock)}` : "";
  let statusBadge, scoreCell;
  if (st.state === "in") { statusBadge = `<span class="st live">In corso${liveClock}</span>`; scoreCell = `${home?.score ?? 0} : ${away?.score ?? 0}`; }
  else if (st.state === "post") { statusBadge = `<span class="st">Finale</span>`; scoreCell = `${home?.score ?? 0} : ${away?.score ?? 0}`; }
  else { statusBadge = `<span class="st">${date ? esc(kickoffTime(date)) : ""}</span>`; scoreCell = date ? esc(kickoffTime(date)) : ""; }
  const teamLine = (c) => `<div class="dr-team">${c?.team?.logo ? `<img src="${esc(c.team.logo)}" alt="">` : ""}<span>${esc(c?.team?.displayName || "?")}</span></div>`;
  return `<div class="day-row" role="button" tabindex="0" data-match="${esc(String(ev.id))}">
    <div class="dr-score">${scoreCell}</div>
    <div class="dr-teams">${teamLine(home)}${teamLine(away)}</div>
    <div class="dr-status">${statusBadge}</div>
  </div>`;
}

function dayPanelHtml() {
  const group = (S.events.find((g) => g.lg === S.league)) || { events: [] };
  const events = [...group.events].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!events.length) return `<section class="panel"><h2>Partite di oggi · ${esc(leagueName(S.league))}</h2><p class="empty-msg">Spiacente, nessun match oggi!</p></section>`;
  return `<section class="panel"><h2>Partite di oggi · ${esc(leagueName(S.league))}</h2><div class="day-list">${events.map(dayRowHtml).join("")}</div></section>`;
}

function statVal(entry, name) {
  const s = (entry.stats || []).find((x) => x.name === name);
  return s ? s.displayValue : null;
}
function zoneOf(entry) {
  const d = entry.note?.description || "";
  return { desc: d, color: d === "Knockout phase playoffs - seeded" ? "#FF9E2C" : (entry.note?.color || "") };
}

function standingsPanelHtml() {
  let entries = S.standings && S.standings.slug === S.league ? S.standings.entries : null;
  if (!entries || !entries.length) return `<section class="panel"><h2>Classifica · ${esc(leagueName(S.league))}</h2><p class="muted">Classifica non disponibile al momento.</p></section>`;
  entries = [...entries].sort((a, b) => (numOrNull(statVal(a, "rank")) || 0) - (numOrNull(statVal(b, "rank")) || 0));
  const zones = [];
  for (const e of entries) { const z = zoneOf(e); if (z.desc && !zones.some((x) => x.desc === z.desc)) zones.push(z); }
  const legend = zones.length ? `<div class="zone-legend">${zones.map((z) => `<span><i class="zone-dot" style="background:${esc(z.color)}"></i>${esc(z.desc)}</span>`).join("")}</div>` : "";
  const rows = entries.map((e, i) => {
    const t = e.team || {}; const z = zoneOf(e);
    return `<tr><td><i class="zone-dot" style="background:${esc(z.color)}"></i>${i + 1}</td>
      <td class="team-cell" title="${esc(t.name || "")}">${esc(t.shortDisplayName || t.name || "?")}</td>
      <td>${esc(statVal(e, "gamesPlayed") ?? "")}</td><td>${esc(statVal(e, "wins") ?? "")}</td>
      <td>${esc(statVal(e, "ties") ?? "")}</td><td>${esc(statVal(e, "losses") ?? "")}</td>
      <td>${esc(statVal(e, "pointDifferential") ?? "")}</td><td class="pts">${esc(statVal(e, "points") ?? "")}</td></tr>`;
  }).join("");
  return `<section class="panel"><h2>Classifica · ${esc(leagueName(S.league))}</h2>${legend}
    <div class="tbl-wrap"><table class="cls"><thead><tr><th>#</th><th>Squadra</th><th>G</th><th>V</th><th>N</th><th>P</th><th>DR</th><th>Pt</th></tr></thead>
    <tbody>${rows}</tbody></table></div></section>`;
}

function bootPanelHtml() {
  if (S.error) return `<section class="panel"><h2>Errore</h2><p style="color:var(--bad);line-height:1.5">${esc(S.error)}</p><button type="button" data-act="retry">Riprova</button></section>`;
  const msg = S.matchId ? "Apertura dashboard…" : "Caricamento partite e classifica dal feed ESPN…";
  return `<section class="panel"><h2>Avvio</h2><p class="muted">${esc(msg)}</p></section>`;
}

function errBannerHtml() { return S.error ? `<div class="err">Ultimo aggiornamento fallito: ${esc(S.error)}</div>` : ""; }

function footerHtml() {
  const opts = [30, 60, 120, 180].map((v) => `<option value="${v}"${S.pollMs === v * 1000 ? " selected" : ""}>${v}s</option>`).join("");
  const themeOpts = THEMES.map((t) => `<option value="${esc(t.slug)}"${currentTheme() === t.slug ? " selected" : ""}>${esc(t.label)}</option>`).join("");
  const upd = S.lastUpdated ? new Date(S.lastUpdated).toLocaleTimeString("it-IT") : "–";
  return `<div class="foot">
    <span>Fonte: ESPN Soccer</span>
    <span>Aggiornamento: ${esc(upd)}</span>
    <select id="ivl" aria-label="Intervallo aggiornamento">${opts}</select>
    <b>Chiamate: ${S.calls}</b>
    <select id="themeSel" aria-label="Tema">${themeOpts}</select>
    <button type="button" id="resetBtn" style="width:auto;margin:0;padding:5px 12px;font-size:.75rem">reset</button>
  </div>`;
}

function renderLanding() {
  let h = tabsHtml();
  if (!S.landingReady) h += bootPanelHtml();
  else { h += dayPanelHtml() + standingsPanelHtml() + (S.landingReady ? errBannerHtml() : ""); }
  h += footerHtml();
  return h;
}

/* ===== render PARTITA (§10) ===== */
function matchStatus() {
  const comp = S.match?.competitions?.[0];
  const st = comp?.status?.type || S.match?.status?.type || {};
  const label = st.detail || st.shortDetail || st.state || "Stato sconosciuto";
  const live = st.state === "in" || (/live|half|intermission|postponed/i.test(label) && !/final/i.test(label));
  return { state: st.state, label, clock: st.displayClock, live };
}

function highlightColHtml(teamId, teamName, homeId, keyEvents) {
  const evs = (keyEvents || []).filter((ev) => ev.team && String(ev.team.id) === String(teamId) && /goal|yellow-card|red-card/i.test(String(ev.type?.type || "")));
  if (!evs.length) return `<div class="highlight-team"><div class="highlight-title">${esc(teamName)}</div></div>`;
  const iconFor = (t) => (t.includes("red-card") ? "🟥" : t.includes("yellow-card") ? "🟨" : "⚽");
  const items = evs.map((ev) => {
    const t = String(ev.type?.type || "").toLowerCase();
    const p = ev.participants?.[0];
    const author = p?.athlete?.displayName || (ev.shortText || "").replace(/\s*(Goal|Yellow Card|Red Card)$/i, "") || "Evento";
    return `<div class="highlight-item"><b>${esc(ev.clock?.displayValue || "–")}</b>${iconFor(t)} ${esc(author)}</div>`;
  }).join("");
  return `<div class="highlight-team${teamId !== homeId ? " away" : ""}"><div class="highlight-title">${esc(teamName)}</div>${items}</div>`;
}

function highlightsHtml() {
  const comp = S.match?.competitions?.[0];
  if (!comp) return "";
  const home = comp.competitors.find((c) => c.homeAway === "home");
  const away = comp.competitors.find((c) => c.homeAway === "away");
  const ke = S.summary?.keyEvents || [];
  if (!ke.some((ev) => ev.team && String(ev.type?.type || "").toLowerCase() === "goal" || /-(card)/i.test(String(ev.type?.type || "")))) return "";
  const hn = home?.team?.shortDisplayName || home?.team?.displayName || "";
  const an = away?.team?.shortDisplayName || away?.team?.displayName || "";
  return `<div class="match-highlights">${highlightColHtml(home?.team?.id, hn, home?.team?.id, ke)}${highlightColHtml(away?.team?.id, an, home?.team?.id, ke)}</div>`;
}

function scoreboardHtml() {
  const comp = S.match.competitions[0];
  const home = comp.competitors.find((c) => c.homeAway === "home");
  const away = comp.competitors.find((c) => c.homeAway === "away");
  const stt = matchStatus();
  const flash = S.lastScore && S.lastScore !== `${home?.score ?? "–"} : ${away?.score ?? "–"}`;
  S.lastScore = `${home?.score ?? "–"} : ${away?.score ?? "–"}`;
  const teamCol = (c) => `<div class="team">${c?.team?.logo ? `<img src="${esc(c.team.logo)}" alt="">` : ""}<span class="name">${esc(c?.team?.displayName || "?")}</span></div>`;
  return `<div class="scoreboard${stt.live ? " live" : ""}">
    ${teamCol(home)}
    <div class="score-mid">
      <div class="score-line${flash ? " flash-score" : ""}">${home?.score ?? "–"} : ${away?.score ?? "–"}</div>
      <div class="status-pill"><span class="dot"></span>${esc(stt.label)}${stt.clock ? ` · ${esc(stt.clock)}` : ""}</div>
      ${highlightsHtml()}
    </div>
    ${teamCol(away)}
  </div>`;
}

function countdownHtml() {
  const stt = matchStatus();
  if (!S.match.date || stt.live || /final|cancel|postpon/i.test(stt.label)) return "";
  const diff = new Date(S.match.date).getTime() - Date.now();
  if (diff <= 0) return "";
  const d = Math.floor(diff / 864e5), h = Math.floor(diff / 36e5) % 24, m = Math.floor(diff / 6e4) % 60, s = Math.floor(diff / 1000) % 60;
  const box = (v, l, u) => `<div><div class="cd-num" data-u="${u}">${String(v).padStart(2, "0")}</div><div class="cd-lbl">${esc(l)}</div></div>`;
  return `<section class="panel"><div class="countdown">
    ${d > 0 ? box(d, "giorni", "d") : ""}${box(h, "ore", "h")}${box(m, "minuti", "m")}${box(s, "secondi", "s")}
  </div><div style="margin-top:18px;color:var(--dim)">Fischio d'inizio: ${esc(new Date(S.match.date).toLocaleString("it-IT"))}</div></section>`;
}

function statsPanelHtml() {
  const comp = S.match?.competitions?.[0];
  const homeId = comp?.competitors?.find((c) => c.homeAway === "home")?.team?.id;
  const awayId = comp?.competitors?.find((c) => c.homeAway === "away")?.team?.id;
  if (!S.stats || !S.stats.length) return `<section class="panel"><h2>Statistiche live</h2><p class="muted">Statistiche non ancora disponibili dal feed ESPN.</p></section>`;
  const hr = S.stats.find((r) => String(r.team?.id) === String(homeId)) || S.stats[0];
  const ar = S.stats.find((r) => String(r.team?.id) === String(awayId)) || (S.stats.length > 1 ? S.stats[1] : S.stats[0]);
  const rowsDef = [
    ["Possesso palla", "possession", true], ["Tiri totali", "shots"], ["Tiri in porta", "onTarget"],
    ["Tiri fuori", "offTarget"], ["Angoli", "corners"], ["Falli", "fouls"], ["Fuorigioco", "offsides"], ["Gialli", "yellow"],
  ];
  const fmt = (v, pct) => v == null ? "–" : (pct ? `${v}%` : String(v));
  const rowHtml = ([label, key, pct]) => {
    const hv = hr[key], av = ar[key];
    const tot = (isNum(hv) ? hv : 0) + (isNum(av) ? av : 0);
    const total = tot > 0 ? tot : 1;
    const wl = isNum(hv) ? (hv / total * 50).toFixed(2) + "%" : "0%";
    const wr = isNum(av) ? (av / total * 50).toFixed(2) + "%" : "0%";
    return `<div class="stat-row"><div class="lbl"><b>${esc(fmt(hv, pct))}</b><span>${esc(label)}</span><b>${esc(fmt(av, pct))}</b></div>
      <div class="bar"><div class="l" style="width:${wl}"></div><div class="r" style="width:${wr}"></div></div></div>`;
  };
  return `<section class="panel"><h2>Statistiche live</h2><div class="stats-grid">${rowsDef.map(rowHtml).join("")}</div></section>`;
}

/* §10.5 Formazioni e cambi */
function isSub(ev) { return /sub/i.test(String(ev.type?.type || "")) || /substitution/i.test(`${ev.text || ""} ${ev.type?.text || ""}`); }

function subsMap() {
  const inMin = {}, outMin = {};
  for (const ev of S.summary?.keyEvents || []) {
    if (!isSub(ev)) continue;
    const min = ev.clock?.displayValue;
    const p0 = ev.participants?.[0]?.athlete, p1 = ev.participants?.[1]?.athlete;
    if (p0 && min) inMin[p0.id] = min;
    if (p1 && min) outMin[p1.id] = min;
  }
  return { inMin, outMin };
}

function rosterColHtml(r, homeId, subs) {
  const tid = String(r.team?.id);
  const players = r.roster || [];
  const byJersey = (a, b) => Number(a.jersey || 0) - Number(b.jersey || 0);
  const starters = players.filter((p) => p.starter === true).sort(byJersey);
  const bench = players.filter((p) => p.starter !== true).sort(byJersey);
  const nameOf = (a) => a?.athlete?.fullName || a?.athlete?.displayName || "?";
  const prowHtml = (p) => {
    const aid = p.athlete?.id;
    const isIn = !!subs.inMin[aid] && p.starter !== true;
    const isOut = p.subbedOut === true;
    const cls = isOut ? " out" : (isIn ? " in" : "");
    const badge = subs.outMin[aid] ? `⏱ ${esc(subs.outMin[aid])}` : (subs.inMin[aid] ? `✓ ${esc(subs.inMin[aid])}` : "");
    return `<div class="prow${cls}"><span class="num">${esc(p.jersey ?? "")}</span><span class="pos" title="${esc(p.position?.name || "")}">${esc(p.position?.abbreviation || "")}</span><span class="pname">${esc(nameOf(p))}</span><span class="pmute">${badge}</span></div>`;
  };
  const changes = [];
  for (const ev of S.summary?.keyEvents || []) {
    if (!isSub(ev)) continue;
    const p0 = ev.participants?.[0], p1 = ev.participants?.[1];
    if (!p0?.athlete || !p1?.athlete) continue;
    const evTeam = String(ev.team?.id || "");
    if (evTeam && evTeam !== tid) continue;
    changes.push(`<div class="chg"><b>${esc(ev.clock?.displayValue || "")}</b> ${esc(p0.athlete.displayName || p0.athlete.fullName || "?")} <span class="arrow">→</span> ${esc(p1.athlete.displayName || p1.athlete.fullName || "?")}</div>`);
  }
  return `<div class="roster-col" data-tid="${esc(tid)}">
    <div class="roster-head"><b>${esc(r.team?.displayName || "?")}</b><span class="formation">${esc(r.formation || "–")}</span></div>
    <div class="rlabel">Formazione titolare</div>${starters.map(prowHtml).join("") || ""}
    <div class="rlabel">Sostituti</div>${bench.map(prowHtml).join("") || ""}
    ${changes.length ? `<div class="rlabel">Cambi</div>${changes.join("")}` : ""}
  </div>`;
}

function lineupsPanelHtml() {
  const rosters = S.summary?.rosters || [];
  if (!rosters.length) return `<section class="panel"><h2>Formazioni e cambi</h2><p class="muted">Formazioni non ancora disponibili dal feed ESPN.</p></section>`;
  const subs = subsMap();
  const comp = S.match?.competitions?.[0];
  const homeId = comp?.competitors?.find((c) => c.homeAway === "home")?.team?.id;
  return `<section class="panel"><h2>Formazioni e cambi</h2><div class="lineups">${rosters.map((r) => rosterColHtml(r, homeId, subs)).join("")}</div></section>`;
}

/* §10.6 Eventi */
const SVG_SUB = `<span class="sub-svg"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 20V6"/><path d="M5.5 9.5 9 6l3.5 3.5"/><path d="M15 4v14"/><path d="M11.5 14.5 15 18l3.5-3.5"/></svg></span>`;
const SVG_WHISTLE = `<span class="whistle-svg"><svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="7" rx="1.5" fill="currentColor"/><circle cx="12" cy="14" r="8" fill="currentColor"/><circle cx="12" cy="14" r="3" fill="var(--panel-2)"/></svg></span>`;

function eventIcon(p) {
  const t = String(p.type?.type || p.kind || "").toLowerCase();
  const txt = `${p.text || ""} ${p.type?.text || ""}`.toLowerCase();
  if (t.includes("red-card") || t.includes("red card") || t.includes("sending-off") || /red card|sent off/i.test(txt)) return `<span class="ico">🟥</span>`;
  if (txt.includes("yellow") && !txt.includes("red")) return `<span class="ico">🟨</span>`;
  if (t === "goal" || txt.startsWith("goal") || txt.includes(" goal") || t === "penalty-kick-goal" || t === "own-goal") return `<span class="ico">⚽</span>`;
  if (t.includes("sub") || txt.includes("substitution")) return SVG_SUB;
  if (/kickoff|halftime|half time|full ?time|final|stoppage|injury|start-|end-|foul|fall/i.test(t + " " + txt)) return SVG_WHISTLE;
  return `<span class="ico">•</span>`;
}

function eventsPanelHtml() {
  const comp = S.match?.competitions?.[0];
  const homeId = comp?.competitors?.find((c) => c.homeAway === "home")?.team?.id;
  const src = (S.summary?.plays && S.summary.plays.length ? S.summary.plays : S.summary?.keyEvents) || [];
  const evs = src.filter((p) => p.type?.text || p.text || p.clock).sort((a, b) => (b.clock?.value ?? 0) - (a.clock?.value ?? 0));
  if (!evs.length) return `<section class="panel"><h2>Eventi</h2><p class="muted">Nessun evento disponibile nel feed ESPN.</p></section>`;
  const rows = evs.map((p) => {
    const min = p.clock?.displayValue || p.period?.displayValue || "–";
    let text = p.text || p.type?.text || "Evento";
    if (p.team && String(p.team.id) !== String(homeId)) text += " (ospiti)";
    return `<div class="ev"><span class="min">${esc(min)}</span><div>${eventIcon(p)}<span>${esc(text)}</span></div></div>`;
  }).join("");
  return `<section class="panel"><h2>Eventi della partita</h2><div class="timeline">${rows}</div></section>`;
}

function renderMatch() {
  return scoreboardHtml()
    + `<button type="button" class="backbtn" data-act="back">‹ Tutte le partite</button>`
    + `<div class="grid single">${countdownHtml()}${statsPanelHtml()}${lineupsPanelHtml()}${eventsPanelHtml()}</div>`
    + errBannerHtml() + footerHtml();
}

function render() {
  const app = el("app");
  if (!app) return;
  const isMatch = S.matchId && S.match;
  let scrollSave = null;
  if (isMatch) {
    scrollSave = {};
    const tl = app.querySelector(".timeline");
    if (tl) scrollSave.tl = { top: tl.scrollTop, near: tl.scrollHeight - tl.scrollTop - tl.clientHeight < 24 };
    for (const rc of app.querySelectorAll(".roster-col")) scrollSave["rc:" + rc.dataset.tid] = { top: rc.scrollTop, near: rc.scrollHeight - rc.scrollTop - rc.clientHeight < 24 };
  }
  let h;
  if (S.matchId && !S.match) h = bootPanelHtml() + errBannerHtml() + footerHtml();
  else if (S.matchId && S.match) h = renderMatch();
  else h = renderLanding();
  app.innerHTML = h;
  if (isMatch && scrollSave) {
    const tl = app.querySelector(".timeline");
    if (tl && scrollSave.tl) tl.scrollTop = scrollSave.tl.near ? tl.scrollHeight : scrollSave.tl.top;
    for (const k of Object.keys(scrollSave)) {
      if (k === "tl") continue;
      const rc = app.querySelector(`.roster-col[data-tid="${CSS.escape(k.slice(3))}"]`);
      if (rc && scrollSave[k]) rc.scrollTop = scrollSave[k].near ? rc.scrollHeight : scrollSave[k].top;
    }
  }
  wireActions();
}

function tickCountdown() {
  if (!S.matchId || !S.match?.date) return;
  const root = el("app")?.querySelector(".countdown");
  if (!root) return;
  const diff = new Date(S.match.date).getTime() - Date.now();
  if (diff <= 0) return;
  const d = Math.floor(diff / 864e5), h = Math.floor(diff / 36e5) % 24, m = Math.floor(diff / 6e4) % 60, s = Math.floor(diff / 1000) % 60;
  const setU = (u, v) => { const n = root.querySelector(`.cd-num[data-u="${u}"]`); if (n) n.textContent = String(v).padStart(2, "0"); };
  setU("d", d); setU("h", h); setU("m", m); setU("s", s);
}


/* ===== azioni (§7) ===== */
function openMatch(id) {
  S.matchId = String(id); S.sport = S.league;
  ssSet(SS_EVENT, S.matchId); ssSet(SS_SPORT, S.league); ssSet(SS_LEAGUE, S.league);
  S.match = null; S.summary = null; S.stats = null; S.lastScore = null;
  apply();
}
function goBack() {
  ssDel(SS_EVENT); ssDel(SS_SPORT);
  if (validLeag(S.sport)) { S.league = S.sport; ssSet(SS_LEAGUE, S.league); }
  S.matchId = null; S.sport = null; S.match = null; S.summary = null; S.stats = null; S.lastScore = null;
  apply();
}

function wireActions() {
  const app = el("app");
  for (const row of app.querySelectorAll(".day-row")) {
    row.addEventListener("click", () => openMatch(row.dataset.match));
    row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openMatch(row.dataset.match); } });
  }
  for (const t of app.querySelectorAll(".lg-tab")) t.addEventListener("click", () => switchLeague(t.dataset.league));
  const back = app.querySelector('[data-act="back"]');
  if (back) back.addEventListener("click", goBack);
  const retry = app.querySelector('[data-act="retry"]');
  if (retry) retry.addEventListener("click", boot);
  const ivl = el("ivl");
  if (ivl) ivl.addEventListener("change", () => { S.pollMs = Number(ivl.value) * 1000; startTimers(); });
  const th = el("themeSel");
  if (th) th.addEventListener("change", () => setTheme(th.value));
  const rb = el("resetBtn");
  if (rb) rb.addEventListener("click", () => { ssDel(SS_EVENT); ssDel(SS_LEAGUE); location.reload(); });
}

function switchLeague(slug) {
  S.league = slug; ssSet(SS_LEAGUE, slug);
  S.events = []; S.landingReady = false;
  apply();
}

/* ===== init ===== */
setTheme(currentTheme());
boot();
