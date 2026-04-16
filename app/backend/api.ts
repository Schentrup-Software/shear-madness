import pb, { POCKETBASE_URL } from './pocketbaseClient';

const TEMP_EMAIL_KEY = `shear_madness_temp_email_${POCKETBASE_URL}`;
const TEMP_PASSWORD_KEY = `shear_madness_temp_password_${POCKETBASE_URL}`;

// Serializes concurrent auth calls on the same page to avoid auto-cancellation
let ongoingAuth: Promise<any> | null = null;

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

// Function to create a temporary user account
async function ensureUserAuthenticated(): Promise<any> {
  // Check if user is already authenticated
  if (pb.authStore.isValid) {
    return pb.authStore.record;
  }

  // If auth is already in progress on this page, wait for it rather than
  // starting a duplicate request (which the PocketBase SDK would auto-cancel).
  if (ongoingAuth) {
    return ongoingAuth;
  }

  ongoingAuth = (async () => {
    try {
      // Check if we have stored credentials in localStorage
      const storedEmail = localStorage.getItem(TEMP_EMAIL_KEY);
      const storedPassword = localStorage.getItem(TEMP_PASSWORD_KEY);

      if (storedEmail && storedPassword) {
        // Retry stored-credential auth up to 3 times on transient errors.
        // Only clear credentials for 400/401 (actually invalid); treat
        // other codes (0 = network/server error, 429 = rate limit) as transient.
        let credentialsInvalid = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            // requestKey: null disables SDK-level auto-cancellation for this call
            await pb.collection('users').authWithPassword(storedEmail, storedPassword, { requestKey: null });
            return pb.authStore.record;
          } catch (authError: any) {
            if (authError.status === 400 || authError.status === 401) {
              credentialsInvalid = true;
              break;
            }
            if (attempt < 2) {
              await sleep(1000 * (attempt + 1));
            } else {
              throw authError;
            }
          }
        }
        if (credentialsInvalid) {
          console.log('Stored credentials invalid, creating new account');
          localStorage.removeItem(TEMP_EMAIL_KEY);
          localStorage.removeItem(TEMP_PASSWORD_KEY);
        }
      }

      // Generate a random temporary user
      const randomId = Math.random().toString(36).substring(2, 15);
      const tempEmail = `temp_${randomId}@temp.local`;
      const tempPassword = Math.random().toString(36).substring(2, 15);
      const tempUsername = `temp_user_${randomId}`;

      // Create the user account
      const user = await pb.collection('users').create({
        email: tempEmail,
        password: tempPassword,
        passwordConfirm: tempPassword,
        username: tempUsername,
        name: `Temp User ${randomId}`,
      });

      // Store credentials before auth so a retry can reuse them
      localStorage.setItem(TEMP_EMAIL_KEY, tempEmail);
      localStorage.setItem(TEMP_PASSWORD_KEY, tempPassword);

      // Authenticate — retry up to 3 times on 429 with exponential backoff
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await pb.collection('users').authWithPassword(tempEmail, tempPassword, { requestKey: null });
          return user;
        } catch (error: any) {
          if (error.status === 429 && attempt < 2) {
            await sleep(1500 * (attempt + 1));
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      console.error('Error creating temporary user:', error);
      throw error;
    }
  })();

  try {
    return await ongoingAuth;
  } finally {
    ongoingAuth = null;
  }
}

// Function to add a tournament
export async function addTournament(name: string, boardCount: number) {
  try {
    // Ensure user is authenticated (create temp account if needed)
    const user = await ensureUserAuthenticated();

    if (!user) {
      throw new Error('User authentication failed');
    }

    const tournament = await pb.collection('tournaments').create({
      name,
      ownerId: user.id,
      status: 'signup',
      boardCount,
    });
    return tournament;
  } catch (error) {
    console.error('Error adding tournament:', error);
    throw error;
  }
}

export async function startTournament(tournamentId: string) {
  try {
    const tournament = await pb.collection('tournaments').update(tournamentId, {
      status: 'playing',
    });
    return tournament;
  } catch (error) {
    console.error('Error starting tournament:', error);
    throw error;
  }
}

// Function to add a player to a tournament
export async function addPlayer(tournamentId: string, playerName: string) {
  try {
    // Ensure user is authenticated (create temp account if needed)
    const user = await ensureUserAuthenticated();

    // Retry on transient errors (status 0 / 429). Real failures (4xx other than 429)
    // throw immediately so genuine validation errors aren't silently retried.
    let lastErr: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const player = await pb.collection('players').create({
          tournamentId,
          playerName,
          userId: user?.id,
        });
        return player;
      } catch (err: any) {
        lastErr = err;
        const transient = err?.status === 0 || err?.status === 429 || err?.status >= 500;
        if (!transient || attempt === 2) throw err;
        await sleep(1000 * (attempt + 1));
      }
    }
    throw lastErr;
  } catch (error) {
    console.error('Error adding player:', error);
    throw error;
  }
}

// Function to get the list of players in real time
export async function getPlayersRealTime(tournamentId: string, callback: (players: any[]) => void) {
  try {
    // Ensure user is authenticated (create temp account if needed)
    await ensureUserAuthenticated();

    return pb.collection('players').subscribe(`*`, (e) => {
      console.log('Real-time event received for players:', e);
      if (e.action === 'create' || e.action === 'update' || e.action === 'delete') {
        getPlayers(tournamentId)
          .then(callback)
          .catch((error) => console.error('Error fetching players:', error));
      }
    });
  } catch (error) {
    console.error('Error subscribing to players:', error);
    throw error;
  }
}

export async function getPlayers(tournamentId: string) {
  try {
    await ensureUserAuthenticated();

    const players = await pb.collection('players').getFullList({
      sort: '-created',
      filter: `tournamentId = "${tournamentId}"`,
    });
    return players;
  } catch (error) {
    console.error('Error fetching players:', error);
    throw error;
  }
}

export async function getTournament(tournamentId: string) {
  try {
    await ensureUserAuthenticated();

    // requestKey: null prevents SDK auto-cancellation when called concurrently
    // (e.g. from initial load + real-time subscription callback simultaneously)
    const tournament = await pb.collection('tournaments').getOne(tournamentId, { requestKey: null });
    return tournament;
  } catch (error) {
    console.error('Error fetching tournament:', error);
    throw error;
  }
}

export async function getPlayer(playerId: string) {
  try {
    await ensureUserAuthenticated();

    const player = await pb.collection('players').getOne(playerId, {
      expand: 'tournamentId',
      requestKey: null,
    });
    return player;
  } catch (error) {
    console.error('Error fetching player:', error);
    throw error;
  }
}

export async function removePlayer(playerId: string) {
  try {
    await ensureUserAuthenticated();
    await pb.collection('players').delete(playerId);
  } catch (error) {
    console.error('Error removing player:', error);
    throw error;
  }
}

export async function getTournamentsByOwner() {
  try {
    const user = await ensureUserAuthenticated();

    if (!user) {
      throw new Error('User authentication failed');
    }

    const tournaments = await pb.collection('tournaments').getFullList({
      filter: `ownerId = "${user.id}"`
    });
    return tournaments;
  } catch (error) {
    console.error('Error fetching tournaments by owner:', error);
    throw error;
  }
}

export async function createMatch(matchData: {
  tournamentId: string;
  round: number;
  team1Player1: string | null;
  team1Player2: string | null;
  team2Player1: string | null;
  team2Player2: string | null;
}) {
  try {
    await ensureUserAuthenticated();

    // Create new match
    const match = await pb.collection('matches').create({
      tournamentId: matchData.tournamentId,
      round: matchData.round,
      team1: [matchData.team1Player1, matchData.team1Player2],
      team2: [matchData.team2Player1, matchData.team2Player2],
      winningTeam: null,
      status: 'waiting',
    });

    return mapMatchData(match);
  } catch (error) {
    console.error('Error saving match:', error);
    throw error;
  }
}

export async function updateMatch(matchData: {
  matchId: string;
  round: number;
  team1Player1: string | null;
  team1Player2: string | null;
  team2Player1: string | null;
  team2Player2: string | null;
  winningTeam: number | null;
}) {
  try {
    await ensureUserAuthenticated();

    const match = await pb.collection('matches').update(matchData.matchId, {
      round: matchData.round,
      team1: [matchData.team1Player1, matchData.team1Player2],
      team2: [matchData.team2Player1, matchData.team2Player2],
      winningTeam: matchData.winningTeam,
      status: 'completed',
    });

    return mapMatchData(match);
  } catch (error) {
    console.error('Error saving match:', error);
    throw error;
  }
}

export async function getMatches(tournamentId: string) {
  try {
    await ensureUserAuthenticated();

    const [matchesRaw, playersRaw] = await Promise.all([
      pb.collection('matches').getFullList({
        filter: `tournamentId = "${tournamentId}"`,
        sort: 'round',
        requestKey: null,
      }),
      pb.collection('players').getFullList({
        filter: `tournamentId = "${tournamentId}"`,
        requestKey: null,
      }),
    ]);

    const playerMap = new Map<string, any>(playersRaw.map((p: any) => [p.id, p]));
    return matchesRaw.map(match => mapMatchData(match, playerMap));
  } catch (error) {
    console.error('Error fetching matches:', error);
    throw error;
  }
}

function mapMatchData(match: any, playerMap?: Map<string, any>) {
  const team1Ids: (string | null)[] = match.team1 || [];
  const team2Ids: (string | null)[] = match.team2 || [];

  function makePlayer(id: string | null) {
    if (!id) return null;
    const record = playerMap?.get(id);
    return { id, playerName: record?.playerName ?? '' };
  }

  return {
    tournamentId: match.tournamentId,
    matchId: match.id,
    round: match.round,
    team1Player1: makePlayer(team1Ids[0] ?? null),
    team1Player2: makePlayer(team1Ids[1] ?? null),
    team2Player1: makePlayer(team2Ids[0] ?? null),
    team2Player2: makePlayer(team2Ids[1] ?? null),
    winningTeam: match.winningTeam,
    status: match.status as 'waiting' | 'active' | 'completed',
  };
}

export async function startMatch(matchId: string) {
  try {
    await ensureUserAuthenticated();
    const match = await pb.collection('matches').update(matchId, { status: 'active' });
    return mapMatchData(match);
  } catch (error) {
    console.error('Error starting match:', error);
    throw error;
  }
}

export async function stopMatch(matchId: string) {
  try {
    await ensureUserAuthenticated();
    const match = await pb.collection('matches').update(matchId, { status: 'waiting' });
    return mapMatchData(match);
  } catch (error) {
    console.error('Error stopping match:', error);
    throw error;
  }
}

export async function deleteAllMatches(tournamentId: string) {
  try {
    await ensureUserAuthenticated();

    const matches = await getMatches(tournamentId);
    await Promise.all(matches.map(match => pb.collection('matches').delete(match.matchId)));
  } catch (error) {
    console.error('Error deleting matches:', error);
    throw error;
  }
}

// Real-time subscription for tournament updates
export async function getTournamentRealTime(tournamentId: string, callback: (tournament: any) => void) {
  try {
    await ensureUserAuthenticated();

    return pb.collection('tournaments').subscribe(tournamentId, (e) => {
      console.log('Real-time event received for tournament:', e);
      if (e.action === 'update') {
        callback(e.record);
      }
    });
  } catch (error) {
    console.error('Error subscribing to tournament:', error);
    throw error;
  }
}

// Real-time subscription for matches updates
export async function getMatchesRealTime(tournamentId: string, callback: (matches: any[]) => void) {
  try {
    await ensureUserAuthenticated();

    return pb.collection('matches').subscribe(`*`, (e) => {
      console.log('Real-time event received for matches:', e);
      if (e.action === 'create' || e.action === 'update' || e.action === 'delete') {
        getMatches(tournamentId)
          .then(callback)
          .catch((error) => console.error('Error fetching matches:', error));
      }
    });
  } catch (error) {
    console.error('Error subscribing to matches:', error);
    throw error;
  }
}