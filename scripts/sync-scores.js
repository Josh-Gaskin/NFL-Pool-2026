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

  // Use ESPN's sense of "now" just to get the season year reliably
  // (works whether we're mid-season or right at a season boundary).
  const nowData = await fetchScoreboard();
  const seasonYear = nowData.season?.year;

  const metaRef = db.collection("meta").doc("pool");
  const metaSnap = await metaRef.get();
  let currentWeek = metaSnap.exists ? (metaSnap.data().currentWeek || 1) : 1;
  console.log(`Pool's current week is ${currentWeek} (season ${seasonYear}).`);

  // Always resync the currently displayed week — catches any games that
  // finished or updated since the last run.
  await syncWeek(db, currentWeek, seasonYear);

  // Only roll the displayed week forward once the NEXT week's first game
  // has actually kicked off — not just because ESPN's own "current week"
  // pointer has flipped over, which can happen earlier than that.
  const nextWeek = currentWeek + 1;
  const nextData = await fetchScoreboard(nextWeek, seasonYear);
  const kickoffs = (nextData.events || [])
    .map(e => (e.date ? new Date(e.date).getTime() : null))
    .filter(Boolean);

  if (kickoffs.length) {
    const earliestKickoff = Math.min(...kickoffs);
    if (Date.now() >= earliestKickoff) {
      console.log(`Week ${nextWeek}'s first game has started — advancing the current week.`);
      currentWeek = nextWeek;
      await syncWeek(db, currentWeek, seasonYear);
    } else {
      console.log(`Week ${nextWeek} hasn't started yet (first kickoff: ${new Date(earliestKickoff).toISOString()}). Staying on week ${currentWeek}.`);
    }
  } else {
    console.log(`No schedule data yet for week ${nextWeek}.`);
  }

  await metaRef.set(
    { currentWeek, lastAutoSyncAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  console.log("Sync complete.");
}

main().catch(err => {
  console.error("Sync failed:", err);
  process.exit(1);
});
