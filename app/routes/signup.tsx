import { useEffect, useState } from "react";
import { getTournament, addPlayer } from "../backend/api";

export default function Signup() {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [chatEmail, setChatEmail] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const path = window.location.pathname;
    const segments = path.split('/');
    setId(segments[segments.length - 2]);

    try {
      getTournament(segments[segments.length - 2]).then(tournament => {
        setName(tournament.name);
        setIsActive(tournament.status === 'signup');
      });
    } catch (error) {
      console.error("Failed to fetch tournament:", error);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!playerName.trim()) {
      setErrorMessage('Please enter your name');
      return;
    }

    const trimmedEmail = chatEmail.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setErrorMessage('That does not look like a valid email address');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const player = await addPlayer(id, playerName, trimmedEmail);
      window.location.href = `/tournament/${player.id}/player`;
    } catch (error) {
      console.error("Failed to add player:", error);
      setErrorMessage('Failed to register. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8 text-gray-900 dark:text-white">
        Signup For {name}
      </h1>
      {!isActive && (
        <p className="text-red-600 dark:text-red-400 mb-6">
          Sorry, this tournament is no longer accepting new players.
        </p>
      )}
      {isActive && (
        <div className="bg-white dark:bg-gray-700 rounded-lg shadow-lg p-6">
          <p className="text-gray-700 dark:text-gray-200 mb-6">
            Fill out the form below to join the tournament.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="playerName"
                className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2"
              >
                Your Name
              </label>
              <input
                type="text"
                id="playerName"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
                placeholder="Enter your name"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label
                htmlFor="chatEmail"
                className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2"
              >
                Google Chat email <span className="font-normal text-gray-500 dark:text-gray-400">(optional)</span>
              </label>
              <input
                type="email"
                id="chatEmail"
                value={chatEmail}
                onChange={(e) => setChatEmail(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
                placeholder="you@company.com"
                disabled={isSubmitting}
              />
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                Add it and you'll get a Google Chat message from the organizer when it's your
                turn to play. Leave it blank to skip notifications.
              </p>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              {isSubmitting ? 'Registering...' : 'Register for Tournament'}
            </button>

            {errorMessage && (
              <p className='text-red-600 dark:text-red-400'>
                {errorMessage}
              </p>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
