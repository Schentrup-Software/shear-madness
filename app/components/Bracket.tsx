import type { Team, Match } from "../types/tournament";

interface BracketProps {
    matches: Match[];
    isLoading: boolean;
    isReadOnly?: boolean;
    onSelectWinner?: (matchId: string, teamNumber: 1 | 2) => void;
    onStartMatch?: (matchId: string) => void;
    canStartMatch?: boolean;
    stickyHeaderBg?: string;
}

export default function Bracket({
    matches,
    isLoading,
    isReadOnly = false,
    onSelectWinner,
    onStartMatch,
    canStartMatch = false,
    stickyHeaderBg = 'bg-gray-50 dark:bg-gray-900'
}: BracketProps) {
    const getRoundMatches = (round: number) => {
        return matches.filter(m => m.round === round);
    };

    const maxRounds = Math.max(...matches.map(m => m.round), 1);

    const finalRoundMatches = matches.filter(m => m.round === maxRounds);
    const isTrueFinals = finalRoundMatches.length === 1;
    const championMatch = isTrueFinals
        ? matches.find(m => m.round === maxRounds && m.winningTeam !== null)
        : null;
    const championTeam = championMatch?.winningTeam
        ? (championMatch.winningTeam === 1 ? championMatch.team1 : championMatch.team2)
        : null;

    const handleTeamClick = (matchId: string, teamNumber: 1 | 2, match: Match) => {
        // Only allow clicking if not read-only, match is active, no winner selected, and callback provided
        if (!isReadOnly && match.status === 'active' && !match.winningTeam && onSelectWinner) {
            onSelectWinner(matchId, teamNumber);
        }
    };

    if (isLoading) {
        return (
            <div className="flex justify-center items-center py-20">
                <div className="text-xl text-gray-600 dark:text-gray-400">Loading bracket...</div>
            </div>
        );
    }

    return (
        <>
            {championTeam && (
                <div className="mb-8 bg-yellow-100 dark:bg-yellow-900 rounded-lg shadow-lg p-6 text-center">
                    <h2 className="text-2xl font-bold text-yellow-800 dark:text-yellow-200 mb-2">
                        🏆 Champions 🏆
                    </h2>
                    <p className="text-3xl font-bold text-yellow-900 dark:text-yellow-100">
                        {championTeam.player1.playerName} & {championTeam.player2.playerName}
                    </p>
                </div>
            )}

            {/* Single Elimination Bracket Layout */}
            <div className="flex justify-center gap-8 overflow-x-auto pb-8">
                {Array.from({ length: maxRounds }, (_, i) => i + 1).map(round => {
                    const roundMatches = getRoundMatches(round);
                    return (
                        <div key={round} className="flex flex-col justify-around min-w-[300px]">
                            <h2 className={`text-xl font-bold mb-4 text-gray-900 dark:text-white text-center sticky top-0 ${stickyHeaderBg} py-2 z-10`}>
                                {round === maxRounds && roundMatches.length === 1
                                    ? 'Finals'
                                    : round === maxRounds - 1 && roundMatches.length === 2
                                        ? 'Semi-Finals'
                                        : `Round ${round}`}
                            </h2>
                            <div className="flex flex-col justify-around gap-4 flex-1">
                                {roundMatches.map((match, idx) => (
                                    <div
                                        key={match.id}
                                        className="bg-white dark:bg-gray-700 rounded-lg shadow-lg p-4 border-2 border-gray-300 dark:border-gray-600"
                                        style={{
                                            marginTop: round > 1 ? `${idx * (100 / roundMatches.length)}%` : '0'
                                        }}
                                    >
                                        <div className="flex items-center justify-between mb-3">
                                            <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                                                Match {idx + 1}
                                            </span>
                                            {match.status === 'active' && (
                                                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100">
                                                    Active
                                                </span>
                                            )}
                                            {match.status === 'waiting' && match.team2 && !isReadOnly && onStartMatch && (
                                                <button
                                                    onClick={() => onStartMatch(match.id)}
                                                    disabled={!canStartMatch}
                                                    className="px-2 py-0.5 rounded text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                                >
                                                    Start
                                                </button>
                                            )}
                                        </div>

                                        {/* Team 1 */}
                                        {match.team1 && (
                                            <div
                                                onClick={() => handleTeamClick(match.id, 1, match)}
                                                className={`p-3 mb-3 rounded-lg transition-all ${match.winningTeam === 1
                                                        ? 'bg-green-500 text-white font-bold shadow-lg scale-105'
                                                        : match.team2 && !isReadOnly && match.status === 'active'
                                                            ? 'cursor-pointer bg-blue-100 dark:bg-blue-900 hover:bg-blue-200 dark:hover:bg-blue-800 border-2 border-blue-300 dark:border-blue-700'
                                                            : match.team2
                                                                ? 'bg-blue-100 dark:bg-blue-900 border-2 border-blue-300 dark:border-blue-700'
                                                                : 'bg-gray-100 dark:bg-gray-600 opacity-75'
                                                    }`}
                                            >
                                                <div className="font-semibold text-sm">Team 1</div>
                                                <div className="text-sm">{match.team1.player1.playerName}</div>
                                                <div className="text-sm">{match.team1.player2.playerName}</div>
                                            </div>
                                        )}

                                        <div className="text-center text-xs font-bold text-gray-400 dark:text-gray-500 mb-3">
                                            VS
                                        </div>

                                        {/* Team 2 */}
                                        {match.team2 ? (
                                            <div
                                                onClick={() => handleTeamClick(match.id, 2, match)}
                                                className={`p-3 rounded-lg transition-all ${match.winningTeam === 2
                                                        ? 'bg-green-500 text-white font-bold shadow-lg scale-105'
                                                        : !isReadOnly && match.status === 'active'
                                                            ? 'cursor-pointer bg-red-100 dark:bg-red-900 hover:bg-red-200 dark:hover:bg-red-800 border-2 border-red-300 dark:border-red-700'
                                                            : 'bg-red-100 dark:bg-red-900 border-2 border-red-300 dark:border-red-700'
                                                    }`}
                                            >
                                                <div className="font-semibold text-sm">Team 2</div>
                                                <div className="text-sm">{match.team2.player1.playerName}</div>
                                                <div className="text-sm">{match.team2.player2.playerName}</div>
                                            </div>
                                        ) : (
                                            <div className="p-3 rounded-lg bg-gray-100 dark:bg-gray-600 text-center">
                                                <div className="text-sm text-gray-500 dark:text-gray-400">
                                                    Bye - Team 1 advances
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );
}
