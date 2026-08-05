/// <reference path="../../.local-pocketbase/pb_data/types.d.ts" />

/**
 * Google Chat integration for Shear Madness.
 *
 * Everything here runs server-side inside PocketBase's JS VM. It lives in a
 * plain module (not a *.pb.js file) because PocketBase executes every hook
 * handler in an isolated runtime with no access to the outer scope — handlers
 * must `require()` this file to reach these helpers.
 *
 * Flow:
 *   1. The tournament organizer connects their Google account via OAuth
 *      (routes in ../googlechat.pb.js). We keep a refresh token.
 *   2. Players optionally supply a Google Chat email when they sign up.
 *   3. Record hooks DM each opted-in player *as the organizer* using the Chat
 *      API at every beat of the tournament: the anthem when it starts, an
 *      on-deck warning, the call to the board, the result of their match, and
 *      the champions announcement at the end. See KIND below.
 */

// Scopes: create the 1:1 DM space, post the message, and read the connected
// account's email so we can show who is connected in the dashboard.
const SCOPES = [
  'https://www.googleapis.com/auth/chat.spaces.create',
  'https://www.googleapis.com/auth/chat.messages.create',
  'https://www.googleapis.com/auth/userinfo.email',
];

const HTTP_TIMEOUT = 10; // seconds
const STATE_TTL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

function config() {
  const clientId = $os.getenv('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = $os.getenv('GOOGLE_OAUTH_CLIENT_SECRET');
  const appBaseUrl = trimSlash($os.getenv('APP_BASE_URL') || $app.settings().meta.appURL || '');
  const redirectUrl =
    $os.getenv('GOOGLE_OAUTH_REDIRECT_URL') || appBaseUrl + '/api/google-chat/callback';

  return {
    clientId: clientId,
    clientSecret: clientSecret,
    redirectUrl: redirectUrl,
    appBaseUrl: appBaseUrl,
    configured: !!(clientId && clientSecret),
  };
}

function trimSlash(s) {
  return s.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function formEncode(params) {
  const parts = [];
  for (const key in params) {
    if (params[key] === undefined || params[key] === null) continue;
    parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key])));
  }
  return parts.join('&');
}

/** findFirstRecordByFilter throws when nothing matches; we want null. */
function findOne(collection, filter, params) {
  try {
    return $app.findFirstRecordByFilter(collection, filter, params || {});
  } catch (err) {
    return null;
  }
}

/** Relation fields come back as Go slices; normalise to a plain JS array. */
function toArray(value) {
  if (!value) return [];
  const out = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i]) out.push(String(value[i]));
  }
  return out;
}

function newRecord(collectionName) {
  return new Record($app.findCollectionByNameOrId(collectionName));
}

/** Best-effort description of a failed Google API response. */
function apiError(res) {
  let detail = '';
  try {
    if (res.json && res.json.error && res.json.error.message) {
      detail = res.json.error.message;
    } else {
      detail = String(res.raw || '').slice(0, 300);
    }
  } catch (err) {
    detail = String(res.raw || '').slice(0, 300);
  }
  return 'HTTP ' + res.statusCode + (detail ? ': ' + detail : '');
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

function buildAuthUrl(state) {
  const cfg = config();
  const params = {
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUrl,
    response_type: 'code',
    scope: SCOPES.join(' '),
    // offline + consent is what actually yields a refresh token; without
    // prompt=consent Google omits it on repeat authorisations.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: state,
  };
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + formEncode(params);
}

function createOauthState(userId, returnTo) {
  purgeExpiredStates();

  const state = $security.randomString(40);
  const rec = newRecord('googleChatOauthStates');
  rec.set('state', state);
  rec.set('userId', userId);
  rec.set('returnTo', returnTo || '/');
  $app.save(rec);

  return state;
}

function purgeExpiredStates() {
  try {
    const cutoff = new Date(Date.now() - STATE_TTL_MS).toISOString().replace('T', ' ').slice(0, 19);
    const stale = $app.findRecordsByFilter(
      'googleChatOauthStates',
      'created < {:cutoff}',
      '',
      100,
      0,
      { cutoff: cutoff }
    );
    for (let i = 0; i < stale.length; i++) {
      $app.delete(stale[i]);
    }
  } catch (err) {
    // cleanup is opportunistic — never let it break the connect flow
  }
}

function consumeOauthState(state) {
  if (!state) return null;

  const rec = findOne('googleChatOauthStates', 'state = {:state}', { state: state });
  if (!rec) return null;

  const data = { userId: rec.get('userId'), returnTo: rec.get('returnTo') };
  try {
    $app.delete(rec); // single use
  } catch (err) {
    // ignore
  }

  // Reject a state that outlived its window even if cleanup hadn't run yet.
  const created = new Date(String(rec.get('created'))).getTime();
  if (created && Date.now() - created > STATE_TTL_MS) return null;

  return data;
}

function exchangeCodeForTokens(code) {
  const cfg = config();
  const res = $http.send({
    method: 'POST',
    url: 'https://oauth2.googleapis.com/token',
    body: formEncode({
      code: code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUrl,
      grant_type: 'authorization_code',
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: HTTP_TIMEOUT,
  });

  if (res.statusCode !== 200) {
    throw new Error('Google token exchange failed — ' + apiError(res));
  }
  return res.json;
}

function fetchGoogleEmail(accessToken) {
  try {
    const res = $http.send({
      method: 'GET',
      url: 'https://www.googleapis.com/oauth2/v3/userinfo',
      headers: { Authorization: 'Bearer ' + accessToken },
      timeout: HTTP_TIMEOUT,
    });
    if (res.statusCode === 200 && res.json && res.json.email) {
      return String(res.json.email);
    }
  } catch (err) {
    // non-fatal: the email is only used for display
  }
  return '';
}

/** Store (or replace) the organizer's credentials. */
function saveCredentials(userId, tokens) {
  let rec = findOne('googleChatCredentials', 'userId = {:uid}', { uid: userId });
  if (!rec) {
    rec = newRecord('googleChatCredentials');
    rec.set('userId', userId);
  }

  // Google only returns refresh_token on the first consent for a given
  // client/user pair — keep the existing one if this response omits it.
  if (tokens.refresh_token) {
    rec.set('refreshToken', tokens.refresh_token);
  }
  rec.set('accessToken', tokens.access_token || '');
  rec.set('accessTokenExpiry', Date.now() + (tokens.expires_in ? tokens.expires_in * 1000 : 0));

  const email = fetchGoogleEmail(tokens.access_token);
  if (email) rec.set('googleEmail', email);

  $app.save(rec);
  return rec;
}

/**
 * Return a usable access token, refreshing (and persisting) when the cached
 * one is within 60s of expiry. Caching matters: it keeps the notify hook down
 * to one Chat API call per player.
 */
function getAccessToken(credRecord) {
  const cached = credRecord.get('accessToken');
  const expiry = Number(credRecord.get('accessTokenExpiry') || 0);

  if (cached && expiry > Date.now() + 60000) {
    return String(cached);
  }

  const refreshToken = credRecord.get('refreshToken');
  if (!refreshToken) {
    throw new Error('No refresh token stored — the organizer must reconnect Google Chat.');
  }

  const cfg = config();
  const res = $http.send({
    method: 'POST',
    url: 'https://oauth2.googleapis.com/token',
    body: formEncode({
      refresh_token: String(refreshToken),
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'refresh_token',
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: HTTP_TIMEOUT,
  });

  if (res.statusCode !== 200) {
    throw new Error('Could not refresh Google token — ' + apiError(res));
  }

  const token = String(res.json.access_token);
  credRecord.set('accessToken', token);
  credRecord.set(
    'accessTokenExpiry',
    Date.now() + (res.json.expires_in ? res.json.expires_in * 1000 : 0)
  );
  $app.save(credRecord);

  return token;
}

// ---------------------------------------------------------------------------
// Chat API
// ---------------------------------------------------------------------------

/**
 * Resolve the 1:1 DM space between the connected organizer and `email`,
 * creating it if needed. Cached, because spaces:setup is the slow call and the
 * result never changes for a given pair.
 */
function resolveDmSpace(accessToken, credRecord, email) {
  const cached = findOne(
    'googleChatDmSpaces',
    'credentialId = {:cid} && playerEmail = {:email}',
    { cid: credRecord.id, email: email }
  );
  if (cached) return String(cached.get('spaceName'));

  const res = $http.send({
    method: 'POST',
    url: 'https://chat.googleapis.com/v1/spaces:setup',
    body: JSON.stringify({
      space: { spaceType: 'DIRECT_MESSAGE', singleUserBotDm: false },
      memberships: [{ member: { name: 'users/' + email, type: 'HUMAN' } }],
    }),
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
    },
    timeout: HTTP_TIMEOUT,
  });

  if (res.statusCode !== 200 || !res.json || !res.json.name) {
    throw new Error('Could not open a DM with ' + email + ' — ' + apiError(res));
  }

  const spaceName = String(res.json.name);

  try {
    const rec = newRecord('googleChatDmSpaces');
    rec.set('credentialId', credRecord.id);
    rec.set('playerEmail', email);
    rec.set('spaceName', spaceName);
    $app.save(rec);
  } catch (err) {
    // A cache miss next time is harmless — don't fail the send over it.
  }

  return spaceName;
}

function sendChatMessage(accessToken, spaceName, text) {
  const res = $http.send({
    method: 'POST',
    url: 'https://chat.googleapis.com/v1/' + spaceName + '/messages',
    body: JSON.stringify({ text: text }),
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
    },
    timeout: HTTP_TIMEOUT,
  });

  if (res.statusCode !== 200) {
    throw new Error('Chat message rejected — ' + apiError(res));
  }
}

// ---------------------------------------------------------------------------
// notification
// ---------------------------------------------------------------------------

/**
 * Every DM we send is one of these. The kind is recorded on each
 * matchNotifications row so one message never suppresses another: a team can
 * be told they're on deck, then that they're up, then how it went — all for
 * the same match.
 */
const KIND = {
  MATCH_START: 'match_start',
  ON_DECK: 'on_deck',
  RESULT: 'result',
  TOURNAMENT_START: 'tournament_start',
  TOURNAMENT_END: 'tournament_end',
};

/** Filter + params matching one player's rows of a single kind. */
function notificationScope(base, playerId) {
  const params = { kind: base.kind || KIND.MATCH_START };
  const clauses = ['kind = {:kind}'];

  // Tournament-wide messages (anthem, champions) have no match of their own.
  if (base.matchId) {
    clauses.push('matchId = {:mid}');
    params.mid = base.matchId;
  } else {
    clauses.push('tournamentId = {:tid} && matchId = ""');
    params.tid = base.tournamentId;
  }

  if (playerId) {
    clauses.push('playerId = {:pid}');
    params.pid = playerId;
  } else {
    clauses.push('playerId = ""');
  }

  return { filter: clauses.join(' && '), params: params };
}

function logNotification(entry) {
  const kind = entry.kind || KIND.MATCH_START;

  // Replace any earlier non-delivered attempt of the same kind for this
  // match/player, so a stop/start cycle updates the outcome instead of
  // stacking duplicate rows.
  try {
    const scope = notificationScope(entry, entry.playerId);
    const prior = $app.findRecordsByFilter(
      'matchNotifications',
      scope.filter + ' && status != "sent"',
      '',
      50,
      0,
      scope.params
    );
    for (let i = 0; i < prior.length; i++) {
      $app.delete(prior[i]);
    }
  } catch (err) {
    // de-duplication is cosmetic — never let it drop the new row
  }

  try {
    const rec = newRecord('matchNotifications');
    rec.set('tournamentId', entry.tournamentId);
    if (entry.matchId) rec.set('matchId', entry.matchId);
    if (entry.playerId) rec.set('playerId', entry.playerId);
    rec.set('playerName', entry.playerName || '');
    rec.set('chatEmail', entry.chatEmail || '');
    rec.set('kind', kind);
    rec.set('status', entry.status);
    rec.set('detail', (entry.detail || '').slice(0, 500));
    $app.save(rec);
  } catch (err) {
    $app.logger().error('Failed to write matchNotifications row', 'error', String(err));
  }
}

/** Has this exact message already reached this player? */
function alreadySent(base, playerId) {
  const scope = notificationScope(base, playerId);
  return !!findOne('matchNotifications', scope.filter + ' && status = "sent"', scope.params);
}

function teamLabel(players) {
  const names = players.map(function (p) {
    return p.get('playerName') || 'Unknown';
  });
  return names.length ? names.join(' & ') : 'TBD';
}

function loadPlayers(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    try {
      out.push($app.findRecordById('players', ids[i]));
    } catch (err) {
      // player was removed — skip
    }
  }
  return out;
}

/** Both halves of a match, with player records and display labels resolved. */
function matchSides(match) {
  const team1 = loadPlayers(toArray(match.get('team1')));
  const team2 = loadPlayers(toArray(match.get('team2')));
  const label1 = teamLabel(team1);
  const label2 = teamLabel(team2);

  return [
    { players: team1, own: label1, opponent: label2 },
    { players: team2, own: label2, opponent: label1 },
  ];
}

/**
 * A tournament's matches in the order the bracket draws them: rounds left to
 * right, and within a round top to bottom — which is creation order, the same
 * order the UI lists them in.
 */
function bracketOrder(tournamentId) {
  const ordered = [];
  try {
    const found = $app.findRecordsByFilter(
      'matches',
      'tournamentId = {:tid}',
      'round,created',
      500,
      0,
      { tid: tournamentId }
    );
    for (let i = 0; i < found.length; i++) {
      ordered.push(found[i]);
    }
  } catch (err) {
    // no matches yet, or the tournament is gone
  }
  return ordered;
}

function allPlayers(tournamentId) {
  const players = [];
  try {
    const found = $app.findRecordsByFilter(
      'players',
      'tournamentId = {:tid}',
      'created',
      500,
      0,
      { tid: tournamentId }
    );
    for (let i = 0; i < found.length; i++) {
      players.push(found[i]);
    }
  } catch (err) {
    // nobody signed up
  }
  return players;
}

/**
 * The next teams due to play, reading the bracket top to bottom, left to
 * right. Byes are skipped — there is nothing for them to warm up for.
 */
function upcomingMatches(ordered, limit) {
  const next = [];
  for (let i = 0; i < ordered.length && next.length < limit; i++) {
    const match = ordered[i];
    if (String(match.get('status')) !== 'waiting') continue;
    if (!toArray(match.get('team2')).length) continue;
    next.push(match);
  }
  return next;
}

/** Name a round the way the bracket labels it: "the Finals", "Round 2". */
function roundPhrase(ordered, match) {
  const round = Number(match.get('round'));
  let maxRound = 0;
  let inRound = 0;

  for (let i = 0; i < ordered.length; i++) {
    const r = Number(ordered[i].get('round'));
    if (r > maxRound) maxRound = r;
    if (r === round) inRound++;
  }

  if (round === maxRound && inRound === 1) return 'the Finals';
  if (round === maxRound - 1 && inRound === 2) return 'the Semi-Finals';
  return 'Round ' + round;
}

/** The last match standing — winning it wins the tournament. */
function isFinalMatch(ordered, match) {
  const round = Number(match.get('round'));
  let maxRound = 0;
  let inRound = 0;

  for (let i = 0; i < ordered.length; i++) {
    const r = Number(ordered[i].get('round'));
    if (r > maxRound) maxRound = r;
    if (r === round) inRound++;
  }

  return round === maxRound && inRound === 1;
}

function sentenceCase(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// message copy
// ---------------------------------------------------------------------------

function buildMessage(opts) {
  const lines = [
    "*You're up!* " + sentenceCase(opts.roundPhrase) + ' of *' + opts.tournamentName + '* is starting now.',
    '',
    opts.ownTeam + '  vs  ' + opts.opponentTeam,
    '',
    'Head to an open board — good luck!',
  ];
  if (opts.playerUrl) {
    lines.push(opts.playerUrl);
  }
  return lines.join('\n');
}

function buildOnDeckMessage(opts) {
  const lines = [
    '⏳ *On deck!* You play next in ' + opts.roundPhrase + ' of *' + opts.tournamentName + '*.',
  ];
  if (opts.playerUrl) {
    lines.push(opts.playerUrl);
  }
  return lines.join('\n');
}

function buildResultMessage(opts) {
  const lines = opts.won
    ? [
      '🎉 *Winner winner!* ' + opts.ownTeam + ' take ' + opts.roundPhrase + ' over ' + opts.opponentTeam + '. 🏆',
      '',
      'Great throwing — catch your breath, the next round is coming.',
    ]
    : [
      '💙 *Tough one.* ' + opts.opponentTeam + ' edged out ' + opts.ownTeam + ' in ' + opts.roundPhrase + '.',
      '',
      'Our condolences — you played it well. Stick around, grab a drink and cheer the rest of the bracket on.',
    ];
  if (opts.playerUrl) {
    lines.push('');
    lines.push(opts.playerUrl);
  }
  return lines.join('\n');
}

function buildTournamentStartMessage(opts) {
  const lines = [
    '🇺🇸 *Please rise!* *' + opts.tournamentName + '* is officially underway. 🇺🇸',
    '',
    'Gather at the boards and join every other team in singing the national anthem before the first bag flies.',
  ];
  if (opts.anthemUrl) {
    lines.push('');
    lines.push('🎵 Sing along here: ' + opts.anthemUrl);
  }
  return lines.join('\n');
}

function buildChampionsMessage(opts) {
  const lines = [
    '🎉🎊🏆 *WE HAVE CHAMPIONS!* 🏆🎊🎉',
    '',
    '🥇 *' + opts.champions + '* 🥇',
    'are your *' + opts.tournamentName + '* champions!',
    '',
    '🥈 Runner-up: ' + opts.runnerUp + ' — what a final. 👏',
    '',
    '🎆🎈 Every toss, every slide, every airmail — thank you all for playing! 🎈🎆',
    '🙌 Give it up for every team in the bracket. See you at the next one! 🎯🎉',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// delivery
// ---------------------------------------------------------------------------

/**
 * Resolve everything a send needs — the tournament, the organizer's stored
 * credentials and a usable access token. Returns null (recording why against
 * `base`) when the feature is off, unconnected, or the token can't be
 * refreshed, so a caller can simply bail out.
 */
function openSession(base) {
  let tournament;
  try {
    tournament = $app.findRecordById('tournaments', base.tournamentId);
  } catch (err) {
    return null; // tournament vanished — nothing to announce
  }

  const cfg = config();
  if (!cfg.configured) {
    logNotification(
      Object.assign({}, base, {
        status: 'skipped',
        detail: 'Google OAuth is not configured on this server.',
      })
    );
    return null;
  }

  const credRecord = findOne('googleChatCredentials', 'userId = {:uid}', {
    uid: String(tournament.get('ownerId') || ''),
  });
  if (!credRecord) {
    logNotification(
      Object.assign({}, base, {
        status: 'skipped',
        detail: 'Organizer has not connected Google Chat.',
      })
    );
    return null;
  }

  let accessToken;
  try {
    accessToken = getAccessToken(credRecord);
  } catch (err) {
    logNotification(Object.assign({}, base, { status: 'failed', detail: String(err) }));
    return null;
  }

  return {
    tournament: tournament,
    cfg: cfg,
    credRecord: credRecord,
    accessToken: accessToken,
    tournamentName: tournament.get('name') || 'the tournament',
  };
}

function playerLink(session, player) {
  return session.cfg.appBaseUrl
    ? session.cfg.appBaseUrl + '/tournament/' + player.id + '/player'
    : '';
}

/**
 * DM each `{ player, text }` target, recording an outcome row per player.
 * Never throws — a Chat failure must not stop a tournament from running, so
 * problems land in matchNotifications and surface in the organizer dashboard.
 */
function deliver(session, base, targets) {
  for (let i = 0; i < targets.length; i++) {
    const player = targets[i].player;

    // Per-player, per-kind idempotency: a double click or a stop/start cycle
    // must not DM anyone the same thing twice, but a player whose earlier send
    // failed still gets retried — which a match-wide guard would wrongly skip.
    if (alreadySent(base, player.id)) continue;

    const email = String(player.get('chatEmail') || '').trim();
    const entry = Object.assign({}, base, {
      playerId: player.id,
      playerName: player.get('playerName') || '',
      chatEmail: email,
    });

    if (!email) {
      logNotification(
        Object.assign({}, entry, {
          status: 'skipped',
          detail: 'No Google Chat email provided at signup.',
        })
      );
      continue;
    }

    try {
      const spaceName = resolveDmSpace(session.accessToken, session.credRecord, email);
      sendChatMessage(session.accessToken, spaceName, targets[i].text);
      logNotification(Object.assign({}, entry, { status: 'sent', detail: '' }));
    } catch (err) {
      logNotification(Object.assign({}, entry, { status: 'failed', detail: String(err) }));
    }
  }
}

// ---------------------------------------------------------------------------
// notifications
// ---------------------------------------------------------------------------

/** "Your match is starting now" — to the four players in the match. */
function sendMatchStart(session, match, ordered) {
  const base = {
    tournamentId: session.tournament.id,
    matchId: match.id,
    kind: KIND.MATCH_START,
  };
  const sides = matchSides(match);
  const targets = [];

  for (let s = 0; s < sides.length; s++) {
    for (let i = 0; i < sides[s].players.length; i++) {
      const player = sides[s].players[i];
      targets.push({
        player: player,
        text: buildMessage({
          roundPhrase: roundPhrase(ordered, match),
          tournamentName: session.tournamentName,
          ownTeam: sides[s].own,
          opponentTeam: sides[s].opponent,
          playerUrl: playerLink(session, player),
        }),
      });
    }
  }

  deliver(session, base, targets);
}

/**
 * "You're up next" — to the teams whose matches sit at the top of the queue,
 * one per board, so exactly the teams who could be called up get a heads-up.
 */
function sendOnDeck(session, ordered) {
  const boards = Math.max(1, Number(session.tournament.get('boardCount') || 1));
  const upcoming = upcomingMatches(ordered, boards);

  for (let m = 0; m < upcoming.length; m++) {
    const match = upcoming[m];
    const base = {
      tournamentId: session.tournament.id,
      matchId: match.id,
      kind: KIND.ON_DECK,
    };
    const sides = matchSides(match);
    const targets = [];

    for (let s = 0; s < sides.length; s++) {
      for (let i = 0; i < sides[s].players.length; i++) {
        const player = sides[s].players[i];
        targets.push({
          player: player,
          text: buildOnDeckMessage({
            roundPhrase: roundPhrase(ordered, match),
            tournamentName: session.tournamentName,
            ownTeam: sides[s].own,
            opponentTeam: sides[s].opponent,
            playerUrl: playerLink(session, player),
          }),
        });
      }
    }

    deliver(session, base, targets);
  }
}

/** Congratulations to the winners, condolences to the losers. */
function sendResult(session, match, ordered) {
  const base = {
    tournamentId: session.tournament.id,
    matchId: match.id,
    kind: KIND.RESULT,
  };
  const sides = matchSides(match);
  const winningTeam = Number(match.get('winningTeam') || 0);
  const targets = [];

  for (let s = 0; s < sides.length; s++) {
    const won = winningTeam === s + 1;
    for (let i = 0; i < sides[s].players.length; i++) {
      const player = sides[s].players[i];
      targets.push({
        player: player,
        text: buildResultMessage({
          won: won,
          roundPhrase: roundPhrase(ordered, match),
          ownTeam: sides[s].own,
          opponentTeam: sides[s].opponent,
          playerUrl: playerLink(session, player),
        }),
      });
    }
  }

  deliver(session, base, targets);
}

/** The closing ceremony — every player in the tournament hears about it. */
function sendChampions(session, finalMatch) {
  const base = {
    tournamentId: session.tournament.id,
    matchId: finalMatch.id,
    kind: KIND.TOURNAMENT_END,
  };
  const sides = matchSides(finalMatch);
  const winningTeam = Number(finalMatch.get('winningTeam') || 0);
  const champions = winningTeam === 2 ? sides[1] : sides[0];
  const runnerUp = winningTeam === 2 ? sides[0] : sides[1];

  const text = buildChampionsMessage({
    champions: champions.own,
    runnerUp: runnerUp.own,
    tournamentName: session.tournamentName,
  });

  const players = allPlayers(session.tournament.id);
  const targets = [];
  for (let i = 0; i < players.length; i++) {
    targets.push({ player: players[i], text: text });
  }

  deliver(session, base, targets);
}

/**
 * Entry point for the waiting -> active transition on `matches`: tell the
 * players who are up, and warn whoever is next in the queue.
 */
function notifyMatchActivated(match) {
  const tournamentId = String(match.get('tournamentId') || '');
  if (!tournamentId) return;

  const session = openSession({
    tournamentId: tournamentId,
    matchId: match.id,
    kind: KIND.MATCH_START,
  });
  if (!session) return;

  const ordered = bracketOrder(tournamentId);
  sendMatchStart(session, match, ordered);
  sendOnDeck(session, ordered);
}

/**
 * Entry point for a match gaining a winner: results to both teams, plus the
 * closing celebration when the match that just ended was the final.
 */
function notifyMatchDecided(match) {
  const tournamentId = String(match.get('tournamentId') || '');
  if (!tournamentId) return;

  const session = openSession({
    tournamentId: tournamentId,
    matchId: match.id,
    kind: KIND.RESULT,
  });
  if (!session) return;

  const ordered = bracketOrder(tournamentId);
  sendResult(session, match, ordered);

  if (isFinalMatch(ordered, match)) {
    sendChampions(session, match);
  }
}

/** Entry point for signup -> playing on `tournaments`: anthem time. */
function notifyTournamentStarted(tournament) {
  const base = { tournamentId: tournament.id, kind: KIND.TOURNAMENT_START };
  const session = openSession(base);
  if (!session) return;

  const text = buildTournamentStartMessage({
    tournamentName: session.tournamentName,
    anthemUrl: session.cfg.appBaseUrl
      ? session.cfg.appBaseUrl + '/tournament/' + tournament.id + '/anthem'
      : '',
  });

  const players = allPlayers(tournament.id);
  const targets = [];
  for (let i = 0; i < players.length; i++) {
    targets.push({ player: players[i], text: text });
  }

  deliver(session, base, targets);
}

module.exports = {
  SCOPES: SCOPES,
  KIND: KIND,
  config: config,
  findOne: findOne,
  buildAuthUrl: buildAuthUrl,
  createOauthState: createOauthState,
  consumeOauthState: consumeOauthState,
  exchangeCodeForTokens: exchangeCodeForTokens,
  saveCredentials: saveCredentials,
  getAccessToken: getAccessToken,
  resolveDmSpace: resolveDmSpace,
  sendChatMessage: sendChatMessage,
  notifyMatchActivated: notifyMatchActivated,
  notifyMatchDecided: notifyMatchDecided,
  notifyTournamentStarted: notifyTournamentStarted,
  buildMessage: buildMessage,
  buildOnDeckMessage: buildOnDeckMessage,
  buildResultMessage: buildResultMessage,
  buildTournamentStartMessage: buildTournamentStartMessage,
  buildChampionsMessage: buildChampionsMessage,
};
