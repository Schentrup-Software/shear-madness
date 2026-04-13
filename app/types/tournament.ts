export interface Team {
  player1: {
    playerName: string;
    id: string;
  };
  player2: {
    playerName: string;
    id: string;
  };
}

export interface Match {
  id: string;
  team1: Team | null;
  team2: Team | null;
  winningTeam: 1 | 2 | null | 0;
  round: number;
  status: 'waiting' | 'active' | 'completed';
}
