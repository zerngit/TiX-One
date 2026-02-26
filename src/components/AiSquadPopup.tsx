import { useMemo, useState } from "react";
import { ExternalLink, Loader2, Rocket, Users, X } from "lucide-react";

interface AiSquadPopupProps {
  isOpen: boolean;
  onClose: () => void;
  ticketId: string;
  concertName: string;
  concertId: string;
}

export const AiSquadPopup = ({
  isOpen,
  onClose,
  ticketId,
  concertName,
  concertId,
}: AiSquadPopupProps) => {
  const [loading, setLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");

  const apiBaseUrl = useMemo(() => {
    const fromEnv = (import.meta as any)?.env?.VITE_SQUAD_API_BASE_URL;
    return typeof fromEnv === "string" && fromEnv ? fromEnv : "http://localhost:8787";
  }, []);

  const handleMatchMe = async () => {
    setLoading(true);
    setErrorMessage("");
    setStatusMessage(`Contacting squad backend at ${apiBaseUrl}…`);
    try {
      const response = await fetch(`${apiBaseUrl}/api/create-squad`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId, concertName, concertId }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        console.error("Squad matching failed:", response.status, text);
        let fromBody = "";
        try {
          const parsed = text ? JSON.parse(text) : null;
          if (parsed?.details?.message) fromBody = String(parsed.details.message);
          else if (parsed?.error) fromBody = String(parsed.error);
        } catch {
          // ignore
        }
        setErrorMessage(
          fromBody ||
            `Request failed (${response.status}). Make sure the Discord backend is running and the bot is in the target server.`,
        );
        setStatusMessage("");
        return;
      }

      const data = await response.json();
      if (data?.inviteUrl) {
        setInviteUrl(String(data.inviteUrl));
        setStatusMessage("");
      } else {
        setErrorMessage("Backend responded but did not return an invite URL.");
        setStatusMessage("");
      }
    } catch (err) {
      console.error("Squad matching failed:", err);
      setErrorMessage(
        "Could not reach the squad backend. Start it on http://localhost:8787 and try again.",
      );
      setStatusMessage("");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-pink-500/50 bg-gradient-to-br from-purple-950 to-indigo-950 backdrop-blur-md p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xl font-bold text-white neon-text">🎟️ Squad Room</div>
            <div className="mt-1 text-sm text-pink-200">
              Joining <strong className="text-white">{concertName}</strong>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-1 text-pink-300 hover:text-white hover:bg-pink-900/40 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {!inviteUrl ? (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-pink-200">
              Don't go alone! Create a private Discord squad room linked to your ticket and let our AI concierge handle the logistics.
            </p>

            <button
              onClick={handleMatchMe}
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 border-none text-white py-3 px-5 hover:from-pink-500 hover:to-purple-500 transition-colors font-bold shadow-[0_0_15px_rgba(236,72,153,0.4)] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Users className="w-5 h-5" />
              )}
              {loading ? "Creating squad room…" : "Match Me with a Squad"}
            </button>

            {statusMessage ? (
              <div className="text-sm text-pink-200 rounded-xl border border-pink-500/30 bg-purple-900/40 p-3">
                {statusMessage}
              </div>
            ) : null}

            {errorMessage ? (
              <div className="text-sm text-red-300 rounded-xl border border-red-500/30 bg-red-900/20 p-3">
                {errorMessage}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-6 space-y-5 text-center">
            <div className="flex justify-center">
              <Rocket className="w-14 h-14 text-pink-400 animate-bounce" />
            </div>
            <div>
              <div className="text-lg font-bold text-white">Squad Room Created!</div>
              <p className="mt-1 text-sm text-pink-200">
                Your private Discord room and AI guide are waiting.
              </p>
            </div>
            <a
              href={inviteUrl}
              target="_blank"
              rel="noreferrer"
              className="w-full rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 text-white py-3 px-5 hover:from-pink-500 hover:to-purple-500 transition-colors font-bold shadow-[0_0_15px_rgba(236,72,153,0.4)] flex items-center justify-center gap-2"
            >
              <ExternalLink className="w-5 h-5" />
              Join Discord Squad
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
