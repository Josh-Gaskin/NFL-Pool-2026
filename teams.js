// Master list of all 32 NFL teams.
// `espn` is the abbreviation ESPN's public scoreboard API uses for this team —
// used to match fetched game results back to a team in the pool.
const NFL_TEAMS = [
  { abbr: "ARI", espn: "ARI", name: "Arizona Cardinals",    conf: "NFC", div: "West" },
  { abbr: "ATL", espn: "ATL", name: "Atlanta Falcons",      conf: "NFC", div: "South" },
  { abbr: "BAL", espn: "BAL", name: "Baltimore Ravens",     conf: "AFC", div: "North" },
  { abbr: "BUF", espn: "BUF", name: "Buffalo Bills",        conf: "AFC", div: "East" },
  { abbr: "CAR", espn: "CAR", name: "Carolina Panthers",    conf: "NFC", div: "South" },
  { abbr: "CHI", espn: "CHI", name: "Chicago Bears",        conf: "NFC", div: "North" },
  { abbr: "CIN", espn: "CIN", name: "Cincinnati Bengals",   conf: "AFC", div: "North" },
  { abbr: "CLE", espn: "CLE", name: "Cleveland Browns",     conf: "AFC", div: "North" },
  { abbr: "DAL", espn: "DAL", name: "Dallas Cowboys",       conf: "NFC", div: "East" },
  { abbr: "DEN", espn: "DEN", name: "Denver Broncos",       conf: "AFC", div: "West" },
  { abbr: "DET", espn: "DET", name: "Detroit Lions",        conf: "NFC", div: "North" },
  { abbr: "GB",  espn: "GB",  name: "Green Bay Packers",    conf: "NFC", div: "North" },
  { abbr: "HOU", espn: "HOU", name: "Houston Texans",       conf: "AFC", div: "South" },
  { abbr: "IND", espn: "IND", name: "Indianapolis Colts",   conf: "AFC", div: "South" },
  { abbr: "JAX", espn: "JAX", name: "Jacksonville Jaguars", conf: "AFC", div: "South" },
  { abbr: "KC",  espn: "KC",  name: "Kansas City Chiefs",   conf: "AFC", div: "West" },
  { abbr: "LV",  espn: "LV",  name: "Las Vegas Raiders",    conf: "AFC", div: "West" },
  { abbr: "LAC", espn: "LAC", name: "Los Angeles Chargers", conf: "AFC", div: "West" },
  { abbr: "LAR", espn: "LAR", name: "Los Angeles Rams",     conf: "NFC", div: "West" },
  { abbr: "MIA", espn: "MIA", name: "Miami Dolphins",       conf: "AFC", div: "East" },
  { abbr: "MIN", espn: "MIN", name: "Minnesota Vikings",    conf: "NFC", div: "North" },
  { abbr: "NE",  espn: "NE",  name: "New England Patriots", conf: "AFC", div: "East" },
  { abbr: "NO",  espn: "NO",  name: "New Orleans Saints",   conf: "NFC", div: "South" },
  { abbr: "NYG", espn: "NYG", name: "New York Giants",      conf: "NFC", div: "East" },
  { abbr: "NYJ", espn: "NYJ", name: "New York Jets",        conf: "AFC", div: "East" },
  { abbr: "PHI", espn: "PHI", name: "Philadelphia Eagles",  conf: "NFC", div: "East" },
  { abbr: "PIT", espn: "PIT", name: "Pittsburgh Steelers",  conf: "AFC", div: "North" },
  { abbr: "SF",  espn: "SF",  name: "San Francisco 49ers",  conf: "NFC", div: "West" },
  { abbr: "SEA", espn: "SEA", name: "Seattle Seahawks",     conf: "NFC", div: "West" },
  { abbr: "TB",  espn: "TB",  name: "Tampa Bay Buccaneers", conf: "NFC", div: "South" },
  { abbr: "TEN", espn: "TEN", name: "Tennessee Titans",     conf: "AFC", div: "South" },
  { abbr: "WSH", espn: "WSH", name: "Washington Commanders",conf: "NFC", div: "East" },
];

const TEAM_BY_ABBR = Object.fromEntries(NFL_TEAMS.map(t => [t.abbr, t]));
