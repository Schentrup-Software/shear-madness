import { useRef, useState } from "react";
import { useParams } from "react-router";

export default function Anthem() {
  const { id } = useParams();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-screen-md">
      <div className="bg-white dark:bg-gray-700 rounded-lg shadow-lg p-6 flex flex-col items-center gap-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white text-center">
          Let the Games Begin!
        </h1>
        <img
          src="/IndependenceDayWave.gif"
          alt="Independence Day Wave"
          className="w-full max-w-lg rounded-lg shadow"
        />
        <audio
          ref={audioRef}
          src="/USANationalAnthem.mp3"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
        />
        <button
          onClick={togglePlay}
          className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-lg transition-colors shadow-lg"
        >
          {isPlaying ? "Pause National Anthem" : "Play National Anthem"}
        </button>
        <a
          href={`/tournament/${id}/bracket`}
          className="w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-lg transition-colors shadow-lg"
        >
          Continue to Bracket
        </a>
      </div>
    </div>
  );
}
