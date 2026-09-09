// ---------------------------------------------------------------
// Shared logic used by both the public dashboard and the admin panel.
// ---------------------------------------------------------------

/**
 * Fetch final results for one NFL week from ESPN's public scoreboard API.
 * No API key needed — this is the same feed espn.com's site uses.
 * Returns:
 *   results: { TEAM_ABBR: "W" | "L" | "T" } for games that have finished
 *   games:   [{ home, away, homeScore, awayScore, winner, final }] for
 *            every game found (final or not) — used for the weekly results view
 */
async function fetchWeekResults(week, seasonYear = SEASON_YEAR) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&year=${seasonYear}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN API request failed: ${res.status}`);
  const data = await res.json();

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
      if (homeScore === awayScore) {
        results[homeAbbr] = "T";
        results[awayAbbr] = "T";
      } else if (homeScore > awayScore) {
        results[homeAbbr] = "W";
        results[awayAbbr] = "L";
        winner = homeAbbr;
      } else {
        results[homeAbbr] = "L";
        results[awayAbbr] = "W";
        winner = awayAbbr;
      }
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

/**
 * Build a per-week ownership map from the assignment log.
 * assignments: array of { team, player, effectiveWeek }, any order.
 * Returns a function owner(team, week) -> playerId | null
 */
function buildOwnershipResolver(assignments) {
  const byTeam = {};
  for (const a of assignments) {
    if (!byTeam[a.team]) byTeam[a.team] = [];
    byTeam[a.team].push(a);
  }
  for (const team in byTeam) {
    byTeam[team].sort((x, y) => x.effectiveWeek - y.effectiveWeek);
  }
  return function owner(team, week) {
    const events = byTeam[team] || [];
    let current = null;
    for (const e of events) {
      if (e.effectiveWeek <= week) current = e.player;
      else break;
    }
    return current;
  };
}

/**
 * Compute season standings.
 * players: [{id, name}]
 * assignments: [{team, player, effectiveWeek}]
 * weeklyResults: { [week]: { TEAM: "W"|"L"|"T" } }
 * upToWeek: highest week to include
 */
function computeStandings(players, assignments, weeklyResults, upToWeek) {
  const owner = buildOwnershipResolver(assignments);
  const points = Object.fromEntries(players.map(p => [p.id, 0]));
  const record = Object.fromEntries(players.map(p => [p.id, { w: 0, l: 0, t: 0 }]));

  for (let week = 1; week <= upToWeek; week++) {
    const results = weeklyResults[week] || {};
    for (const [team, outcome] of Object.entries(results)) {
      const playerId = owner(team, week);
      if (!playerId || !points.hasOwnProperty(playerId)) continue; // unused team, no scoring
      if (outcome === "W") { points[playerId] += 10; record[playerId].w++; }
      else if (outcome === "T") { points[playerId] += 5; record[playerId].t++; }
      else if (outcome === "L") { record[playerId].l++; }
    }
  }

  return players
    .map(p => ({ ...p, points: points[p.id], record: record[p.id] }))
    .sort((a, b) => b.points - a.points);
}

/** Which teams each player currently owns, as of a given week. */
function currentRosters(players, assignments, week) {
  const owner = buildOwnershipResolver(assignments);
  const rosters = Object.fromEntries(players.map(p => [p.id, []]));
  for (const team of NFL_TEAMS) {
    const playerId = owner(team.abbr, week);
    if (playerId && rosters[playerId]) rosters[playerId].push(team.abbr);
  }
  return rosters;
}

/** Teams owned by nobody as of a given week — the unused pool. */
function unusedTeams(players, assignments, week) {
  const owner = buildOwnershipResolver(assignments);
  return NFL_TEAMS.map(t => t.abbr).filter(abbr => !owner(abbr, week));
}
