import { useEffect, useState } from "react";
import { getMatchNotifications } from "../backend/api";

interface NotificationLogProps {
  tournamentId: string;
  /** Bump to force a refetch — e.g. right after a match is started. */
  refreshToken: number;
}

const STATUS_STYLES: Record<string, string> = {
  sent: 'text-green-700 dark:text-green-400',
  failed: 'text-red-600 dark:text-red-400',
  skipped: 'text-gray-500 dark:text-gray-400',
};

// Players get several messages about the same match, so each row says which
// one it was. Rows written before the field existed fall back to "your turn".
const KIND_LABELS: Record<string, string> = {
  match_start: 'your turn',
  on_deck: 'on deck',
  result: 'result',
  tournament_start: 'anthem',
  tournament_end: 'champions',
};

/**
 * Delivery receipts for the Google Chat messages sent through a tournament.
 * Without this a failed DM is invisible — the organizer would assume players
 * were told when they weren't. Hidden entirely when the feature was never used.
 */
export default function NotificationLog({ tournamentId, refreshToken }: NotificationLogProps) {
  const [entries, setEntries] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!tournamentId) return;
    // The hook writes these rows while the start-match request is in flight,
    // so give it a beat before reading them back.
    const timer = setTimeout(() => {
      getMatchNotifications(tournamentId).then(setEntries);
    }, refreshToken === 0 ? 0 : 750);
    return () => clearTimeout(timer);
  }, [tournamentId, refreshToken]);

  if (entries.length === 0) {
    return null;
  }

  const failures = entries.filter((entry) => entry.status === 'failed').length;
  const sent = entries.filter((entry) => entry.status === 'sent').length;

  return (
    <div className="mt-8 bg-white dark:bg-gray-700 rounded-lg shadow-lg">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <span className="font-semibold text-gray-900 dark:text-white">
          Chat notifications
          <span className="ml-2 font-normal text-sm text-gray-500 dark:text-gray-400">
            {sent} sent
            {failures > 0 && (
              <span className="text-red-600 dark:text-red-400"> · {failures} failed</span>
            )}
          </span>
        </span>
        <span className="text-gray-400">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <ul className="divide-y divide-gray-200 dark:divide-gray-600 border-t border-gray-200 dark:border-gray-600">
          {entries.map((entry) => (
            <li key={entry.id} className="px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-gray-900 dark:text-gray-100">
                  {entry.playerName || '—'}
                  <span className="text-gray-500 dark:text-gray-400">
                    {' · '}{KIND_LABELS[entry.kind] ?? KIND_LABELS.match_start}
                    {entry.chatEmail && ` · ${entry.chatEmail}`}
                  </span>
                </span>
                <span className={`font-medium ${STATUS_STYLES[entry.status] ?? ''}`}>
                  {entry.status}
                </span>
              </div>
              {entry.detail && (
                <p className="mt-1 text-gray-500 dark:text-gray-400 break-words">{entry.detail}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
