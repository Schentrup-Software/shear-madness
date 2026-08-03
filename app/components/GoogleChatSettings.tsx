import { useEffect, useState } from "react";
import {
  getGoogleChatStatus,
  getGoogleChatConnectUrl,
  disconnectGoogleChat,
  type GoogleChatStatus,
} from "../backend/api";

interface GoogleChatSettingsProps {
  /** Path the OAuth callback should bounce back to, e.g. `/tournament?id=abc`. */
  returnTo: string;
}

/**
 * Lets the organizer connect their Google account so the app can DM players
 * in Google Chat — as them — when a match starts. Renders nothing when the
 * server has no OAuth credentials configured, so deployments that don't use
 * the feature don't show a dead card.
 */
export default function GoogleChatSettings({ returnTo }: GoogleChatSettingsProps) {
  const [status, setStatus] = useState<GoogleChatStatus | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    getGoogleChatStatus().then(setStatus);

    // The OAuth callback redirects back with the outcome in the query string.
    const params = new URLSearchParams(window.location.search);
    const result = params.get('chat');
    if (result === 'connected') {
      setBanner({ kind: 'success', text: 'Google Chat connected. Players will be notified when their match starts.' });
    } else if (result === 'error') {
      setBanner({
        kind: 'error',
        text: params.get('chatMessage') || 'Could not connect Google Chat. Please try again.',
      });
    }

    // Strip the params so a refresh doesn't replay the banner.
    if (result) {
      params.delete('chat');
      params.delete('chatMessage');
      const query = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''));
    }
  }, []);

  const handleConnect = async () => {
    setIsBusy(true);
    setBanner(null);
    try {
      window.location.href = await getGoogleChatConnectUrl(returnTo);
    } catch (error: any) {
      console.error('Failed to start Google Chat connect:', error);
      setBanner({
        kind: 'error',
        text: error?.response?.message || 'Could not reach Google. Please try again.',
      });
      setIsBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Google Chat? Players will stop receiving turn notifications.')) {
      return;
    }
    setIsBusy(true);
    setBanner(null);
    try {
      await disconnectGoogleChat();
      setStatus({ configured: true, connected: false, googleEmail: '' });
    } catch (error) {
      console.error('Failed to disconnect Google Chat:', error);
      setBanner({ kind: 'error', text: 'Could not disconnect. Please try again.' });
    } finally {
      setIsBusy(false);
    }
  };

  // Nothing to offer until we know the server supports it.
  if (!status || !status.configured) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-gray-700 rounded-lg shadow-lg p-6">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
        Google Chat notifications
      </h2>

      {banner && (
        <p
          className={`mb-4 text-sm ${
            banner.kind === 'success'
              ? 'text-green-700 dark:text-green-400'
              : 'text-red-600 dark:text-red-400'
          }`}
        >
          {banner.text}
        </p>
      )}

      {status.connected ? (
        <>
          <p className="text-gray-700 dark:text-gray-200">
            Connected as{' '}
            <span className="font-semibold">{status.googleEmail || 'your Google account'}</span>.
            Players who gave a Google Chat email will get a direct message from you when their
            match starts.
          </p>
          <button
            onClick={handleDisconnect}
            disabled={isBusy}
            className="mt-4 bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-500 disabled:opacity-50 text-gray-900 dark:text-white font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            Disconnect
          </button>
        </>
      ) : (
        <>
          <p className="text-gray-700 dark:text-gray-200">
            Connect your Google account and the app will send each player a Google Chat message —
            from you — the moment their match starts. Players opt in by adding their email when
            they sign up.
          </p>
          <button
            onClick={handleConnect}
            disabled={isBusy}
            className="mt-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            {isBusy ? 'Redirecting…' : 'Connect Google Chat'}
          </button>
        </>
      )}
    </div>
  );
}
