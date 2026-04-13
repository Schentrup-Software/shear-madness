import { useEffect, useState } from "react";
import { getTournament, getPlayers, updateMatch, getMatches, createMatch, startMatch } from "../backend/api";
import Bracket from "../components/Bracket";
import type { Team, Match } from "../types/tournament";
import { distributeTeams, collectRoundWinners, pairWinners, isRoundComplete } from "../utils/bracketLogic";

export default function TournamentBracket() {
    const [name, setName] = useState('');
    const [id, setId] = useState('');
    const [boardCount, setBoardCount] = useState(1);
    const [players, setPlayers] = useState<any[]>([]);
    const [matches, setMatches] = useState<Match[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const path = window.location.pathname;
        const segments = path.split('/');
        setId(segments[segments.length - 2]);
    }, []);

    useEffect(() => {
        if (id) {
            loadTournamentData();
        }
    }, [id]);

    const loadTournamentData = async () => {
        try {
            setIsLoading(true);
            const tournament = await getTournament(id);
            setName(tournament.name);
            setBoardCount(tournament.boardCount ?? 1);

            const playersList = await getPlayers(id);
            setPlayers(playersList);

            // Try to load existing matches from PocketBase
            const existingMatches = await getMatches(id);

            if (existingMatches.length > 0) {
                // Convert PocketBase matches to our Match format
                const loadedMatches: Match[] = existingMatches.map((m) => ({
                    id: m.matchId,
                    team1: m.team1Player1 && m.team1Player2
                        ? { player1: m.team1Player1, player2: m.team1Player2 }
                        : null,
                    team2: m.team2Player1 && m.team2Player2
                        ? { player1: m.team2Player1, player2: m.team2Player2 }
                        : null,
                    winningTeam: m.winningTeam,
                    round: m.round,
                    status: m.status,
                }));
                setMatches(loadedMatches);
            } else {
                // No existing matches, initialize new bracket
                initializeBracket(playersList);
            }
        } catch (error) {
            console.error('Error loading tournament data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const initializeBracket = async (playersList: any[]) => {
        // Shuffle players for random team assignments
        const shuffledPlayers = [...playersList].sort(() => Math.random() - 0.5);

        // Create teams of 2 players
        const teams: Team[] = [];
        for (let i = 0; i < shuffledPlayers.length; i += 2) {
            if (shuffledPlayers[i] && shuffledPlayers[i + 1]) {
                teams.push({
                    player1: { playerName: shuffledPlayers[i].playerName, id: shuffledPlayers[i].id },
                    player2: { playerName: shuffledPlayers[i + 1].playerName, id: shuffledPlayers[i + 1].id }
                });
            }
        }

        const { byeTeams, regularPairs } = distributeTeams(teams);

        // Create first round matches
        const firstRoundMatches: Match[] = [];

        // First, create matches with byes (teams that advance automatically)
        for (const team of byeTeams) {
            const match = await createMatch({
                tournamentId: id,
                round: 1,
                team1Player1: team.player1.id,
                team1Player2: team.player2.id,
                team2Player1: null,
                team2Player2: null,
            });

            firstRoundMatches.push({
                id: match.matchId,
                team1: team,
                team2: null,
                winningTeam: match.winningTeam,
                round: match.round,
                status: match.status,
            });
        }

        // Then create regular matches with the remaining teams
        for (const [teamA, teamB] of regularPairs) {
            const match = await createMatch({
                tournamentId: id,
                round: 1,
                team1Player1: teamA.player1.id,
                team1Player2: teamA.player2.id,
                team2Player1: teamB.player1.id,
                team2Player2: teamB.player2.id,
            });

            firstRoundMatches.push({
                id: match.matchId,
                team1: teamA,
                team2: teamB,
                winningTeam: match.winningTeam,
                round: match.round,
                status: match.status,
            });
        }

        setMatches(firstRoundMatches);
    };

    const selectWinner = async (matchId: string, teamNumber: 1 | 2) => {
        // Update the match with the winner
        // Update local state with both winningTeam AND status=completed so that
        // activeCount recomputes immediately and a previously-disabled Start button
        // can re-enable in the same render. Without this, the board-freed UX requires
        // a manual page refresh.
        const updatedMatches = matches.map(match =>
            match.id === matchId ? { ...match, winningTeam: teamNumber, status: 'completed' as const } : match
        );

        // Save the updated match to PocketBase
        const updatedMatch = updatedMatches.find(m => m.id === matchId);
        if (updatedMatch) {
            await updateMatch({
                matchId: updatedMatch.id,
                round: updatedMatch.round,
                team1Player1: updatedMatch.team1 ? updatedMatch.team1.player1.id : null,
                team1Player2: updatedMatch.team1 ? updatedMatch.team1.player2.id : null,
                team2Player1: updatedMatch.team2 ? updatedMatch.team2.player1.id : null,
                team2Player2: updatedMatch.team2 ? updatedMatch.team2.player2.id : null,
                winningTeam: updatedMatch.winningTeam
            });
        }

        // Find the current match to get the round
        const currentMatch = updatedMatches.find(m => m.id === matchId);
        if (!currentMatch) {
            setMatches(updatedMatches);
            return;
        }

        const currentRound = currentMatch.round;

        // Check if all matches in current round are complete
        const currentRoundMatches = updatedMatches.filter(m => m.round === currentRound);

        // Only create next round if all matches are complete AND there's more than 1 match
        if (isRoundComplete(currentRoundMatches) && currentRoundMatches.length > 1) {
            const winningTeams = collectRoundWinners(currentRoundMatches).filter((t): t is Team => t !== null);
            const pairs = pairWinners(winningTeams);

            // Create next round matches - pairs of 2 teams only (no more byes after round 1)
            const nextRoundMatches: Match[] = [];
            for (const [teamA, teamB] of pairs) {
                const match = await createMatch({
                    tournamentId: id,
                    round: currentRound + 1,
                    team1Player1: teamA.player1.id,
                    team1Player2: teamA.player2.id,
                    team2Player1: teamB.player1.id,
                    team2Player2: teamB.player2.id,
                });

                nextRoundMatches.push({
                    id: match.matchId,
                    team1: teamA,
                    team2: teamB,
                    winningTeam: match.winningTeam,
                    round: match.round,
                    status: match.status,
                });
            }

            // Add new matches to state
            setMatches([...updatedMatches, ...nextRoundMatches]);
        } else {
            setMatches(updatedMatches);
        }
    };

    const handleStartMatch = async (matchId: string) => {
        const updated = await startMatch(matchId);
        setMatches(prev => prev.map(m => m.id === matchId ? { ...m, status: updated.status } : m));
    };

    const activeCount = matches.filter(m => m.status === 'active').length;

    return (
        <div className="container mx-auto px-4 py-8 max-w-screen-2xl">
            <h1 className="text-3xl font-bold mb-8 text-gray-900 dark:text-white text-center">
                {name} - Tournament Bracket
            </h1>

            <Bracket
                matches={matches}
                isLoading={isLoading}
                isReadOnly={false}
                onSelectWinner={selectWinner}
                onStartMatch={handleStartMatch}
                canStartMatch={activeCount < boardCount}
                stickyHeaderBg="bg-gray-50 dark:bg-gray-900"
            />

            {players.length === 0 && !isLoading && (
                <div className="bg-white dark:bg-gray-700 rounded-lg shadow-lg p-6 text-center">
                    <p className="text-gray-500 dark:text-gray-400">
                        No players registered yet. At least 4 players are needed to create teams and start the bracket.
                    </p>
                </div>
            )}

            {players.length > 0 && players.length < 4 && (
                <div className="bg-yellow-100 dark:bg-yellow-900 rounded-lg shadow-lg p-6 text-center">
                    <p className="text-yellow-800 dark:text-yellow-200">
                        Need at least 4 players to create teams. Currently have {players.length} player(s).
                    </p>
                </div>
            )}
        </div>
    );
}
