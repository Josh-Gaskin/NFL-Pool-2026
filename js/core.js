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

// ---------------------------------------------------------------
// "Right now" possession vs. "as of week W" scoring credit.
//
// A swap or trade updates the roster immediately, but its effectiveWeek
// is set to next week — so scoring only starts crediting the new owner
// from then on. That means "who has this team right now" (for the roster
// and free-agent displays) and "who does this week's points belong to"
// (for standings) can briefly disagree, on purpose. The functions above
// (buildOwnershipResolver, currentRosters, unusedTeams) answer the second
// question. The functions below answer the first.
// ---------------------------------------------------------------

/** Latest assignment per team, regardless of effectiveWeek. */
function currentOwnerMap(assignments) {
  const byTeam = {};
  for (const a of assignments) {
    if (!byTeam[a.team]) byTeam[a.team] = [];
    byTeam[a.team].push(a);
  }
  const owner = {};
  for (const team in byTeam) {
    const events = byTeam[team].slice().sort((a, b) => {
      if (a.effectiveWeek !== b.effectiveWeek) return a.effectiveWeek - b.effectiveWeek;
      const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return at - bt;
    });
    const last = events[events.length - 1];
    if (last.player) owner[team] = last.player;
  }
  return owner;
}

/** Current rosters right now, ignoring the scoring-effective-week lag. */
function currentRostersNow(players, assignments) {
  const owner = currentOwnerMap(assignments);
  const rosters = Object.fromEntries(players.map(p => [p.id, []]));
  for (const team of NFL_TEAMS) {
    const playerId = owner[team.abbr];
    if (playerId && rosters[playerId]) rosters[playerId].push(team.abbr);
  }
  return rosters;
}

/** Free-agent teams right now, ignoring the scoring-effective-week lag. */
function currentFreeAgentsNow(players, assignments) {
  const owner = currentOwnerMap(assignments);
  return NFL_TEAMS.map(t => t.abbr).filter(abbr => !owner[abbr]);
}

/**
 * For each team, its chronological ownership intervals:
 * [{ player, startWeek, endWeek }], where endWeek is null for whichever
 * interval is still in effect (the most recent one).
 */
function buildOwnershipIntervals(assignments) {
  const byTeam = {};
  for (const a of assignments) {
    if (!byTeam[a.team]) byTeam[a.team] = [];
    byTeam[a.team].push(a);
  }
  const result = {};
  for (const team in byTeam) {
    const events = byTeam[team].slice().sort((a, b) => {
      if (a.effectiveWeek !== b.effectiveWeek) return a.effectiveWeek - b.effectiveWeek;
      const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return at - bt;
    });
    result[team] = events.map((e, i) => ({
      player: e.player,
      startWeek: e.effectiveWeek,
      endWeek: i + 1 < events.length ? events[i + 1].effectiveWeek - 1 : null,
    }));
  }
  return result;
}

/**
 * A player's team history, split into "current" (teams whose most recent
 * ownership interval is this player's — i.e. they hold it right now) and
 * "previous" (teams they held at some point but no longer do).
 */
function playerTeamHistory(playerId, assignments) {
  const intervals = buildOwnershipIntervals(assignments);
  const current = [];
  const previous = [];
  for (const team in intervals) {
    const teamIntervals = intervals[team];
    teamIntervals.forEach((iv, idx) => {
      if (iv.player !== playerId) return;
      const isLast = idx === teamIntervals.length - 1;
      (isLast ? current : previous).push({ team, startWeek: iv.startWeek, endWeek: iv.endWeek });
    });
  }
  return { current, previous };
}

/**
 * Week-by-week status of one team from one player's point of view, for
 * weeks 1..uptoWeek. Used to draw the win/loss dot strip on a roster card.
 *
 *   'win' | 'loss' | 'tie' — team played, owned by this player that week
 *   'other'                 — team played, owned by someone else that week
 *   'bye'                   — no result recorded, and the week has already
 *                             passed (treated as a bye)
 *   'pending'                — no result recorded, and it's the current
 *                             week (game hasn't been played/synced yet)
 *
 * Summing just the 'win'/'loss'/'tie' dots for a player's teams always
 * equals their official record — 'other', 'bye', and 'pending' dots are
 * deliberately excluded from that count.
 */
function teamWeekHistory(team, playerId, assignments, weeklyResults, uptoWeek) {
  const owner = buildOwnershipResolver(assignments);
  const weeks = [];
  for (let week = 1; week <= uptoWeek; week++) {
    const result = (weeklyResults[week] || {})[team];
    if (result) {
      const ownedByThisPlayer = owner(team, week) === playerId;
      let status;
      if (!ownedByThisPlayer) status = "other";
      else if (result === "W") status = "win";
      else if (result === "L") status = "loss";
      else status = "tie";
      weeks.push({ week, status });
    } else {
      weeks.push({ week, status: week < uptoWeek ? "bye" : "pending" });
    }
  }
  return weeks;
}
