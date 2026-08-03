/// <reference path="../.local-pocketbase/pb_data/types.d.ts" />

/**
 * Google Chat integration — hook and route registration.
 *
 * PocketBase runs every handler below in its own isolated runtime, so each one
 * must require() the shared module rather than closing over anything here.
 * See ./googlechat/lib.js for the implementation.
 */

// ---------------------------------------------------------------------------
// Notify players when their match goes live
// ---------------------------------------------------------------------------

onRecordAfterUpdateSuccess((e) => {
  e.next();

  try {
    const previous = e.record.original().get('status');
    const current = e.record.get('status');

    // Only the waiting -> active transition means "your turn".
    if (current !== 'active' || previous === 'active') return;

    const gchat = require(`${__hooks}/googlechat/lib.js`);
    gchat.notifyMatchStarted(e.record);
  } catch (err) {
    // A notification problem must never break starting a match.
    $app.logger().error('Google Chat notification failed', 'error', String(err));
  }
}, 'matches');

// ---------------------------------------------------------------------------
// GET /api/google-chat/status — is the server configured, is this user connected
// ---------------------------------------------------------------------------

routerAdd(
  'GET',
  '/api/google-chat/status',
  (e) => {
    const gchat = require(`${__hooks}/googlechat/lib.js`);
    const cfg = gchat.config();
    const creds = gchat.findOne('googleChatCredentials', 'userId = {:uid}', { uid: e.auth.id });

    return e.json(200, {
      configured: cfg.configured,
      connected: !!creds,
      googleEmail: creds ? creds.get('googleEmail') : '',
    });
  },
  $apis.requireAuth()
);

// ---------------------------------------------------------------------------
// POST /api/google-chat/connect — start the OAuth dance
// ---------------------------------------------------------------------------

routerAdd(
  'POST',
  '/api/google-chat/connect',
  (e) => {
    const gchat = require(`${__hooks}/googlechat/lib.js`);
    const cfg = gchat.config();

    if (!cfg.configured) {
      return e.json(503, {
        message:
          'Google Chat is not configured on this server. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.',
      });
    }

    let returnTo = '/';
    try {
      const body = e.requestInfo().body;
      if (body && body.returnTo) returnTo = String(body.returnTo);
    } catch (err) {
      // fall through to the default
    }

    // Only ever bounce back to a path on this app — never an absolute URL.
    if (returnTo.indexOf('/') !== 0 || returnTo.indexOf('//') === 0) {
      returnTo = '/';
    }

    const state = gchat.createOauthState(e.auth.id, returnTo);
    return e.json(200, { authUrl: gchat.buildAuthUrl(state) });
  },
  $apis.requireAuth()
);

// ---------------------------------------------------------------------------
// GET /api/google-chat/callback — Google redirects the browser back here
// ---------------------------------------------------------------------------

routerAdd('GET', '/api/google-chat/callback', (e) => {
  const gchat = require(`${__hooks}/googlechat/lib.js`);

  const query = e.request.url.query();
  const state = query.get('state');
  const code = query.get('code');
  const oauthError = query.get('error');

  // The state record holds the only link back to the PocketBase user, so it
  // has to be read before we can decide where to send the browser.
  const stateData = gchat.consumeOauthState(state);
  const returnTo = stateData && stateData.returnTo ? stateData.returnTo : '/';

  const bounce = (status, message) => {
    const sep = returnTo.indexOf('?') === -1 ? '?' : '&';
    // Send the browser back to the app's own origin. In production that's the
    // same host serving this route, but in local dev the SPA is on the Vite
    // port while Google's registered redirect URI points at PocketBase — a
    // relative redirect would strand the organizer on the wrong port.
    // appBaseUrl is server config, not user input, so it can't be abused; the
    // open-redirect guard on /connect still keeps returnTo to a bare path.
    const origin = gchat.config().appBaseUrl;
    return e.redirect(
      302,
      origin +
        returnTo +
        sep +
        'chat=' +
        status +
        (message ? '&chatMessage=' + encodeURIComponent(message) : '')
    );
  };

  if (!stateData) {
    return bounce('error', 'This authorization link expired. Please try connecting again.');
  }
  if (oauthError) {
    return bounce('error', 'Google returned: ' + oauthError);
  }
  if (!code) {
    return bounce('error', 'Google did not return an authorization code.');
  }

  try {
    const tokens = gchat.exchangeCodeForTokens(code);
    gchat.saveCredentials(stateData.userId, tokens);
  } catch (err) {
    $app.logger().error('Google Chat OAuth callback failed', 'error', String(err));
    return bounce('error', String(err));
  }

  return bounce('connected', '');
});

// ---------------------------------------------------------------------------
// POST /api/google-chat/disconnect — forget the stored tokens
// ---------------------------------------------------------------------------

routerAdd(
  'POST',
  '/api/google-chat/disconnect',
  (e) => {
    const gchat = require(`${__hooks}/googlechat/lib.js`);
    const creds = gchat.findOne('googleChatCredentials', 'userId = {:uid}', { uid: e.auth.id });

    // Cached DM spaces cascade away with the credentials record.
    if (creds) $app.delete(creds);

    return e.json(200, { connected: false });
  },
  $apis.requireAuth()
);
