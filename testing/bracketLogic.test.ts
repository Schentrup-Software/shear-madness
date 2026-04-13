import { describe, it, expect } from "vitest";
import {
  calculateByes,
  distributeTeams,
  collectRoundWinners,
  pairWinners,
  isRoundComplete,
  getQueuePosition,
} from "../app/utils/bracketLogic";
import type { Team, Match } from "../app/types/tournament";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTeam(id: string): Team {
  return {
    player1: { playerName: `${id}-p1`, id: `${id}-p1` },
    player2: { playerName: `${id}-p2`, id: `${id}-p2` },
  };
}

function makeMatch(overrides: Partial<Match> & { id: string }): Match {
  return {
    team1: null,
    team2: null,
    winningTeam: null,
    round: 1,
    status: "waiting",
    ...overrides,
  };
}

// ─── calculateByes ───────────────────────────────────────────────────────────

describe("calculateByes", () => {
  it("returns 0 byes when team count is already a power of 2", () => {
    expect(calculateByes(2)).toEqual({ bracketSize: 2, numByes: 0 });
    expect(calculateByes(4)).toEqual({ bracketSize: 4, numByes: 0 });
    expect(calculateByes(8)).toEqual({ bracketSize: 8, numByes: 0 });
    expect(calculateByes(16)).toEqual({ bracketSize: 16, numByes: 0 });
  });

  it("returns 1 bye for 3 teams (next power of 2 is 4)", () => {
    expect(calculateByes(3)).toEqual({ bracketSize: 4, numByes: 1 });
  });

  it("returns 3 byes for 5 teams (next power of 2 is 8)", () => {
    expect(calculateByes(5)).toEqual({ bracketSize: 8, numByes: 3 });
  });

  it("returns 2 byes for 6 teams", () => {
    expect(calculateByes(6)).toEqual({ bracketSize: 8, numByes: 2 });
  });

  it("returns 1 bye for 7 teams", () => {
    expect(calculateByes(7)).toEqual({ bracketSize: 8, numByes: 1 });
  });

  it("returns correct values for larger counts", () => {
    expect(calculateByes(9)).toEqual({ bracketSize: 16, numByes: 7 });
    expect(calculateByes(12)).toEqual({ bracketSize: 16, numByes: 4 });
    expect(calculateByes(15)).toEqual({ bracketSize: 16, numByes: 1 });
  });

  it("handles edge case of 0 teams", () => {
    expect(calculateByes(0)).toEqual({ bracketSize: 0, numByes: 0 });
  });

  it("handles edge case of 1 team", () => {
    const result = calculateByes(1);
    // Math.ceil(Math.log2(1)) = 0, so bracketSize = 1, numByes = 0
    expect(result).toEqual({ bracketSize: 1, numByes: 0 });
  });
});

// ─── distributeTeams ─────────────────────────────────────────────────────────

describe("distributeTeams", () => {
  it("produces no byes and 2 pairs for 4 teams", () => {
    const teams = [makeTeam("A"), makeTeam("B"), makeTeam("C"), makeTeam("D")];
    const { byeTeams, regularPairs } = distributeTeams(teams);
    expect(byeTeams).toHaveLength(0);
    expect(regularPairs).toHaveLength(2);
    expect(regularPairs[0]).toEqual([teams[0], teams[1]]);
    expect(regularPairs[1]).toEqual([teams[2], teams[3]]);
  });

  it("produces 1 bye and 1 pair for 3 teams", () => {
    const teams = [makeTeam("A"), makeTeam("B"), makeTeam("C")];
    const { byeTeams, regularPairs } = distributeTeams(teams);
    expect(byeTeams).toHaveLength(1);
    expect(byeTeams[0]).toBe(teams[0]); // first team gets the bye
    expect(regularPairs).toHaveLength(1);
    expect(regularPairs[0]).toEqual([teams[1], teams[2]]);
  });

  it("produces 3 byes and 1 pair for 5 teams", () => {
    const teams = [makeTeam("A"), makeTeam("B"), makeTeam("C"), makeTeam("D"), makeTeam("E")];
    const { byeTeams, regularPairs } = distributeTeams(teams);
    expect(byeTeams).toHaveLength(3);
    expect(byeTeams).toEqual([teams[0], teams[1], teams[2]]);
    expect(regularPairs).toHaveLength(1);
    expect(regularPairs[0]).toEqual([teams[3], teams[4]]);
  });

  it("produces 2 byes and 2 pairs for 6 teams", () => {
    const teams = [makeTeam("A"), makeTeam("B"), makeTeam("C"), makeTeam("D"), makeTeam("E"), makeTeam("F")];
    const { byeTeams, regularPairs } = distributeTeams(teams);
    expect(byeTeams).toHaveLength(2);
    expect(regularPairs).toHaveLength(2);
  });

  it("produces 1 bye and 3 pairs for 7 teams", () => {
    const teams = Array.from({ length: 7 }, (_, i) => makeTeam(String(i)));
    const { byeTeams, regularPairs } = distributeTeams(teams);
    expect(byeTeams).toHaveLength(1);
    expect(regularPairs).toHaveLength(3);
  });

  it("produces no byes and 4 pairs for 8 teams", () => {
    const teams = Array.from({ length: 8 }, (_, i) => makeTeam(String(i)));
    const { byeTeams, regularPairs } = distributeTeams(teams);
    expect(byeTeams).toHaveLength(0);
    expect(regularPairs).toHaveLength(4);
  });

  it("bye teams are always the first N teams in the array", () => {
    const teams = Array.from({ length: 6 }, (_, i) => makeTeam(String(i)));
    const { byeTeams } = distributeTeams(teams);
    expect(byeTeams[0]).toBe(teams[0]);
    expect(byeTeams[1]).toBe(teams[1]);
  });
});

// ─── collectRoundWinners ─────────────────────────────────────────────────────

describe("collectRoundWinners", () => {
  it("returns team1 when winningTeam is 1", () => {
    const t1 = makeTeam("A");
    const t2 = makeTeam("B");
    const match = makeMatch({ id: "m1", team1: t1, team2: t2, winningTeam: 1 });
    expect(collectRoundWinners([match])).toEqual([t1]);
  });

  it("returns team2 when winningTeam is 2", () => {
    const t1 = makeTeam("A");
    const t2 = makeTeam("B");
    const match = makeMatch({ id: "m1", team1: t1, team2: t2, winningTeam: 2 });
    expect(collectRoundWinners([match])).toEqual([t2]);
  });

  it("auto-advances team1 on a bye match (team2 is null, no winningTeam set)", () => {
    const t1 = makeTeam("A");
    const match = makeMatch({ id: "m1", team1: t1, team2: null, winningTeam: null });
    expect(collectRoundWinners([match])).toEqual([t1]);
  });

  it("returns null for an undecided regular match", () => {
    const match = makeMatch({ id: "m1", team1: makeTeam("A"), team2: makeTeam("B"), winningTeam: null });
    expect(collectRoundWinners([match])).toEqual([null]);
  });

  it("handles a mixed round: bye + decided + undecided", () => {
    const tA = makeTeam("A");
    const tB = makeTeam("B");
    const tC = makeTeam("C");
    const tD = makeTeam("D");
    const matches = [
      makeMatch({ id: "bye", team1: tA, team2: null, winningTeam: null }),     // bye → tA
      makeMatch({ id: "reg1", team1: tB, team2: tC, winningTeam: 1 }),         // decided → tB
      makeMatch({ id: "reg2", team1: tD, team2: makeTeam("E"), winningTeam: null }), // undecided → null
    ];
    expect(collectRoundWinners(matches)).toEqual([tA, tB, null]);
  });

  it("handles all byes in a round", () => {
    const teams = [makeTeam("A"), makeTeam("B"), makeTeam("C")];
    const matches = teams.map((t, i) =>
      makeMatch({ id: `bye${i}`, team1: t, team2: null, winningTeam: null })
    );
    expect(collectRoundWinners(matches)).toEqual(teams);
  });
});

// ─── pairWinners ─────────────────────────────────────────────────────────────

describe("pairWinners", () => {
  it("pairs 4 winners into 2 matches", () => {
    const teams = [makeTeam("A"), makeTeam("B"), makeTeam("C"), makeTeam("D")];
    const pairs = pairWinners(teams);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual([teams[0], teams[1]]);
    expect(pairs[1]).toEqual([teams[2], teams[3]]);
  });

  it("pairs 2 winners into 1 final match", () => {
    const teams = [makeTeam("A"), makeTeam("B")];
    const pairs = pairWinners(teams);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual([teams[0], teams[1]]);
  });

  it("returns empty array for empty input", () => {
    expect(pairWinners([])).toEqual([]);
  });
});

// ─── isRoundComplete ─────────────────────────────────────────────────────────

describe("isRoundComplete", () => {
  it("returns true when all regular matches have a winner", () => {
    const matches = [
      makeMatch({ id: "m1", team1: makeTeam("A"), team2: makeTeam("B"), winningTeam: 1 }),
      makeMatch({ id: "m2", team1: makeTeam("C"), team2: makeTeam("D"), winningTeam: 2 }),
    ];
    expect(isRoundComplete(matches)).toBe(true);
  });

  it("returns false when any regular match has no winner yet", () => {
    const matches = [
      makeMatch({ id: "m1", team1: makeTeam("A"), team2: makeTeam("B"), winningTeam: 1 }),
      makeMatch({ id: "m2", team1: makeTeam("C"), team2: makeTeam("D"), winningTeam: null }),
    ];
    expect(isRoundComplete(matches)).toBe(false);
  });

  it("returns false when winningTeam is 0 (sentinel for no winner)", () => {
    const match = makeMatch({ id: "m1", team1: makeTeam("A"), team2: makeTeam("B"), winningTeam: 0 });
    expect(isRoundComplete([match])).toBe(false);
  });

  it("treats bye matches (team2 null) as always complete", () => {
    const matches = [
      makeMatch({ id: "bye", team1: makeTeam("A"), team2: null, winningTeam: null }),
      makeMatch({ id: "m1", team1: makeTeam("B"), team2: makeTeam("C"), winningTeam: 1 }),
    ];
    expect(isRoundComplete(matches)).toBe(true);
  });

  it("returns true for a round consisting entirely of byes", () => {
    const matches = [
      makeMatch({ id: "bye1", team1: makeTeam("A"), team2: null, winningTeam: null }),
      makeMatch({ id: "bye2", team1: makeTeam("B"), team2: null, winningTeam: null }),
    ];
    expect(isRoundComplete(matches)).toBe(true);
  });

  it("returns false when byes are done but a regular match is still pending", () => {
    const matches = [
      makeMatch({ id: "bye", team1: makeTeam("A"), team2: null, winningTeam: null }),
      makeMatch({ id: "m1", team1: makeTeam("B"), team2: makeTeam("C"), winningTeam: null }),
    ];
    expect(isRoundComplete(matches)).toBe(false);
  });
});

// ─── getQueuePosition ────────────────────────────────────────────────────────

describe("getQueuePosition", () => {
  it("returns 1 for the only waiting non-bye match", () => {
    const t1 = makeTeam("A");
    const t2 = makeTeam("B");
    const match = makeMatch({ id: "m1", team1: t1, team2: t2, status: "waiting" });
    expect(getQueuePosition([match], match)).toBe(1);
  });

  it("returns correct positions for multiple waiting matches", () => {
    const m1 = makeMatch({ id: "a", team1: makeTeam("A"), team2: makeTeam("B"), status: "waiting" });
    const m2 = makeMatch({ id: "b", team1: makeTeam("C"), team2: makeTeam("D"), status: "waiting" });
    expect(getQueuePosition([m1, m2], m1)).toBe(1);
    expect(getQueuePosition([m1, m2], m2)).toBe(2);
  });

  it("returns 0 for a bye match (team2 is null)", () => {
    const byeMatch = makeMatch({ id: "bye", team1: makeTeam("A"), team2: null, status: "waiting" });
    expect(getQueuePosition([byeMatch], byeMatch)).toBe(0);
  });

  it("excludes bye matches from queue position numbering", () => {
    const byeMatch = makeMatch({ id: "bye", team1: makeTeam("A"), team2: null, status: "waiting" });
    const m1 = makeMatch({ id: "m1", team1: makeTeam("B"), team2: makeTeam("C"), status: "waiting" });
    const m2 = makeMatch({ id: "m2", team1: makeTeam("D"), team2: makeTeam("E"), status: "waiting" });
    // bye is not counted, so m1 is #1 and m2 is #2
    expect(getQueuePosition([byeMatch, m1, m2], m1)).toBe(1);
    expect(getQueuePosition([byeMatch, m1, m2], m2)).toBe(2);
  });

  it("excludes active and completed matches from the queue", () => {
    const active = makeMatch({ id: "a", team1: makeTeam("A"), team2: makeTeam("B"), status: "active" });
    const completed = makeMatch({ id: "c", team1: makeTeam("C"), team2: makeTeam("D"), status: "completed", winningTeam: 1 });
    const waiting = makeMatch({ id: "w", team1: makeTeam("E"), team2: makeTeam("F"), status: "waiting" });
    expect(getQueuePosition([active, completed, waiting], waiting)).toBe(1);
  });

  it("sorts by round first, then match id", () => {
    const r1 = makeMatch({ id: "m1", team1: makeTeam("A"), team2: makeTeam("B"), status: "waiting", round: 1 });
    const r2 = makeMatch({ id: "m2", team1: makeTeam("C"), team2: makeTeam("D"), status: "waiting", round: 2 });
    expect(getQueuePosition([r2, r1], r1)).toBe(1); // round 1 comes first regardless of array order
    expect(getQueuePosition([r2, r1], r2)).toBe(2);
  });
});
