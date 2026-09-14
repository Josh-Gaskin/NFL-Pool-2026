// Runs on a GitHub Actions schedule (see .github/workflows/sync-scores.yml).
// Fetches the current week's NFL scores from ESPN's public scoreboard and
// writes them into Firestore using the Firebase Admin SDK, which has full
// access regardless of Firestore Security Rules. That's safe here because
// the credential only ever lives in GitHub's encrypted secrets and this
// script only ever runs on GitHub's servers — it never reaches a browser.

const admin = require("firebase-admin");

function initAdmin() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT secret is not set.");
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

async function fetchScoreboard(week, year) {
  const params = new URLSearchParams({ seasontype: "2" });
  if (week) params.set("week", week);
  if (year) params.set("year", year);
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN request failed: ${res.status}`);
  return res.json();
}

function parseScoreboard(data) {
  const results = {};
  const games = [];
  for (const event of data.events || []) {
    const comp = event.competitions?.[0];
    if (!comp) continue;
    const competitors = comp.competitors || [];
    if (competitors.length !== 2) continue;
    const home = competitors.find(c => c.homeAway === "home") || competitors[0];
    const away = competitors.find(c => c.homeAway === "away") || competitors[1];
    const isFinal = comp.status?.type?.completed === true;
    const homeAbbr = home.team?.abbreviation;
    const awayAbbr = away.team?.abbreviation;
    const homeScore = Number(home.score);
    const awayScore = Number(away.score);
    let winner = null;
    if (isFinal && homeAbbr && awayAbbr) {
      if (homeScore === awayScore) { results[homeAbbr] = "T"; results[awayAbbr] = "T"; }
      else if (homeScore > awayScore) { results[homeAbbr] = "W"; results[awayAbbr] = "L"; winner = homeAbbr; }
      else { results[homeAbbr] = "L"; results[awayAbbr] = "W"; winner = awayAbbr; }
    }
    games.push({
      home: homeAbbr, away: awayAbbr,
      homeScore: isFinal ? homeScore : null,
      awayScore: isFinal ? awayScore : null,
      winner, final: isFinal,
      status: comp.status?.type?.shortDetail || "",
    });
  }
  return { results, games };
}

async function syncWeek(db, week, year) {
  const data = await fetchScoreboard(week, year);
  const { results, games } = parseScoreboard(data);
  if (!games.length) {
    console.log(`Week ${week}: no games found, skipping.`);
    return;
  }
  await db.collection("weeklyResults").doc(String(week)).set({ results, games }, { merge: true });
  console.log(`Week ${week}: synced ${games.length} games (${Object.keys(results).length} finished).`);
}

async function main() {
  initAdmin();
  const db = admin.firestore();

  // Ask ESPN what week it currently thinks we're in (no week/year params = "now").
  const nowData = await fetchScoreboard();
  const detectedWeek = nowData.week?.number;
  const seasonYear = nowData.season?.year;

  if (!detectedWeek) {
    console.log("Could not detect the current NFL week from ESPN — skipping this run.");
    return;
  }
  console.log(`ESPN reports current week as ${detectedWeek} (season ${seasonYear}).`);

  // Sync this week and the one before it — catches Monday night games that
  // finalize right around when ESPN flips its "current week" pointer over.
  const weeksToSync = detectedWeek > 1 ? [detectedWeek - 1, detectedWeek] : [detectedWeek];
  for (const w of weeksToSync) {
    await syncWeek(db, w, seasonYear);
  }

  // Advance the pool's "current week" to match, but never move it backwards —
  // the commissioner may have deliberately set it ahead of ESPN's number.
  const metaRef = db.collection("meta").doc("pool");
  const metaSnap = await metaRef.get();
  const currentWeek = metaSnap.exists ? (metaSnap.data().currentWeek || 1) : 1;
  const update = { lastAutoSyncAt: admin.firestore.FieldValue.serverTimestamp() };
  if (detectedWeek > currentWeek) {
    update.currentWeek = detectedWeek;
    console.log(`Advancing pool's current week from ${currentWeek} to ${detectedWeek}.`);
  }
  await metaRef.set(update, { merge: true });

  console.log("Sync complete.");
}

main().catch(err => {
  console.error("Sync failed:", err);
  process.exit(1);
});
