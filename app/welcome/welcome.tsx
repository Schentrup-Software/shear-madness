import logo from "./Gemini_Generated_Image_o61wnho61wnho61w-removebg-preview.png";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { addTournament, getTournament, getTournamentsByOwner } from "../backend/api";

export function Welcome() {
  const navigate = useNavigate();
  const [tournamentName, setTournamentName] = useState("");
  const [boardCount, setBoardCount] = useState(1);
  const [existingTournaments, setExistingTournaments] = useState<any[]>([]);

  useEffect(() => {
    const fetchTournaments = async () => {
      try {
        const tournaments = await getTournamentsByOwner();
        setExistingTournaments(tournaments);
      } catch (error) {
        console.error("Error fetching tournaments:", error);
      }
    };

    fetchTournaments();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tournamentName.trim()) {
      try {
        const tournament = await addTournament(tournamentName, boardCount);
        navigate(`/tournament?id=${tournament.id}`);
      } catch (error) {
        console.error("Failed to save tournament:", error);
      }
    }
  };

  return (
    <main className="flex items-center justify-center pt-16 pb-4 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 min-h-screen">
      <div className="flex-1 flex flex-col items-center gap-8 min-h-0 w-full max-w-4xl px-4">
        <header className="flex flex-col items-center gap-4">
          <div className="w-[500px] max-w-[100vw]">
            <img
              src={logo}
              alt="Tournament Logo"
              className="w-full"
            />
          </div>
        </header>
        <div className="max-w-[300px] w-full space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-3">
              <label htmlFor="tournamentName" className="block text-xl font-bold text-gray-800 dark:text-gray-100 text-center">
                Tournament Name
              </label>
              <input
                type="text"
                id="tournamentName"
                value={tournamentName}
                onChange={(e) => setTournamentName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                placeholder="Enter tournament name"
                required
              />
            </div>
            <div className="space-y-3">
              <label htmlFor="boardCount" className="block text-xl font-bold text-gray-800 dark:text-gray-100 text-center">
                Number of Boards
              </label>
              <input
                type="number"
                id="boardCount"
                value={boardCount}
                min={1}
                onChange={(e) => setBoardCount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                required
              />
            </div>
            <button
              type="submit"
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-900 hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:hover:bg-blue-800"
            >
              Get Started
            </button>
          </form>
        </div>

        {existingTournaments.length > 0 && (
          <div className="w-full bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6">
            <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">
              Your Tournaments
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-300 dark:border-gray-600">
                    <th className="text-left py-3 px-4 text-gray-700 dark:text-gray-200 font-semibold">
                      Tournament Name
                    </th>
                    <th className="text-left py-3 px-4 text-gray-700 dark:text-gray-200 font-semibold">
                      Status
                    </th>
                    <th className="text-left py-3 px-4 text-gray-700 dark:text-gray-200 font-semibold">
                      Created
                    </th>
                    <th className="text-left py-3 px-4 text-gray-700 dark:text-gray-200 font-semibold">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {existingTournaments.map((tournament) => (
                    <tr
                      key={tournament.id}
                      className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <td className="py-3 px-4 text-gray-900 dark:text-gray-100">
                        {tournament.name}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${tournament.status === 'playing'
                            ? 'bg-green-200 text-green-800 dark:bg-green-800 dark:text-green-200'
                            : 'bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-200'
                          }`}>
                          {tournament.status || 'signup'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-700 dark:text-gray-300">
                        {new Date(tournament.created).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() => navigate(`/tournament?id=${tournament.id}`)}
                          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}