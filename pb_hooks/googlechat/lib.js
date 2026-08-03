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
 *   3. When the organizer starts a match, the record hook DMs each opted-in
 *      player *as the organizer* using the Chat API.
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

function logNotification(entry) {
  // Replace any earlier non-delivered attempt for this match/player, so a
  // stop/start cycle updates the outcome instead of stacking duplicate rows.
  try {
    const byPlayer = !!entry.playerId;
    const prior = $app.findRecordsByFilter(
      'matchNotifications',
      byPlayer
        ? 'matchId = {:mid} && playerId = {:pid} && status != "sent"'
        : 'matchId = {:mid} && playerId = "" && status != "sent"',
      '',
      50,
      0,
      byPlayer ? { mid: entry.matchId, pid: entry.playerId } : { mid: entry.matchId }
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
    rec.set('matchId', entry.matchId);
    if (entry.playerId) rec.set('playerId', entry.playerId);
    rec.set('playerName', entry.playerName || '');
    rec.set('chatEmail', entry.chatEmail || '');
    rec.set('status', entry.status);
    rec.set('detail', (entry.detail || '').slice(0, 500));
    $app.save(rec);
  } catch (err) {
    $app.logger().error('Failed to write matchNotifications row', 'error', String(err));
  }
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

function buildMessage(opts) {
  const lines = [
    "🌽 *You're up!* Round " + opts.round + ' of *' + opts.tournamentName + '* is starting now.',
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

/**
 * Entry point for the `matches` update hook. Never throws: a Chat failure must
 * not stop a tournament from running, so everything is recorded to
 * matchNotifications and surfaced in the organizer dashboard instead.
 */
function notifyMatchStarted(match) {
  const tournamentId = String(match.get('tournamentId') || '');
  if (!tournamentId) return;

  let tournament;
  try {
    tournament = $app.findRecordById('tournaments', tournamentId);
  } catch (err) {
    return;
  }

  const cfg = config();
  const base = { tournamentId: tournamentId, matchId: match.id };

  if (!cfg.configured) {
    logNotification(
      Object.assign({}, base, {
        status: 'skipped',
        detail: 'Google OAuth is not configured on this server.',
      })
    );
    return;
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
    return;
  }

  let accessToken;
  try {
    accessToken = getAccessToken(credRecord);
  } catch (err) {
    logNotification(Object.assign({}, base, { status: 'failed', detail: String(err) }));
    return;
  }

  const team1 = loadPlayers(toArray(match.get('team1')));
  const team2 = loadPlayers(toArray(match.get('team2')));
  const team1Label = teamLabel(team1);
  const team2Label = teamLabel(team2);

  const sides = [
    { players: team1, own: team1Label, opponent: team2Label },
    { players: team2, own: team2Label, opponent: team1Label },
  ];

  for (let s = 0; s < sides.length; s++) {
    const side = sides[s];
    for (let i = 0; i < side.players.length; i++) {
      const player = side.players[i];

      // Per-player idempotency: a double click or a stop/start cycle must not
      // DM anyone twice, but a player whose earlier send failed still gets
      // retried — which a match-wide guard would wrongly skip.
      const priorSend = findOne(
        'matchNotifications',
        'matchId = {:mid} && playerId = {:pid} && status = "sent"',
        { mid: match.id, pid: player.id }
      );
      if (priorSend) continue;

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
        const spaceName = resolveDmSpace(accessToken, credRecord, email);
        sendChatMessage(
          accessToken,
          spaceName,
          buildMessage({
            round: match.get('round'),
            tournamentName: tournament.get('name') || 'the tournament',
            ownTeam: side.own,
            opponentTeam: side.opponent,
            playerUrl: cfg.appBaseUrl
              ? cfg.appBaseUrl + '/tournament/' + player.id + '/player'
              : '',
          })
        );
        logNotification(Object.assign({}, entry, { status: 'sent', detail: '' }));
      } catch (err) {
        logNotification(Object.assign({}, entry, { status: 'failed', detail: String(err) }));
      }
    }
  }
}

module.exports = {
  SCOPES: SCOPES,
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
  notifyMatchStarted: notifyMatchStarted,
  buildMessage: buildMessage,
};
