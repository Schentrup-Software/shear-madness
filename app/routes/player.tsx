import { useEffect, useRef, useState } from "react";
import { getPlayer, getTournament, getMatches, getTournamentRealTime, getMatchesRealTime } from "../backend/api";
import Bracket from "../components/Bracket";
import type { Match } from "../types/tournament";
import { getQueuePosition } from "../utils/bracketLogic";

function mapMatches(matchesData: any[]): Match[] {
  return matchesData.map((m) => ({
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
}

function findPlayerMatch(matches: Match[], playerId: string): Match | undefined {
  // Prefer the player's latest-round non-completed match. Bye matches stay in 'waiting'
  // status forever — without this, a player who won a bye in an earlier round would
  // keep seeing the "You have a bye" banner even after advancing.
  const isPlayerIn = (m: Match) =>
    m.team1?.player1.id === playerId ||
    m.team1?.player2.id === playerId ||
    m.team2?.player1.id === playerId ||
    m.team2?.player2.id === playerId;
  return matches
    .filter(m => m.status !== 'completed' && isPlayerIn(m))
    .sort((a, b) => b.round - a.round)[0];
}


export default function Player() {
  const [playerId, setPlayerId] = useState('');
  const [tournamentId, setTournamentId] = useState('');
  const [tournamentName, setTournamentName] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [tournamentStatus, setTournamentStatus] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const prevMatchesRef = useRef<Match[]>([]);
  const playerIdRef = useRef('');
  const playerNameRef = useRef('');

  useEffect(() => {
    const path = window.location.pathname;
    const segments = path.split('/');
    const id = segments[segments.length - 2];
    setPlayerId(id);
    playerIdRef.current = id;

    // Request notification permission early
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    try {
      getPlayer(id).then(player => {
        setTournamentName(player.expand?.tournamentId.name);
        setPlayerName(player.playerName);
        playerNameRef.current = player.playerName;
        setTournamentId(player.tournamentId);
        loadTournamentData(player.tournamentId);
      });
    } catch (error) {
      console.error("Failed to fetch tournament:", error);
    }
  }, []);

  const loadTournamentData = async (tournamentId: string) => {
    try {
      setIsLoading(true);
      const tournament = await getTournament(tournamentId);
      setTournamentStatus(tournament.status);

      if (tournament.status === 'playing') {
        const existingMatches = await getMatches(tournamentId);
        if (existingMatches.length > 0) {
          const loaded = mapMatches(existingMatches);
          prevMatchesRef.current = loaded;
          setMatches(loaded);
        }
      }
    } catch (error) {
      console.error('Error loading tournament data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Set up real-time subscriptions for tournament and matches
  useEffect(() => {
    if (!tournamentId) return;

    let tournamentUnsubscribe: (() => void) | undefined;
    let matchesUnsubscribe: (() => void) | undefined;

    getTournamentRealTime(tournamentId, (tournament) => {
      setTournamentStatus(tournament.status);
      if (tournament.status === 'playing' && matches.length === 0) {
        loadTournamentData(tournamentId);
      }
    }).then((unsubscribe) => {
      tournamentUnsubscribe = unsubscribe;
    });

    if (tournamentStatus === 'playing') {
      getMatchesRealTime(tournamentId, (matchesData) => {
        const newMatches = mapMatches(matchesData);
        const prev = prevMatchesRef.current;

        // Check if the player's match just became active
        const playerMatch = findPlayerMatch(newMatches, playerIdRef.current);
        if (playerMatch?.status === 'active') {
          const wasWaiting = prev.find(m => m.id === playerMatch.id)?.status === 'waiting';
          if (wasWaiting && 'Notification' in window && Notification.permission === 'granted') {
            new Notification("Your game is starting!", {
              body: `${playerNameRef.current}, head to the board now!`,
              icon: '/favicon.ico',
            });
          }
        }

        prevMatchesRef.current = newMatches;
        setMatches(newMatches);
      }).then((unsubscribe) => {
        matchesUnsubscribe = unsubscribe;
      });
    }

    return () => {
      tournamentUnsubscribe?.();
      matchesUnsubscribe?.();
    };
  }, [tournamentId, tournamentStatus]);

  const playerMatch = playerId ? findPlayerMatch(matches, playerId) : undefined;
  const queuePosition = playerMatch?.status === 'waiting' && playerMatch.team2
    ? getQueuePosition(matches, playerMatch)
    : 0;

  return (
    <div className="container mx-auto px-4 py-8 max-w-screen-2xl">
      <h1 className="text-3xl font-bold mb-8 text-gray-900 dark:text-white text-center">
        {tournamentName}
      </h1>

      <div className="bg-white dark:bg-gray-700 rounded-lg shadow-lg p-6 mb-8">
        <p className="text-gray-700 dark:text-gray-200 text-center">
          Welcome, <span className="font-bold">{playerName}</span>!
          {tournamentStatus === 'signup' && ' You are registered for the tournament. Good luck!'}
          {tournamentStatus === 'playing' && ' The tournament is in progress!'}
        </p>
      </div>

      {tournamentStatus === 'playing' && playerMatch && (
        <div className={`rounded-lg shadow-lg p-6 mb-8 text-center ${
          playerMatch.status === 'active'
            ? 'bg-green-100 dark:bg-green-900 border-2 border-green-400'
            : 'bg-blue-50 dark:bg-gray-700'
        }`}>
          {playerMatch.status === 'active' && (
            <>
              <p className="text-2xl font-bold text-green-800 dark:text-green-200">Your match is active!</p>
              <p className="text-green-700 dark:text-green-300 mt-1">Head to the board now.</p>
            </>
          )}
          {playerMatch.status === 'waiting' && playerMatch.team2 && queuePosition > 0 && (
            <>
              <p className="text-xl font-bold text-gray-800 dark:text-gray-100">
                You are <span className="text-blue-600 dark:text-blue-400">#{queuePosition}</span> in the queue
              </p>
              <p className="text-gray-600 dark:text-gray-300 mt-1 text-sm">
                {queuePosition === 1 ? "You're up next!" : `${queuePosition - 1} match${queuePosition - 1 > 1 ? 'es' : ''} ahead of you`}
              </p>
            </>
          )}
          {playerMatch.status === 'waiting' && !playerMatch.team2 && (
            <p className="text-gray-700 dark:text-gray-200">You have a bye — you advance automatically.</p>
          )}
        </div>
      )}

      {tournamentStatus === 'playing' && matches.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          <h2 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white text-center">
            Tournament Bracket
          </h2>

          <Bracket
            matches={matches}
            isLoading={isLoading}
            isReadOnly={true}
            stickyHeaderBg="bg-white dark:bg-gray-800"
          />
        </div>
      )}
    </div>
  );
}
