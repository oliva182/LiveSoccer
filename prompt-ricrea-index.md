# Prompt: ricrea `index.html` — dashboard live calcio (ESPN)

> Prompt pensato per un modello LLM. Obiettivo: fargli ricreare un `index.html` **funzionalmente e visivamente equivalente** all'app esistente. Nessun server, nessun test, nessun repo: un unico file HTML self-contained.

---

## Istruzioni al modello

Scrivi **un unico file `index.html`** (HTML + CSS + vanilla JS, zero dipendenze, zero CDN, zero font esterni) che implementi una **dashboard live di calcio** che legge i dati direttamente dall'**API ESPN** via `fetch` dal browser (l'host `site.web.api.espn.com` risponde 200 + `Access-Control-Allow-Origin: *`, quindi nessun proxy).

Requisiti assoluti:
- Lingua UI: **italiano** (`<html lang="it">`, date/ore formattate con locale `it-IT`).
- Vanilla JS in un unico `<script>` con `"use strict"`, nessuna libreria, nessun build.
- Tutto lo stato in un oggetto `S` + persistenza in `sessionStorage`.
- Render completo via `innerHTML` su `<div id="app">` a ogni aggiornamento, con **preservazione dello scroll** dei pannelli scrollabili in vista partita.
- **Escaping HTML** di ogni dato esterno con funzione `esc()` (mappe `& < > " '`).
- Titolo tab: `Calcio Live · Champions · Europa League · Serie A`.
- `<meta name="viewport" content="width=device-width, initial-scale=1">`, charset UTF-8.
- Radice visiva: `<div class="wrap" id="app"></div>` centrata, `max-width:980px`.

L'**Appendice A** contiene il CSS completo da riprodurre **identico** (classi, token `:root`, keyframes, temi extra). Il DOM che generi deve usare esattamente quelle classi/id, così il CSS applicato corrisponde. Segui poi lo stato funzionale descritto sotto.

---

## 1. Leghe (costante `LEAGUES`)

| slug | nome tab | `exp` (partite/giornata) |
|---|---|---|
| `uefa.champions` | Champions League | – (coppa) |
| `uefa.europa` | Europa League | – (coppa) |
| `uefa.europa.conf` | Conference League | – (coppa) |
| `ita.1` | Serie A | 10 |
| `eng.1` | Premier League | 10 |
| `esp.1` | La Liga | 10 |
| `ger.1` | Bundesliga | 9 |
| `fra.1` | Ligue 1 | 9 |

- `isCup(slug)` = slug inizia con `uefa.`.
- Leghe nazionali: 20 squadre → 10 partite/giornata (Bundesliga/Ligue 1: 18 → 9).
- Lega di default al primo avvio: `ita.1`.

## 2. Endpoints ESPN (fetch diretto, header `Accept: application/json`)

- **Scoreboard giorno**: `https://site.web.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard?dates={YYYYMMDD}&limit=100` — data in formato UTC `YYYYMMDD`.
- **Stagione**: stesso endpoint con `dates={y}0701-{y+1}0630&limit=500`, dove `y` = anno UTC corrente se mese ≥ 7 (luglio), altrimenti corrente−1 (la stagione calcistica va luglio→giugno).
- **Classifica**: `https://site.web.api.espn.com/apis/v2/sports/soccer/{slug}/standings` — attenzione, qui è `/apis/v2/` e non `/apis/site/v2/` come gli altri.
- **Summary partita**: `https://site.web.api.espn.com/apis/site/v2/sports/soccer/{slug}/summary?event={eventId}`.
- `apiGet(url)`: incrementa `S.calls` a chiamata; se `!r.ok` lancia `Error("ESPN HTTP {status}")`; altrimenti `r.json()`.
- Costanti: `STANDINGS_TTL = 15*60*1000` (cache 15 min per stagione e classifica), `OFFSETS = [0,-1,1,-2,2]`, `GONE_MSG = "L'evento ESPN non è più disponibile."`.

## 3. Stato (`S`) e persistenza

```js
S = {
  matchId: null, sport: null, league: "ita.1",
  match: null, summary: null, stats: null, standings: null,
  pollMs: 60000, calls: 0, lastUpdated: null, error: null, lastScore: null,
  events: [], dayOffset: 0, landingReady: false,
  view: "oggi", season: null, weekSel: null,
}
```

Chiusure `sessionStorage` (con getter/setter/deleter try-catch):
- `cldash_espn_event_id` (id partita), `cldash_espn_sport`, `cldash_espn_league`, `cldash_theme`, `cldash_view`.

Avvio (`boot()`):
1. `?event={id}` nella query string → memorizza in `cldash_event_id`.
2. Ripristina da sessione: `matchId`, `sport` (valida contro `LEAGUES`, altrimenti null), `league` (valida, altrimenti `ita.1`), `view` (uno di `oggi|cal|hist`, altrimenti `oggi`). Se lega non-coppa e `view==="hist"` → forza `oggi` (+sessione).
3. `render()`.
4. Se c'è `matchId`: se `view!=="oggi"` pre-carica la stagione (swallow error); poi `resolveMatch(matchId)`; se non trovata → `ssDel(event)`, `matchId=null` (torna alla landing); altrimenti impopola `match/dayOffset/sport/league` (+sessione), `loadSummary()` (catch → `S.error`), `lastUpdated=now`.
5. Se `!matchId && !landingReady` → `loadLanding()` (catch → `S.error`).
6. `startTimers()`, `render()`.

## 4. Caricamento dati

- `fetchDay(slug, offset)` → GET scoreboard con `dates={data oggi+offset giorni}` (calcolo UTC) → `{lg: slug, events: data.events||[]}`.
- `loadSeason()`: se già in cache (stesso slug, TTL 15 min) torna; altrimenti fetch stagione (limit 500) → `S.season = {slug, at, events}`.
- `loadStandings()`: cache TTL 15 min per slug; `S.standings = {slug, at, entries: st.children?.[0]?.standings?.entries||[]}`; **errori ignorati silenziosamente** (la classifica non deve mai rompere la pagina).
- `loadLanding()`:
  - se `view==="oggi"` e lega coppa → `fetchDay(league,0)` + `loadStandings()`, `S.events=[day]`, `dayOffset=0`.
  - altrimenti `loadSeason()` (+ `loadStandings()` se `view==="oggi"`).
  - In entrambi i casi: `landingReady=true`, `lastUpdated=now`.
- `resolveMatch(id)`: prima cerca in `S.season.events` (se `season.slug === sport||league`) — fondamentale per lo Storico, che ±2 giorni non coprono; altrimenti `findEvent(id)`.
- `findEvent(id)`: per ogni offset in `[0,-1,1,-2,2]`: `Promise.all` di `fetchDay` su tutte e 8 le leghe (ciascuno con `.catch(()=>({lg, events:[]}))`), cerca `String(e.id)===String(id)` → `{event, offset, slug}`.
- `apply()`: `matchId ? Promise.all([loadMatch(), loadSummary()]) : loadLanding()`; ok → `error=null`, `lastUpdated=now`; catch → `error = friendlyErr(e)`; poi `render()`.
- `friendlyErr(e)`: `TypeError` → `"Errore di rete verso ESPN."`, altrimenti `String(e?.message || e)`.

## 5. Giornate (raggruppamento della stagione) — cuore dell'app

**Finestra settimana** (`weekKey(date, slug)`):
- leghe nazionali: settimana **venerdì→lunedì** (start=5); coppe europee: **martedì→giovedì** (start=2).
- `day = (getUTCDay() - start + 7) % 7`; key = data UTC (ISO `YYYY-MM-DD`) del primo giorno della finestra.

**`seasonGroupsAll()`** — gruppi ordinati:
1. `Map` weekKey → eventi (dai `S.season.events` della lega corrente).
2. Per le leghe con `exp` (nazionali): iterando le week ordinate per key, **carry**: `pool = [...carry, ...evs]` ordinati per data; `while (pool.length > exp) emit(pool.splice(0, exp))`; `carry = pool` (il resto passa alla week successiva — es. la 10ª partita di Ligue 1 giocata giovedì non crea una giornata da 1, ma si somma alla week dopo; un turno infrasettimanale da 20 in Serie A si divide in due giornate da 10 facendo scalare il numeramento). Coppe (`exp=0`): una week = una giornata, ordinata per data.
3. `emit(evs)`: key = ISO della prima partita; se già usata, appende `-2`, `-3`, … finché unica.
4. `openIdx` = indice dell'ultimo gruppo con prima partita ≤ oggi (confronto stringhe ISO UTC).
5. Output per gruppo: `{key, n: i+1, label, meta, evs, open: i===openIdx}` dove:
   - `label`: se tutte le partite stesso giorno → `dayFmt(d0)` (es. `15 set`), altrimenti `"{dayFmt d0} – {dayFmt d1}"`.
   - `meta`: se ci sono partite live → `"{N} partite · {live} in corso"`, altrimenti `"{N} partite"`.
   - live = eventi con `competitions[0].status.type.state === "in"`.

Date: `dateStr(off)` = UTC `YYYYMMDD` di oggi+off; `kickoffTime(d)` = `toLocaleTimeString("it-IT", {hour:"2-digit", minute:"2-digit"})`; `dayFmt(d)` = `toLocaleDateString("it-IT", {day:"numeric", month:"short"})`.

## 6. Landing (vista elenco)

DOM: `tabsHtml()` (8 pulsanti `.lg-tab` pill, attivo con gradiente) + `viewTabsHtml()` + pannello + `footerHtml()`.

**View tabs**:
- Coppe: 3 tab `.view-tab` — `Oggi` (`oggi`), `Calendario` (`cal`), `Storico` (`hist`).
- Nazionali: un solo tab `Giornata in corso${n ? " - " + n : ""}` (`oggi`), dove `n` = numero della giornata corrente (da `seasonGroupsAll()` → gruppo `open` o `weekSel`).

**Vista `oggi`**:
- Coppe: `dayPanelHtml()` — sezione `.panel` `<h2>Partite di oggi · {Lega}</h2>` con `.day-list` di `.day-row` ordinate per data, oppure `.empty-msg` `"Spiacente, nessun match oggi!"`.
- Nazionali: `weekPanelHtml()` — `.wk-nav` con 3 pulsanti `.lg-tab`: `‹ Giornata precedente` (`data-nav="prev"`, disabled se non c'è precedente), `Calendario` (`data-nav="cal"`), `Giornata successiva ›` (`data-nav="next"`); titolo `.wk-cur` `<b>Giornata {n} · {label}</b><span class="g-meta">{meta}</span>` oppure `"Nessuna partita in questa settimana"` / `empty-msg "Nessuna partita in questa settimana."`; lista `.day-row` **con data** (vedi §7).
- Sempre seguito da `standingsPanelHtml()` + banner errore.

**Vista `cal`/`hist`** (`seasonPanelHtml()`):
- Titolo: `Calendario · {Lega}` oppure (coppe, hist) `Storico · {Lega}`.
- Coppe: `cal` → gruppi con `key >= todayKey`, aperto = ultimo gruppo con `key < nextWeekKey`, vuoto → `"Nessuna giornata prossima in questa stagione."`; `hist` → gruppi `key < todayKey` **in ordine inverso**, primo aperto, meta = `"{N} risultati"`, vuoto → `"...registrata..."`.
- Nazionali: tutti i gruppi, aperto = key === `todayKey`, label con `<b class="g-num">Giornata {n}</b>`.
- Ogni gruppo è un `<details class="giornata">` con `<summary>` (`.g-date` + eventuale `.g-num` + `.g-meta`) e `.day-list` di `.day-row` con `dt` (giorno+data+ora) per tutte le righe.
- Se nessun gruppo: `.empty-msg` con frase sopra.

**`dayRowHtml(ev, dt)`** — riga partita, `role="button" tabindex="0" data-match="{id}"`, grid `80px 1fr auto`:
- `.dr-score`: punteggio (se live o finale) altrimenti orario o vuoto.
- `.dr-teams`: 2 righe `.dr-team` (logo 20px `<img>` + nome `team.displayName`).
- `.dr-status` `.st`:
  - live → `<span class="st live">In corso{ " · " + displayClock }</span>` (puntino pulsante verde).
  - finale → `dt ? dt : "Finale"`.
  - futuro → `dt ? dt : kickoffTime`.
- Click **e** tastiera (Enter/Spazio, con `preventDefault`) → `openMatch(id)`.

**`standingsPanelHtml()`** — `<h2>Classifica · {Lega}</h2>`:
- Nessuna → `.muted` `"Classifica non disponibile al momento."`.
- Ordina entries per stat `rank`; tabella `.cls` sticky thead: `# | Squadra | G | V | N | P | DR | Pt` (stats `gamesPlayed, wins, ties, losses, pointDifferential, points`, `displayValue`); zebra righe; `.team-cell` a sinistra con ellipsis + `title`.
- **Zone**: `zoneOf(entry)`: `d = entry.note?.description||""`; `raw = d==="Knockout phase playoffs - seeded" ? "#FF9E2C" : (ZONE_COLOR[d] || entry.note?.color || "")`; colore finale = `raw.replace(/^#+/, "#")` (sanitizza il bug ESPN `##B5E7CE` di eng.1). Mappa `ZONE_COLOR`: `"Europa League": var(--zone-uel)`, `"Conference League"` e `"Conference League qualifying": var(--zone-uecl)`, `"Relegation playoff": var(--zone-rp)`, `"Relegation"`/`"Relegated": var(--bad)`; le altre zone usano il colore ESPN.
- `<i class="zone-dot">` colorato davanti al numero (nessun dot se la squadra non ha zona) + legenda `.zone-legend` (zone uniche in ordine d'incontro).

**Footer** (`.foot`) — sempre in fondo:
- `Fonte: ESPN Soccer` · `Aggiornamento: {ora it-IT}` · `<select id="ivl">` (30/60/120/180s, valorizzato da `pollMs`) · `<b>Chiamate: {S.calls}</b>` · `<select id="themeSel">` (temi) · `<button id="resetBtn">reset</button>` (piccolo, `style="width:auto;margin:0;padding:5px 12px;font-size:.75rem"`).
- `ivl` change → `pollMs = value*1000`, riavvia timer. `themeSel` change → `setTheme`. `resetBtn` → `ssDel(event)`, `ssDel(league)`, `location.reload()`.
- Banner errore (se `S.error`): `.err` `"Ultimo aggiornamento fallito: {msg}"`.
- Stato avvio (`.panel` `Avvio`): `"Apertura dashboard…"` (partita) o `"Caricamento partite e classifica dal feed ESPN…"`.

**Azioni landing**:
- `switchLeague(slug)`: setta `league`+sessione, `events=[]`, `landingReady=false`, `weekSel=null`; non-coppa + `hist` → `oggi`; `apply()`.
- `switchView(view)`: se stessa torna; setta `view`+sessione, `landingReady=false`, `weekSel=null`; `apply()`.
- Nav giornate: `prev`/`next` → `S.weekSel = key; render()` (no fetch); `cal` → `switchView("cal")`.
- `openMatch(id)`: `matchId=String(id)`, `sport=league`, sessione event/sport/league, azzera `match/summary/stats/lastScore`, `apply()`.
- `goBack()`: `ssDel(event)`, `ssDel(sport)`; se `sport` valido → `league=sport`+sessione; azzera stato partita; `apply()`.

## 7. Pagina partita

`renderMatch()` = `scoreboardHtml()` + `<button class="backbtn" data-act="back">‹ Tutte le partite</button>` + `.grid.single` con countdown + statistiche + formazioni + eventi + banner errore + footer.

**`matchStatus()`**: `st = comp.status.type || match.status.type`; `label = st.detail || st.shortDetail || st.state || "Stato sconosciuto"`; `live = state==="in" || (/live|half|intermission|postponed/i.test(label) && !/final/i.test(label))`; ritorna `{state, label, clock: st.displayClock, live}`.

**Scoreboard** (`.scoreboard`, classe `live` se live): 3 colonne — squadra casa (logo 64px + nome), centro (`.score-line` `"{H} : {A}"` 2.6rem + `.status-pill` con `.dot` + label + eventuale `· {clock}`), squadra ospite.
- **Flash**: se il punteggio stringa `"{H} : {A}"` è cambiato da `S.lastScore` → classe `flash-score` (pop dorato) su `.score-line`; aggiorna `S.lastScore` a ogni render.
- Sotto la pill: **highlights** (`highlightsHtml()`): solo se `summary.keyEvents` contiene almeno un goal o un cartellino. Due colonne `.highlight-team` (ospite a destra, testo allineato): titolo = nome corto squadra; items = eventi della squadra con type `goal|yellow-card|red-card`: `<b>{clock.displayValue}</b>` + icona (`🟥`/`🟨`/`⚽`) + autore = `participants[0].athlete.displayName` oppure `shortText` con suffisso `Goal|Yellow Card|Red Card` rimosso (regex `/(\s*)(Goal|Yellow Card|Red Card)$/i`), fallback `"Evento"`.

**Countdown** (solo partita non iniziata: c'è `match.date`, non live, label non `/final|cancel|postpon/i`, diff>0): box `.cd-num` (2.2rem, tabular) + `.cd-lbl` per `giorni` (solo se d>0) / `ore` / `minuti` / `secondi`, `data-u="d|h|m|s"`, zero-pad; sotto: `"Fischio d'inizio: {toLocaleString it-IT}"`. **Tick** a 1s che aggiorna solo i nodi `.cd-num` (no re-render).

**Statistiche live** (`statsPanelHtml()`):
- `normalizeStats(boxscore)`: righe = `box.teams` oppure `[box.team]`; per ogni riga `st = row.statistics || row.stats`; `findVal(names[])` = primo stat il cui `name||label` (lowercase, exact) sta in `names`, valore `numOrNull(displayValue ?? value)` (solo se `isFinite(Number(...))`).
  - `possession`: `["possessionPct","possession","ball possession"]`; `shots`: `["totalShots","shots","total shots"]`; `onTarget`: `["shotsOnTarget","shots on target","shots on goal"]`; `blocked`: `["blockedShots","blocked shots"]`; `corners`: `["wonCorners","corner kicks","corners"]`; `fouls`: `["foulsCommitted","fouls"]`; `offsides`: `["offsides"]`; `yellow`: `["yellowCards","yellow cards"]`.
  - `offTarget = max(0, shots - onTarget - (blocked||0))` (solo se shots e onTarget numerici).
- Nessuna → `.muted` `"Statistiche non ancora disponibili dal feed ESPN."`.
- Riga per stat (`.stat-row`): label centrato, valori casa/ospite a destra/sinistra (b), barra a 2 lati (`.l` blu `--acc`, `.r` viola `#a78bfa`) con larghezza = `value/total*50`% (2 decimali; `total = max(1, h+a)`).
- Righe: `Possesso palla` (%), `Tiri totali`, `Tiri in porta`, `Tiri fuori`, `Angoli`, `Falli`, `Fuorigioco`, `Gialli`. Valore null → `–`.

**Formazioni e cambi** (`lineupsPanelHtml()`):
- `summary.rosters`; nessuna → `.muted` `"Formazioni non ancora disponibili dal feed ESPN."`.
- Per roster (colonna `.roster-col`, `data-tid`): header squadra + `.formation` (oro); sezioni `"Formazione titolare"` (`player.starter===true`) e `"Sostituti"`, ordinate per `Number(jersey)`; riga `.prow` = `num` (maglia) + `pos` (`position.abbreviation`, title `position.name`) + `pname` (`athlete.fullName||displayName`) + badge: se `subbedOut===true` → `⏱ {min}` (classe `out`, name barrato), se è entrato → `✓ {min}` (classe `in`, verde).
- `subsMap()`: dagli `keyEvents` dove `isSub` (type contiene `sub` oppure testo contiene `substitution`): `participants[0]` = **entra** (`inMin[ath.id]=clock.displayValue`), `participants[1]` = **esce** (`outMin[ath.id]=...`).
- Sezione `"Cambi"`: per ogni sub event della squadra del roster: `<b>{min}</b> {entrante} <span class="arrow">→</span> {uscito}` (nome `displayName||fullName`).

**Eventi** (`eventsPanelHtml()`):
- Sorgente: `summary.plays` (se non vuota) altrimenti `keyEvents`; filtra `p.type?.text || p.text || p.clock`; **ordina per `clock.value` decrescente**.
- Nessuno → `.muted` `"Nessun evento disponibile nel feed ESPN."`.
- Riga `.ev`: `.min` = `clock.displayValue || period.displayValue || "–"` + icona + testo (`p.text || p.type.text || "Evento"`; se `p.team.id !== homeId` appende `" (ospiti)"`).
- `eventIcon(p)` (su `type.type` lower + testo lower):
  - rosso: contiene `red-card`/`red card`/`sending-off` o `/red card|sent off/i` → `🟥`;
  - giallo: testo contiene `yellow` (e non `red`) → `🟨`;
  - goal: `t==="goal"` o testo inizia `goal` o contiene ` goal` o `t==="penalty-kick-goal"` o `t==="own-goal"` → `⚽`;
  - sub: `t` contiene `sub` o testo `substitution` → SVG sostituto (inline, `viewBox 0 0 24 24`, stroke `currentColor` 2, round: `<path d="M9 20V6"/><path d="M5.5 9.5 9 6l3.5 3.5"/><path d="M15 4v14"/><path d="M11.5 14.5 15 18l3.5-3.5"/>`);
  - fischio: `/kickoff|halftime|half time|full ?time|final|stoppage|injury|start-|end-|foul|fall/i` su `t+" "+txt` → SVG fischietto (inline: `<rect x="9" y="2" width="6" height="7" rx="1.5" fill="currentColor"/><circle cx="12" cy="14" r="8" fill="currentColor"/><circle cx="12" cy="14" r="3" fill="var(--panel-2)"/>`);
  - altro → `•`.
- I 2 SVG vanno in wrapper `.sub-svg` / `.whistle-svg` (dimensionati 1.05em dal CSS).

**Preservazione scroll** (solo vista partita): prima del `innerHTML`, salva per `.timeline` e ogni `.roster-col` `scrollTop` e se era a ≤24px dal fondo; dopo il render ripristina (se era "vicino al fondo" → `scrollHeight`, così resta ancorato al fondo durante il poll).

## 8. Timer e polling

- `pollTimer = setInterval(poll, S.pollMs)` (default 60s) → `apply()`.
- `cdTimer = setInterval(tickCountdown, 1000)`.
- Cambio intervallo o `boot()` → `stopTimers()` + riavvio.

## 9. Temi

`THEMES = [{slug:"stadio",label:"Stadio"},{slug:"cartoon",label:"Cartoon"},{slug:"sketch",label:"Sketch"}]`.
- `currentTheme()` = sessione valida oppure `stadio` (default).
- `setTheme(t)`: `document.documentElement.dataset.theme = t` + sessione + sincronizza `#themeSel`.
- Al boot: `setTheme(currentTheme())` prima del render.
- Il CSS dei temi `cartoon` e `sketch` è nell'Appendice A (variabili `:root` sovrascritte da `html[data-theme="..."]`, font, bordi, ombre, animazioni live/pulse → `cartoonPulse`/`blinkSoft`, flash punteggio → `cartoonPop`/`inkWiggle`).

## 10. Comportamenti trasversali

- **Re-render completo** a ogni `apply()`/`switch*`; in vista landing non serve preservare scroll.
- **Errori**: `S.error` mostra `.err` sotto i pannelli; in fase di avvio il pannello `Errore` ha pulsante `Riprova` (data-act="retry") → `boot()`. `TypeError` (fetch fallito) → `"Errore di rete verso ESPN."`.
- **Countdown** non deve mai mostrare valori negativi.
- **`esc()`** su ogni dato ESPN iniettato in HTML/attributi (loghi `src`, nomi, date, zone, ecc.).
- **Responsive**: griglie 2 colonne → 1 sotto 760px (già nel CSS); tabella con `min-width:480px` + scroll.
- **Tabellar nums** (`font-variant-numeric: tabular-nums`) su punteggi, minuti, numeri maglie, countdown.
- Pulsanti globali: stile gradiente blu→viola da `button{...}` (vedi CSS); `.lg-tab`/`.view-tab` lo sovrascrivono.
- Accessibilità: `role="button"` + `tabindex="0"` + handler Enter/Spazio sulle righe partita; `aria-label` sui select del footer.

## 11. Checklist di verifica (funzionale)

1. Aperto senza query: landing `ita.1`, tab `Giornata in corso - N`, classifica ESPN, footer con conteggio chiamate.
2. Cambio lega → refetch; cambio view (coppe) → Oggi/Calendario/Storico; Storico mostra solo passato (ordine inverso).
3. Click su una partita → scoreboard + countdown/statistiche/formazioni/eventi; `‹ Tutte le partite` torna alla lega da cui si è partiti.
4. `?event={id}` in URL → apre direttamente la partita (anche di una lega diversa da `ita.1`).
5. Poll a 60s: punteggio live che cambia fa flash dorato; timeline resta ancorata al fondo se sei in fondo.
6. Classifica: dot zona colorati + legenda; nessun crash se una squadra non ha zona; classifica assente → messaggio muted, nessuna pagina rotta.
7. Temi: Cartoon/Sketch cambiano tutto il tema in piedi, persistiti in sessione; `reset` nel footer azzera evento+lega e ricarica.
8. Turni da 20 partite (Serie A) divisi in due giornate; Ligue 1/Bundesliga 9/giornata con carry del resto; giornata "aperta" = l'ultima con partite già giocate/in corso.
9. Tutto funziona da static server qualsiasi (o `file://` se la rete lo permette): nessun proxy, nessun build.

---

## Appendice A — CSS (riprodurre identico)

```css
  :root{
    --bg:#0b0f1a; --panel:#121a2b; --panel-2:#182136; --line:#232e47;
    --txt:#e8edf7; --dim:#8b96ad; --acc:#3fb6ff; --gold:#ffd76a;
    --ok:#4ade80; --bad:#f87171;
    --zebra:rgba(255,255,255,.04); --zone-uecl:#3FD4C4; --zone-rp:#FFB454; --zone-uel:#A78BFA;
  }
  html{font-size:17px}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:"Segoe UI",system-ui,-apple-system,sans-serif;background:radial-gradient(1200px 600px at 50% -10%,#16233f 0%,var(--bg) 60%);color:var(--txt);min-height:100vh;padding:18px}
  .wrap{max-width:980px;margin:0 auto}

  .scoreboard{background:linear-gradient(180deg,var(--panel-2),var(--panel));border:1px solid var(--line);border-radius:16px;padding:18px 22px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;box-shadow:0 10px 40px rgba(0,0,0,.35)}
  .team{display:flex;flex-direction:column;align-items:center;gap:8px;min-width:0}
  .team img{width:64px;height:64px;object-fit:contain;filter:drop-shadow(0 6px 12px rgba(0,0,0,.5))}
  .team .name{font-weight:700;font-size:1.05rem;letter-spacing:.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
  .score-mid{text-align:center;min-width:190px}
  .score-line{font-size:2.6rem;font-weight:800;letter-spacing:2px;line-height:1}
  .status-pill{margin-top:8px;display:inline-flex;align-items:center;gap:7px;background:#0e1526;border:1px solid var(--line);border-radius:999px;padding:4px 14px;font-size:.9rem;color:var(--dim)}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--dim)}
  .live .dot{background:var(--bad);animation:pulse 1.2s infinite}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(248,113,113,.5)}70%{box-shadow:0 0 0 9px rgba(248,113,113,0)}100%{box-shadow:0 0 0 0 rgba(248,113,113,0)}}
  .backbtn{margin:10px 0 2px;background:none;border:none;color:var(--acc);font-size:.9rem;cursor:pointer;padding:4px 2px}
  .backbtn:hover{text-decoration:underline}
  .lg-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
  .lg-tab{width:auto;margin:0;padding:9px 16px;border-radius:999px;background:#0e1526;color:var(--dim);border:1px solid var(--line);font-size:.9rem;font-weight:600;cursor:pointer;transition:filter .15s}
  .lg-tab:hover{filter:brightness(1.25)}
  .lg-tab.active{background:linear-gradient(90deg,#2563eb,#7c3aed);color:#fff;border-color:transparent}
  .view-tabs{display:flex;gap:6px;margin-bottom:14px}
  .view-tab{flex:1;padding:8px 10px;border-radius:9px;background:var(--panel-2);color:var(--dim);border:1px solid var(--line);font-size:.85rem;font-weight:600;cursor:pointer}
  .view-tab.active{background:linear-gradient(90deg,#2563eb,#7c3aed);color:#fff;border-color:transparent}
  .giornate{display:flex;flex-direction:column;gap:10px}
  .giornata{background:var(--panel-2);border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .giornata summary{display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;font-weight:700;font-size:.9rem;list-style:none}
  .giornata summary .g-date{flex:1;text-align:left;font-weight:400;color:var(--dim)}
  .giornata summary .g-num{flex:0 0 auto}
  .giornata summary .g-meta{flex:1;text-align:right}
  .giornata summary::-webkit-details-marker{display:none}
  .giornata summary::before{content:"▸";color:var(--dim);margin-right:2px}
  .giornata[open] summary::before{content:"▾"}
  .g-meta{font-weight:400;font-size:.78rem;color:var(--dim);text-transform:none;letter-spacing:.3px}
  .giornata .day-list{padding:4px 12px 12px}
  .empty-msg{text-align:center;padding:28px 10px;color:var(--dim)}
  .wk-cur{display:flex;align-items:baseline;gap:10px;margin-bottom:10px;font-size:.95rem}
  .wk-nav{display:flex;justify-content:space-between;gap:10px;margin-bottom:12px}
  .lg-tab:disabled{opacity:.4;cursor:default}

  .tbl-wrap{overflow:auto;max-height:430px}
  table.cls{width:100%;border-collapse:collapse;font-size:.9rem;min-width:480px}
  table.cls th,table.cls td{padding:6px 10px;text-align:center;white-space:nowrap}
  table.cls th{color:var(--dim);font-size:.72rem;text-transform:uppercase;letter-spacing:.8px;border-bottom:1px solid var(--line)}
  table.cls th:first-child,table.cls td:first-child{padding-left:4px}
  table.cls thead th{position:sticky;top:0;background:var(--panel);z-index:1}
  table.cls tbody tr:nth-child(odd){background:var(--zebra)}
  td.team-cell{text-align:left;font-weight:600;max-width:240px;overflow:hidden;text-overflow:ellipsis}
  td.pts{font-weight:700}
  .zone-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:1px}
  .zone-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin-bottom:12px;font-size:.76rem;color:var(--dim)}
  .zone-legend span{display:inline-flex;align-items:center;gap:5px}
  .day-list{display:flex;flex-direction:column;gap:8px}
  .day-row{display:grid;grid-template-columns:80px 1fr auto;gap:14px;align-items:center;background:var(--panel-2);border-radius:10px;padding:10px 14px;cursor:pointer;border:1px solid transparent}
  .day-row:hover,.day-row:focus{background:#131c2e;border-color:var(--line);outline:none}
  .dr-score{text-align:center;font-weight:700;font-size:1.05rem;font-variant-numeric:tabular-nums;white-space:nowrap}
  .dr-teams{display:flex;flex-direction:column;gap:4px;min-width:0}
  .dr-team{display:flex;align-items:center;gap:8px;font-size:.95rem;min-width:0}
  .dr-team img{width:20px;height:20px;object-fit:contain;flex-shrink:0}
  .dr-status{white-space:nowrap}
  .st{font-size:.78rem;color:var(--dim);white-space:nowrap;text-transform:uppercase;letter-spacing:.6px}
  .st.live{color:#4ade80;display:inline-flex;align-items:center;gap:7px}
  .st.live::before{content:"";width:8px;height:8px;border-radius:50%;background:#4ade80;animation:pulse 1.2s infinite}
  .ht-score{margin-top:6px;font-size:.78rem;color:var(--dim)}
  .match-highlights{display:flex;justify-content:space-between;gap:18px;margin-top:10px;font-size:.84rem;color:var(--dim);width:100%;text-align:left}
  .highlight-team{display:flex;flex-direction:column;gap:3px;min-width:0;max-width:185px}
  .highlight-team.away{text-align:right}
  .highlight-title{font-size:.76rem;text-transform:uppercase;letter-spacing:.8px;color:var(--dim);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .highlight-item{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .highlight-item b{color:var(--txt);font-variant-numeric:tabular-nums;margin-right:3px}

  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
  @media (max-width:760px){.grid{grid-template-columns:1fr}}
  .grid.single{grid-template-columns:1fr}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}
  .panel h2{font-size:.95rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--dim);margin-bottom:14px}

  .stats-grid{display:grid;grid-template-columns:1fr 1fr;column-gap:32px}
  @media (max-width:760px){.stats-grid{grid-template-columns:1fr}}
  .stat-row{margin-bottom:13px}
  .stat-row .lbl{display:flex;justify-content:space-between;font-size:.95rem;color:var(--dim);margin-bottom:4px}
  .stat-row .lbl b{color:var(--txt);font-variant-numeric:tabular-nums}
  .bar{height:7px;border-radius:4px;background:#0e1526;overflow:hidden;display:flex}
  .bar .l{background:var(--acc);transition:width .8s ease}
  .bar .r{background:#a78bfa;transition:width .8s ease;margin-left:auto}

  .timeline{max-height:340px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding-right:6px}
  .ev{display:grid;grid-template-columns:56px 1fr;gap:8px;align-items:center;background:var(--panel-2);border-radius:10px;padding:8px 10px;font-size:1rem}
  @keyframes flash{from{background:#1e3a5f}}
  .ev .min{text-align:right;color:var(--dim);font-variant-numeric:tabular-nums;font-size:.9rem}
  .ev .who b{display:block}
  .ev .who span{color:var(--dim);font-size:.88rem}
  .ev .ico{display:inline-block;width:1.05em;height:1.05em;vertical-align:-.18em;margin-right:.25em;line-height:1}
  .whistle-svg svg{width:1.05em;height:1.05em;display:block;color:#cbd5e1}
  .sub-svg svg{width:1.05em;height:1.05em;display:block;color:#4ade80}

  .lineups{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media (max-width:760px){.lineups{grid-template-columns:1fr}}
  .roster-col{background:var(--panel-2);border-radius:10px;padding:12px;font-size:.92rem;max-height:430px;overflow-y:auto}
  .roster-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:.95rem;gap:10px}
  .formation{color:var(--gold);font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
  .rlabel{margin:10px 0 4px;font-size:.76rem;text-transform:uppercase;letter-spacing:1px;color:var(--dim)}
  .prow{display:grid;grid-template-columns:28px 46px 1fr auto;gap:8px;align-items:center;padding:3px 6px;border-radius:6px}
  .prow:nth-child(odd){background:rgba(255,255,255,.02)}
  .prow .num{color:var(--dim);font-variant-numeric:tabular-nums;text-align:center}
  .prow .pos{color:var(--acc);font-size:.78rem;letter-spacing:.4px}
  .prow .pname{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .prow.out .pname{text-decoration:line-through;color:var(--dim)}
  .prow.in .pname{color:var(--ok)}
  .prow .pmute{color:var(--dim);font-size:.82rem;font-variant-numeric:tabular-nums;white-space:nowrap}
  .chg{padding:3px 6px;font-size:.92rem;color:var(--dim)}
  .chg b{color:var(--txt);margin-right:4px;font-variant-numeric:tabular-nums}
  .arrow{color:var(--gold)}

  .setup{max-width:560px;margin:40px auto;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:28px}
  .setup h1{font-size:1.3rem;margin-bottom:6px}
  .setup p,.setup li{color:var(--dim);font-size:.92rem;line-height:1.5}
  .setup ul{margin:12px 0 16px 18px}
  input[type=password]{width:100%;background:#0e1526;border:1px solid var(--line);color:var(--txt);border-radius:10px;padding:11px 13px;font-size:.95rem;margin-top:8px;outline:none}
  input:focus{border-color:var(--acc)}
  button{margin-top:14px;width:100%;padding:12px;border:0;border-radius:10px;background:linear-gradient(90deg,#2563eb,#7c3aed);color:#fff;font-weight:700;font-size:.95rem;cursor:pointer}
  button:hover{filter:brightness(1.15)}
  .hint{font-size:.8rem;color:var(--dim);margin-top:10px;line-height:1.45}
  a{color:var(--acc)}

  .countdown{text-align:center;padding:30px 10px}
  .cd-num{font-size:2.2rem;font-weight:800;letter-spacing:1px;font-variant-numeric:tabular-nums}
  .cd-lbl{color:var(--dim);font-size:.85rem;text-transform:uppercase;letter-spacing:1.4px;margin-top:6px}

  .foot{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:14px;padding:10px 16px;background:var(--panel);border:1px solid var(--line);border-radius:12px;font-size:.88rem;color:var(--dim);flex-wrap:wrap}
  .foot select{background:#0e1526;border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:5px 9px;font-size:.8rem;margin:0}
  .quota-bar{flex:1;min-width:120px;max-width:200px;height:6px;background:#0e1526;border-radius:3px;overflow:hidden;margin-left:auto}
  .quota-bar div{height:100%;background:var(--ok);transition:width .4s}

  .flash-score{animation:scorepop .6s ease}
  @keyframes scorepop{0%{transform:scale(1.35);color:var(--gold)}100%{transform:scale(1)}}
  .muted{color:var(--dim);font-size:.9rem;text-align:center;padding:26px}
  .err{color:var(--bad);font-size:.85rem;margin-top:10px;min-height:1.2em}
  /* ===== temi extra: cartoon / sketch (default = stadio, §13.1) ===== */
  @keyframes blinkSoft{0%,100%{opacity:1}50%{opacity:.3}}
  @keyframes cartoonPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.7)}}
  @keyframes cartoonPop{0%{color:var(--gold);transform:scale(1.4) rotate(-4deg)}100%{transform:none}}
  @keyframes inkWiggle{0%{color:var(--bad);transform:rotate(-3deg) scale(1.25)}60%{transform:rotate(2deg)}100%{transform:none}}

  html[data-theme="cartoon"]{--bg:#fdf3d8;--panel:#fffdf7;--panel-2:#ffefc2;--line:#1a1a1a;--txt:#1a1a1a;--dim:#6b6475;--acc:#ff6b35;--gold:#ffd400;--ok:#2ec27e;--bad:#ff3b3b;--zebra:rgba(26,26,26,.04);--zone-uecl:#0E9488;--zone-rp:#E69500;--zone-uel:#7C3AED}
  html[data-theme="cartoon"] body{font-family:"Trebuchet MS","Segoe UI",system-ui,sans-serif;background:repeating-linear-gradient(45deg,var(--bg) 0 26px,#fbeec9 26px 52px)}
  html[data-theme="cartoon"] .scoreboard,html[data-theme="cartoon"] .panel,html[data-theme="cartoon"] .foot{border-width:3px}
  html[data-theme="cartoon"] .scoreboard{box-shadow:6px 6px 0 rgba(26,26,26,.9)}
  html[data-theme="cartoon"] .status-pill,html[data-theme="cartoon"] .lg-tab,html[data-theme="cartoon"] .bar,html[data-theme="cartoon"] .foot select{background:#fffdf7}
  html[data-theme="cartoon"] .lg-tab.active{background:var(--acc);color:#fff;border-color:#1a1a1a}
  html[data-theme="cartoon"] button{background:var(--gold);border:2px solid #1a1a1a;color:#1a1a1a;box-shadow:3px 3px 0 rgba(26,26,26,.9)}
  html[data-theme="cartoon"] .bar .r{background:#3aa0ff}
  html[data-theme="cartoon"] .live .dot,html[data-theme="cartoon"] .st.live::before{animation:cartoonPulse 1.2s infinite;background:var(--bad)}
  html[data-theme="cartoon"] .flash-score{animation-name:cartoonPop}

  html[data-theme="sketch"]{--bg:#f4eee0;--panel:#fffcf5;--panel-2:#f3ecd9;--line:#b7a98c;--txt:#262630;--dim:#7d7668;--acc:#d0561e;--gold:#a9780a;--ok:#2e7d32;--bad:#c0392b;--zebra:rgba(38,38,48,.04);--zone-uecl:#2E8B7D;--zone-rp:#B7791F;--zone-uel:#6B46C1}
  html[data-theme="sketch"] body{font-family:"Segoe Print","Bradley Hand","Comic Sans MS",cursive;background:var(--bg)}
  html[data-theme="sketch"] .panel,html[data-theme="sketch"] .scoreboard,html[data-theme="sketch"] .day-row,html[data-theme="sketch"] .foot{border-width:2px;border-radius:14px 25px 16px 26px/25px 14px 27px 15px}
  html[data-theme="sketch"] .scoreboard{box-shadow:3px 4px 0 rgba(38,38,48,.18)}
  html[data-theme="sketch"] .status-pill,html[data-theme="sketch"] .lg-tab,html[data-theme="sketch"] .bar,html[data-theme="sketch"] .foot select{background:#fffdf7}
  html[data-theme="sketch"] .lg-tab{border-style:dashed}
  html[data-theme="sketch"] .lg-tab.active{background:var(--acc);color:#fff;border-color:transparent}
  html[data-theme="sketch"] button{background:var(--acc)}
  html[data-theme="sketch"] .day-row:hover,html[data-theme="sketch"] .day-row:focus{background:#efe6cf}
  html[data-theme="sketch"] table.cls thead th{background:var(--panel)}
  html[data-theme="sketch"] .bar .r{background:#8a6db1}
  html[data-theme="sketch"] .live .dot,html[data-theme="sketch"] .st.live::before{animation:blinkSoft 1.2s infinite;background:var(--bad)}
  html[data-theme="sketch"] .flash-score{animation-name:inkWiggle}
```
