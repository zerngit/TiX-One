import { createContext, useContext, useState, ReactNode } from "react";

const LS_KEY = 'tix_fan_scores';

interface AuthContextType {
  isOneChainConnected: boolean;
  isSpotifyConnected: boolean;
  fanScores: Record<string, number>;
  spotifyLoading: boolean;
  connectOneChain: () => void;
  connectSpotify: () => void;
  storeFanScores: (scoresStr: string) => void;
  disconnectOneChain: () => void;
  disconnectSpotify: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isOneChainConnected, setIsOneChainConnected] = useState(false);
  const [spotifyLoading, setSpotifyLoading] = useState(false);
  const [fanScores, setFanScores] = useState<Record<string, number>>(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });

  const isSpotifyConnected = Object.keys(fanScores).length > 0;

  const connectOneChain = () => setIsOneChainConnected(true);

  const connectSpotify = async () => {
    setSpotifyLoading(true);
    try {
      // Dynamically grab the backend URL from Vercel's environment variables
      // If it doesn't exist (like on your local PC), fallback to localhost!
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8787';
      
      const res = await fetch(`${backendUrl}/auth-url-global`);
      const { url } = await res.json();
      window.location.assign(url); // full-page redirect to Spotify
    } catch (e) {
      console.error('[spotify] failed to get auth URL', e);
      setSpotifyLoading(false);
    }
  };

  const storeFanScores = (scoresStr: string) => {
    try {
      const parsed: Record<string, number> = {};
      for (const pair of scoresStr.split(',')) {
        const [id, score] = pair.split(':');
        if (id && score !== undefined) parsed[id] = parseInt(score, 10);
      }
      setFanScores(parsed);
      localStorage.setItem(LS_KEY, JSON.stringify(parsed));
    } catch (e) {
      console.error('[spotify] failed to parse fan scores', e);
    }
  };

  const disconnectOneChain = () => setIsOneChainConnected(false);

  const disconnectSpotify = () => {
    setFanScores({});
    localStorage.removeItem(LS_KEY);
  };

  return (
    <AuthContext.Provider
      value={{
        isOneChainConnected,
        isSpotifyConnected,
        fanScores,
        spotifyLoading,
        connectOneChain,
        connectSpotify,
        storeFanScores,
        disconnectOneChain,
        disconnectSpotify,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
