import type { Team, Match } from "../types/tournament";

/**
 * Calculate the bracket size (next power of 2) and number of byes
 * needed for a given number of teams.
 */
export function calculateByes(teamCount: number): { bracketSize: number; numByes: number } {
  if (teamCount <= 0) return { bracketSize: 0, numByes: 0 };
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(teamCount)));
  const numByes = bracketSize - teamCount;
  return { bracketSize, numByes };
}

/**
 * Distribute teams into bye slots and regular match pairs.
 * Byes are front-loaded: the first numByes teams each get a bye,
 * and the remaining teams are paired sequentially.
 */
export function distributeTeams(teams: Team[]): {
  byeTeams: Team[];
  regularPairs: [Team, Team][];
} {
  const { numByes } = calculateByes(teams.length);
  const byeTeams = teams.slice(0, numByes);
  const remaining = teams.slice(numByes);

  const regularPairs: [Team, Team][] = [];
  for (let i = 0; i + 1 < remaining.length; i += 2) {
    regularPairs.push([remaining[i], remaining[i + 1]]);
  }

  return { byeTeams, regularPairs };
}

/**
 * Collect the winning team from each match in a completed round.
 * Bye matches (team2 === null) auto-advance team1.
 * Returns null for any match that hasn't been decided.
 */
export function collectRoundWinners(matches: Match[]): (Team | null)[] {
  return matches.map(match => {
    if (match.winningTeam === 1 && match.team1) return match.team1;
    if (match.winningTeam === 2 && match.team2) return match.team2;
    // Bye: no opponent, team1 advances automatically
    if (!match.team2 && match.team1) return match.team1;
    return null;
  });
}

/**
 * Pair up winners into next-round match pairs.
 * Assumes winners.length is always even (guaranteed by power-of-2 bracket).
 */
export function pairWinners(winners: Team[]): [Team, Team][] {
  const pairs: [Team, Team][] = [];
  for (let i = 0; i + 1 < winners.length; i += 2) {
    pairs.push([winners[i], winners[i + 1]]);
  }
  return pairs;
}

/**
 * Check whether all matches in a round are complete
 * (have a non-null, non-zero winningTeam or are a bye with no team2).
 */
export function isRoundComplete(matches: Match[]): boolean {
  return matches.every(m => {
    if (!m.team2) return true; // bye — always "complete" immediately
    return m.winningTeam !== null && m.winningTeam !== 0;
  });
}

/**
 * Return the 1-based queue position of a waiting, non-bye match
 * within the full match list. Returns 0 if the match is not in the queue
 * (i.e., it is a bye, is active/completed, or is not found).
 */
export function getQueuePosition(matches: Match[], playerMatch: Match): number {
  if (!playerMatch.team2) return 0; // byes have no queue position
  const waitingNonBye = matches
    .filter(m => m.status === "waiting" && m.team2 !== null)
    .sort((a, b) => a.round - b.round || a.id.localeCompare(b.id));
  const idx = waitingNonBye.findIndex(m => m.id === playerMatch.id);
  return idx === -1 ? 0 : idx + 1;
}
