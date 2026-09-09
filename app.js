// ---------------------------------------------------------------
// The Pool — single-page app: tab switching, public dashboard,
// weekly results, and the PIN-gated admin panel.
// ---------------------------------------------------------------

const MAX_TRANSACTIONS = 5;

// =================================================================
// TABS
// =================================================================

const TABS = ["Standings", "Weekly", "Admin"];

function switchTab(name) {
  TABS.forEach(t => {
    document.getElementById(`panel${t}`).classList.toggle("hidden", t !== name);
    const btn = document.getElementById(`tabBtn${t}`);
    btn.classList.toggle("active", t === name);
    btn.setAttribute("aria-selected", t === name ? "true" : "false");
  });
  if (name === "Weekly" && !weeklyLoaded) loadWeeklyTab();
}

TABS.forEach(t => {
  document.getElementById(`tabBtn${t}`).addEventListener("click", () => switchTab(t));
});

// =================================================================
// SHARED DATA LOADING (used by Standings tab and Weekly tab)
// =================================================================

let POOL = null; // cached { players, meta, assignments, weeklyResults, transactions }

async function loadPoolState(force) {
  if (POOL && !force) return POOL;
  const [playersSnap, metaSnap, assignSnap, resultsSnap, txSnap] = await Promise.all([
    db.collection("players").orderBy("name").get(),
    db.collection("meta").doc("pool").get(),
    db.collection("assignments").get(),
    db.collection("weeklyResults").get(),
    db.collection("transactions").orderBy("createdAt", "desc").get(),
  ]);
  const players = playersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const meta = metaSnap.exists ? metaSnap.data() : { currentWeek: 1 };
  const assignments = assignSnap.docs.map(d => d.data());
  const weeklyResults = {};
  resultsSnap.docs.forEach(d => { weeklyResults[Number(d.id)] = d.data(); });
  const transactions = txSnap.docs.map(d => d.data());
  POOL = { players, meta, assignments, weeklyResults, transactions };
  return POOL;
}

function ownerName(players, assignments, week, teamAbbr) {
  const rosters = currentRosters(players, assignments, week);
  for (const p of players) {
    if ((rosters[p.id] || []).includes(teamAbbr)) return p.name;
  }
  return null;
}

// =================================================================
// STANDINGS & TEAMS TAB
// =================================================================

function renderStandings(players, assignments, weeklyResults, week) {
  const el = document.getElementById("standings");
  const flatResults = {};
  Object.entries(weeklyResults).forEach(([w, doc]) => { flatResults[w] = doc.results || {}; });
  const standings = computeStandings(players, assignments, flatResults, week);
  el.innerHTML = standings.map((p, i) => `
    <div class="standing-row ${i === 0 ? 'lead' : ''}">
      <div class="standing-rank">${i + 1}</div>
      <div class="standing-name">${p.name}</div>
      <div class="standing-record">${p.record.w}-${p.record.l}${p.record.t ? '-' + p.record.t : ''}</div>
      <div class="standing-points">${p.points}<span>pts</span></div>
    </div>
  `).join("");
}

function renderRosters(players, assignments, weeklyResults, week) {
  const el = document.getElementById("rosters");
  const rosters = currentRosters(players, assignments, week);
  el.innerHTML = players.map(p => {
    const teams = (rosters[p.id] || []).sort();
    const chips = teams.map(abbr => {
      const dots = [];
      for (let w = 1; w <= week; w++) {
        const r = (weeklyResults[w]?.results || {})[abbr];
        if (r) dots.push(`<span class="dot ${r.toLowerCase()}"></span>`);
      }
      return `<div class="team-chip">
        <span class="abbr">${abbr} — ${TEAM_BY_ABBR[abbr]?.name || abbr}</span>
        <span class="result-dots">${dots.join("")}</span>
      </div>`;
    }).join("");
    return `<div class="roster-card">
      <h3>${p.name}</h3>
      <div class="team-chip-list">${chips || '<div class="empty-note">No teams assigned yet.</div>'}</div>
    </div>`;
  }).join("");
}

function renderUnused(players, assignments, week) {
  const el = document.getElementById("unusedPool");
  const unused = unusedTeams(players, assignments, week).sort();
  el.innerHTML = unused.length
    ? unused.map(abbr => `<div class="unused-chip">${abbr} — ${TEAM_BY_ABBR[abbr]?.name || abbr}</div>`).join("")
    : '<div class="empty-note">All teams are currently assigned.</div>';
}

function renderTicker(transactions) {
  const el = document.getElementById("ticker");
  if (!transactions.length) {
    el.innerHTML = '<div class="empty-note">No transactions yet.</div>';
    return;
  }
  el.innerHTML = transactions.map(t => `
    <div class="ticker-item">
      <span class="who">${t.summary}</span>
      <span class="meta">Week ${t.effectiveWeek}</span>
    </div>
  `).join("");
}

async function loadStandingsTab() {
  try {
    const { players, meta, assignments, weeklyResults, transactions } = await loadPoolState();
    const week = meta.currentWeek || 1;

    document.getElementById("weekPill").textContent = `Week ${week}`;
    document.getElementById("rosterHint").textContent = `As of week ${week}`;

    if (!players.length) {
      document.getElementById("standings").innerHTML =
        '<div class="empty-note">No players set up yet. Head to the Admin tab to get started.</div>';
      return;
    }

    renderStandings(players, assignments, weeklyResults, week);
    renderRosters(players, assignments, weeklyResults, week);
    renderUnused(players, assignments, week);
    renderTicker(transactions);

    if (meta.lastSyncedAt) {
      const d = meta.lastSyncedAt.toDate ? meta.lastSyncedAt.toDate() : new Date(meta.lastSyncedAt);
      document.getElementById("lastSynced").textContent = `Scores last synced ${d.toLocaleString()}`;
    }
  } catch (err) {
    console.error(err);
    document.getElementById("standings").innerHTML =
      `<div class="empty-note">Couldn't load pool data. Check the Firebase config in js/firebase-config.js. (${err.message})</div>`;
  }
}

// =================================================================
// WEEKLY RESULTS TAB
// =================================================================

let weeklyLoaded = false;

async function loadWeeklyTab() {
  weeklyLoaded = true;
  const el = document.getElementById("weeklyResultsList");
  try {
    const { players, meta, assignments, weeklyResults } = await loadPoolState();
    const week = meta.currentWeek || 1;
    document.getElementById("weeklyHint").textContent = `Through week ${week}`;

    const weeksWithData = Object.keys(weeklyResults).map(Number).filter(w => w <= week).sort((a, b) => b - a);

    if (!weeksWithData.length) {
      el.innerHTML = '<div class="empty-note">No results synced yet. The commissioner can sync scores from the Admin tab.</div>';
      return;
    }

    el.innerHTML = weeksWithData.map(w => {
      const doc = weeklyResults[w] || {};
      const games = doc.games;
      let body;
      if (games && games.length) {
        body = games.map(g => {
          const homeOwner = g.home ? ownerName(players, assignments, w, g.home) : null;
          const awayOwner = g.away ? ownerName(players, assignments, w, g.away) : null;
          const homeWin = g.winner && g.winner === g.home;
          const awayWin = g.winner && g.winner === g.away;
          return `
            <div class="game-row">
              <div class="game-team ${awayWin ? 'winner' : ''}">
                <span class="name">${g.away || '—'}${awayOwner ? ` <span class="owner-tag">(${awayOwner})</span>` : ''}</span>
              </div>
              <div class="game-score">${g.final ? `${g.awayScore}–${g.homeScore}` : (g.status || 'Scheduled')}</div>
              <div class="game-team right ${homeWin ? 'winner' : ''}">
                <span class="name">${g.home || '—'}${homeOwner ? ` <span class="owner-tag">(${homeOwner})</span>` : ''}</span>
              </div>
            </div>`;
        }).join("");
      } else {
        const results = doc.results || {};
        body = Object.entries(results).map(([team, outcome]) => {
          const owner = ownerName(players, assignments, w, team);
          return `<div class="game-row">
            <div class="game-team"><span class="name">${team}${owner ? ` <span class="owner-tag">(${owner})</span>` : ''}</span></div>
            <div class="game-score">${outcome}</div>
            <div class="game-team right"></div>
          </div>`;
        }).join("") || '<div class="empty-note">No games recorded.</div>';
      }
      return `<div class="week-block">
        <div class="week-block-head">Week ${w}</div>
        ${body}
      </div>`;
    }).join("");
  } catch (err) {
    console.error(err);
    el.innerHTML = `<div class="empty-note">Couldn't load weekly results. (${err.message})</div>`;
  }
}

// =================================================================
// ADMIN TAB — PIN gate + controls
// =================================================================

function renderPinGate(mode, errorMsg) {
  const el = document.getElementById("pinGate");
  document.getElementById("adminArea").classList.add("hidden");
  el.classList.remove("hidden");

  const isSetup = mode === "setup";
  el.innerHTML = `
    <div class="pin-card">
      <h2>${isSetup ? "Set your admin PIN" : "Commissioner access"}</h2>
      <p>${isSetup ? "No PIN has been set up yet. Choose a 4-digit PIN — you'll use it every time you come back to this tab." : "Enter the 4-digit PIN to manage the pool."}</p>
      <input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" class="pin-input" id="pinInput" placeholder="••••">
      <button id="pinSubmitBtn">${isSetup ? "Set PIN" : "Unlock"}</button>
      ${errorMsg ? `<div class="status-msg err">${errorMsg}</div>` : ""}
    </div>
  `;

  const input = document.getElementById("pinInput");
  const submit = async () => {
    const pin = input.value.trim();
    if (!/^\d{4}$/.test(pin)) {
      renderPinGate(mode, "PIN must be exactly 4 digits.");
      return;
    }
    try {
      if (isSetup) {
        await auth.createUserWithEmailAndPassword(ADMIN_EMAIL, pinToPassword(pin));
      } else {
        await auth.signInWithEmailAndPassword(ADMIN_EMAIL, pinToPassword(pin));
      }
      // onAuthStateChanged takes it from here.
    } catch (err) {
      const msg = err.code === "auth/wrong-password" || err.code === "auth/invalid-credential"
        ? "Incorrect PIN." : err.message;
      renderPinGate(mode, msg);
    }
  };
  document.getElementById("pinSubmitBtn").addEventListener("click", submit);
  input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
  input.focus();
}

async function initAdminGate() {
  auth.onAuthStateChanged(async user => {
    if (user && user.email === ADMIN_EMAIL) {
      document.getElementById("pinGate").classList.add("hidden");
      document.getElementById("adminArea").classList.remove("hidden");
      await renderAdmin();
    } else {
      let mode = "signin";
      try {
        const methods = await auth.fetchSignInMethodsForEmail(ADMIN_EMAIL);
        if (!methods.length) mode = "setup";
      } catch (e) { /* default to signin prompt */ }
      renderPinGate(mode);
    }
  });
}

// ---------- Admin panel content ----------

let ADMIN_STATE = null;

async function loadAdminState() {
  await loadPoolState(true); // force fresh
  ADMIN_STATE = POOL;
}

function txUsedByPlayer(playerId) {
  return ADMIN_STATE.transactions.filter(t => (t.chargedTo || []).includes(playerId)).length;
}

function teamOptions(list, selected) {
  return list.map(abbr => `<option value="${abbr}" ${abbr === selected ? "selected" : ""}>${abbr} — ${TEAM_BY_ABBR[abbr]?.name || abbr}</option>`).join("");
}

function showStatus(id, msg, ok) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="status-msg ${ok ? "ok" : "err"}">${msg}</div>`;
}

async function renderAdmin() {
  await loadAdminState();
  const { players, meta } = ADMIN_STATE;
  const week = meta.currentWeek || 1;
  const adminArea = document.getElementById("adminArea");

  let html = `<div style="text-align:right; margin-bottom:16px;">
    <button class="secondary" id="signOutBtn">Lock admin tab</button>
  </div>`;

  if (players.length === 0) {
    html += `
      <div class="admin-card">
        <h2>Set up players</h2>
        <p class="tx-remaining">Enter the 5 names in your pool, then save. You only do this once.</p>
        <div class="field">${[1,2,3,4,5].map(n => `
          <label>Player ${n}</label>
          <input type="text" id="playerName${n}" placeholder="Name">
        `).join("<br>")}</div>
        <button id="createPlayersBtn">Save players</button>
        <div id="createPlayersStatus"></div>
      </div>
    `;
  } else {
    html += `
      <div class="admin-card">
        <h2>Current week</h2>
        <div class="row">
          <div class="field">
            <label for="weekInput">Week number</label>
            <input type="number" id="weekInput" min="1" max="22" value="${week}">
          </div>
          <div class="field" style="display:flex; align-items:flex-end;">
            <button id="saveWeekBtn">Save week</button>
          </div>
        </div>
        <div class="row">
          <div class="field" style="display:flex; align-items:flex-end;">
            <button id="syncBtn">Sync scores for week ${week} from ESPN</button>
          </div>
        </div>
        <div id="syncStatus"></div>
      </div>
    `;

    html += renderRosterAssignment(players, week);
    html += renderSwapForm(players, week);
    html += renderTradeForm(players, week);
    html += renderOverrideForm(week);

    html += `
      <div class="admin-card">
        <h2>Transactions used (max ${MAX_TRANSACTIONS} per player)</h2>
        <table class="admin-table">
          <tr><th>Player</th><th>Used</th><th>Remaining</th></tr>
          ${players.map(p => {
            const used = txUsedByPlayer(p.id);
            return `<tr><td>${p.name}</td><td>${used}</td><td>${Math.max(0, MAX_TRANSACTIONS - used)}</td></tr>`;
          }).join("")}
        </table>
      </div>
    `;

    html += `
      <div class="admin-card">
        <h2>Transaction log</h2>
        ${ADMIN_STATE.transactions.length ? `<table class="admin-table">
          <tr><th>Week</th><th>Summary</th></tr>
          ${ADMIN_STATE.transactions.map(t => `<tr><td>${t.effectiveWeek}</td><td>${t.summary}</td></tr>`).join("")}
        </table>` : '<p class="tx-remaining">No transactions yet.</p>'}
      </div>
    `;
  }

  adminArea.innerHTML = html;
  attachAdminHandlers(players, week);
}

function renderRosterAssignment(players, week) {
  const rosters = currentRosters(players, ADMIN_STATE.assignments, week);
  return `
    <div class="admin-card">
      <h2>Team assignments</h2>
      <p class="tx-remaining">Set which teams a player currently has — for initial draft or to correct a mistake. This does <strong>not</strong> count against the 5-transaction limit; use Swap or Trade below for in-season moves so the limit stays accurate.</p>
      <div class="row">
        <div class="field">
          <label for="assignPlayer">Player</label>
          <select id="assignPlayer">${players.map(p => `<option value="${p.id}">${p.name} (${rosters[p.id]?.length || 0}/5)</option>`).join("")}</select>
        </div>
        <div class="field">
          <label for="assignTeam">Team</label>
          <select id="assignTeam">${teamOptions(NFL_TEAMS.map(t => t.abbr))}</select>
        </div>
        <div class="field" style="display:flex; align-items:flex-end;">
          <button id="assignBtn">Assign to player</button>
        </div>
      </div>
      <div id="assignStatus"></div>
    </div>
  `;
}

function renderSwapForm(players, week) {
  return `
    <div class="admin-card">
      <h2>Swap a team</h2>
      <p class="tx-remaining">Swap one of a player's teams for one currently unused. Counts as 1 transaction for that player.</p>
      <div class="row">
        <div class="field">
          <label for="swapPlayer">Player</label>
          <select id="swapPlayer">${players.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label for="swapOut">Team to give up</label>
          <select id="swapOut"></select>
        </div>
        <div class="field">
          <label for="swapIn">Team to receive</label>
          <select id="swapIn"></select>
        </div>
        <div class="field">
          <label for="swapWeek">Effective week</label>
          <input type="number" id="swapWeek" min="1" max="22" value="${week}">
        </div>
      </div>
      <button id="swapBtn">Record swap</button>
      <div id="swapStatus"></div>
    </div>
  `;
}

function renderTradeForm(players, week) {
  return `
    <div class="admin-card">
      <h2>Trade between two players</h2>
      <p class="tx-remaining">Each player gives up one team and receives the other's. Counts as 1 transaction for each.</p>
      <div class="row">
        <div class="field">
          <label for="tradeP1">Player A</label>
          <select id="tradeP1">${players.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label for="tradeP1Team">Player A gives</label>
          <select id="tradeP1Team"></select>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="tradeP2">Player B</label>
          <select id="tradeP2">${players.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label for="tradeP2Team">Player B gives</label>
          <select id="tradeP2Team"></select>
        </div>
      </div>
      <div class="field" style="max-width:160px;">
        <label for="tradeWeek">Effective week</label>
        <input type="number" id="tradeWeek" min="1" max="22" value="${week}">
      </div>
      <button id="tradeBtn">Record trade</button>
      <div id="tradeStatus"></div>
    </div>
  `;
}

function renderOverrideForm(week) {
  return `
    <div class="admin-card">
      <h2>Manual score override</h2>
      <p class="tx-remaining">Use this only if the ESPN sync missed a game or got something wrong.</p>
      <div class="row">
        <div class="field">
          <label for="ovWeek">Week</label>
          <input type="number" id="ovWeek" min="1" max="22" value="${week}">
        </div>
        <div class="field">
          <label for="ovTeam">Team</label>
          <select id="ovTeam">${teamOptions(NFL_TEAMS.map(t => t.abbr))}</select>
        </div>
        <div class="field">
          <label for="ovResult">Result</label>
          <select id="ovResult">
            <option value="W">Win</option>
            <option value="L">Loss</option>
            <option value="T">Tie</option>
          </select>
        </div>
        <div class="field" style="display:flex; align-items:flex-end;">
          <button id="ovBtn">Save result</button>
        </div>
      </div>
      <div id="ovStatus"></div>
    </div>
  `;
}

function attachAdminHandlers(players, week) {
  const signOutBtn = document.getElementById("signOutBtn");
  if (signOutBtn) signOutBtn.addEventListener("click", () => auth.signOut());

  const createBtn = document.getElementById("createPlayersBtn");
  if (createBtn) {
    createBtn.addEventListener("click", async () => {
      const names = [1,2,3,4,5].map(n => document.getElementById(`playerName${n}`).value.trim());
      if (names.some(n => !n)) {
        showStatus("createPlayersStatus", "Enter all 5 names.", false);
        return;
      }
      try {
        const batch = db.batch();
        names.forEach((name, i) => {
          batch.set(db.collection("players").doc(`p${i + 1}`), { name });
        });
        batch.set(db.collection("meta").doc("pool"), { currentWeek: 1 }, { merge: true });
        await batch.commit();
        await renderAdmin();
      } catch (err) {
        showStatus("createPlayersStatus", err.message, false);
      }
    });
  }

  const assignBtn = document.getElementById("assignBtn");
  if (assignBtn) {
    assignBtn.addEventListener("click", async () => {
      const player = document.getElementById("assignPlayer").value;
      const team = document.getElementById("assignTeam").value;
      try {
        await db.collection("assignments").add({ team, player, effectiveWeek: week, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        await renderAdmin();
      } catch (err) {
        showStatus("assignStatus", err.message, false);
      }
    });
  }

  const swapPlayerSel = document.getElementById("swapPlayer");
  const swapOutSel = document.getElementById("swapOut");
  const swapInSel = document.getElementById("swapIn");
  if (swapPlayerSel) {
    const rosters = currentRosters(players, ADMIN_STATE.assignments, week);
    const unused = unusedTeams(players, ADMIN_STATE.assignments, week).sort();
    const refreshOut = () => { swapOutSel.innerHTML = teamOptions((rosters[swapPlayerSel.value] || []).sort()); };
    swapInSel.innerHTML = teamOptions(unused);
    swapPlayerSel.addEventListener("change", refreshOut);
    refreshOut();

    document.getElementById("swapBtn").addEventListener("click", async () => {
      const player = swapPlayerSel.value;
      const teamOut = swapOutSel.value;
      const teamIn = swapInSel.value;
      const effectiveWeek = Number(document.getElementById("swapWeek").value) || week;
      const used = txUsedByPlayer(player);
      if (used >= MAX_TRANSACTIONS) {
        showStatus("swapStatus", `${players.find(p=>p.id===player)?.name} has already used all ${MAX_TRANSACTIONS} transactions.`, false);
        return;
      }
      if (!teamOut || !teamIn) {
        showStatus("swapStatus", "Pick both a team to give up and a team to receive.", false);
        return;
      }
      try {
        const batch = db.batch();
        batch.set(db.collection("assignments").doc(), { team: teamOut, player: null, effectiveWeek, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        batch.set(db.collection("assignments").doc(), { team: teamIn, player, effectiveWeek, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        const playerName = players.find(p => p.id === player)?.name || player;
        batch.set(db.collection("transactions").doc(), {
          summary: `${playerName} swapped ${teamOut} for ${teamIn}`,
          chargedTo: [player],
          effectiveWeek,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        await batch.commit();
        await renderAdmin();
      } catch (err) {
        showStatus("swapStatus", err.message, false);
      }
    });
  }

  const tp1 = document.getElementById("tradeP1");
  const tp2 = document.getElementById("tradeP2");
  if (tp1 && tp2) {
    const rosters = currentRosters(players, ADMIN_STATE.assignments, week);
    const t1Sel = document.getElementById("tradeP1Team");
    const t2Sel = document.getElementById("tradeP2Team");
    const refresh1 = () => { t1Sel.innerHTML = teamOptions((rosters[tp1.value] || []).sort()); };
    const refresh2 = () => { t2Sel.innerHTML = teamOptions((rosters[tp2.value] || []).sort()); };
    tp1.addEventListener("change", refresh1);
    tp2.addEventListener("change", refresh2);
    refresh1(); refresh2();

    document.getElementById("tradeBtn").addEventListener("click", async () => {
      const playerA = tp1.value, playerB = tp2.value;
      const teamA = t1Sel.value, teamB = t2Sel.value;
      const effectiveWeek = Number(document.getElementById("tradeWeek").value) || week;
      if (playerA === playerB) {
        showStatus("tradeStatus", "Pick two different players.", false);
        return;
      }
      const usedA = txUsedByPlayer(playerA), usedB = txUsedByPlayer(playerB);
      if (usedA >= MAX_TRANSACTIONS || usedB >= MAX_TRANSACTIONS) {
        showStatus("tradeStatus", "One of these players has no transactions remaining.", false);
        return;
      }
      if (!teamA || !teamB) {
        showStatus("tradeStatus", "Both players need a team to trade.", false);
        return;
      }
      try {
        const batch = db.batch();
        batch.set(db.collection("assignments").doc(), { team: teamA, player: playerB, effectiveWeek, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        batch.set(db.collection("assignments").doc(), { team: teamB, player: playerA, effectiveWeek, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        const nameA = players.find(p => p.id === playerA)?.name || playerA;
        const nameB = players.find(p => p.id === playerB)?.name || playerB;
        batch.set(db.collection("transactions").doc(), {
          summary: `${nameA} traded ${teamA} to ${nameB} for ${teamB}`,
          chargedTo: [playerA, playerB],
          effectiveWeek,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        await batch.commit();
        await renderAdmin();
      } catch (err) {
        showStatus("tradeStatus", err.message, false);
      }
    });
  }

  const saveWeekBtn = document.getElementById("saveWeekBtn");
  if (saveWeekBtn) {
    saveWeekBtn.addEventListener("click", async () => {
      const newWeek = Number(document.getElementById("weekInput").value);
      try {
        await db.collection("meta").doc("pool").set({ currentWeek: newWeek }, { merge: true });
        await renderAdmin();
      } catch (err) {
        showStatus("syncStatus", err.message, false);
      }
    });
  }

  const syncBtn = document.getElementById("syncBtn");
  if (syncBtn) {
    syncBtn.addEventListener("click", async () => {
      syncBtn.disabled = true;
      showStatus("syncStatus", "Fetching from ESPN…", true);
      try {
        const { results, games } = await fetchWeekResults(week);
        if (Object.keys(results).length === 0 && games.length === 0) {
          showStatus("syncStatus", "No games found for this week yet.", false);
        } else {
          await db.collection("weeklyResults").doc(String(week)).set({ results, games }, { merge: true });
          await db.collection("meta").doc("pool").set({ lastSyncedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
          const finalCount = Object.keys(results).length;
          showStatus("syncStatus", `Synced ${games.length} games (${finalCount} finished) for week ${week}.`, true);
          weeklyLoaded = false;
        }
      } catch (err) {
        showStatus("syncStatus", err.message, false);
      } finally {
        syncBtn.disabled = false;
      }
    });
  }

  const ovBtn = document.getElementById("ovBtn");
  if (ovBtn) {
    ovBtn.addEventListener("click", async () => {
      const ovWeek = document.getElementById("ovWeek").value;
      const team = document.getElementById("ovTeam").value;
      const result = document.getElementById("ovResult").value;
      try {
        await db.collection("weeklyResults").doc(String(ovWeek)).set({ [`results.${team}`]: result }, { merge: true });
        showStatus("ovStatus", `Saved: ${team} = ${result} for week ${ovWeek}.`, true);
        weeklyLoaded = false;
      } catch (err) {
        showStatus("ovStatus", err.message, false);
      }
    });
  }
}

// =================================================================
// BOOT
// =================================================================

loadStandingsTab();
initAdminGate();
