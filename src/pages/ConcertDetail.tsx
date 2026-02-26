import { useParams, useNavigate } from "react-router-dom";
import { concerts } from "../data/concerts";
import { useEffect, useState } from "react";
import { PopBackground } from "../components/PopBackground";
import { ConnectButton } from "@mysten/dapp-kit";
import { useBuyTicket } from "../onechain/useBuyTicket";
import DelbotVerification from "../components/DelbotVerification";

export default function ConcertDetail() {
  const { id } = useParams();
  const concert = concerts.find((c) => c.id === id);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authType, setAuthType] = useState<"onechain" | null>(null);
  const [showDelbot, setShowDelbot] = useState(false);

  const [fanScore, setFanScore] = useState<number | null>(null);
  const [isFanVerified, setIsFanVerified] = useState(false);

  const { buyTicketAtPrice, isBuying, isConnected } =
    useBuyTicket();

  const navigate = useNavigate();

  if (!concert) return null;

  const isFirstHour = true;
  const requiredScore = 60;

  /* ===========================
     🔥 SPOTIFY AUTH REQUEST
     Sends BOTH eventId + artist
  ============================*/
  const handleAuthorizeFan = async () => {
    try {
      const response = await fetch(
        `http://127.0.0.1:4000/auth-url?eventId=${concert.id}&artist=${encodeURIComponent(
          concert.artist
        )}`
      );

      const data = await response.json();

      if (!data.url) {
        console.error("No auth URL returned");
        return;
      }

      window.location.href = data.url;
    } catch (error) {
      console.error("Spotify verification failed:", error);
    }
  };

  const handleBuyTicket = () => {
    if (!isConnected) {
      setAuthType("onechain");
      setShowAuthModal(true);
      return;
    }

    if (isFirstHour && !isFanVerified) {
      alert("First-hour sale is for verified fans only.");
      return;
    }

    setShowDelbot(true);
  };

  const proceedWithPurchase = () => {
    setShowDelbot(false);

    const priceMist = BigInt(1000000000);

    buyTicketAtPrice(priceMist, {
      artist: concert.artist,
      eventName: concert.title,
      seat: "General Admission",
    }).then((digest) => {
      if (digest) {
        window.location.assign("/my-ticket");
      }
    });
  };

  const handleBotDetected = () => {
    setShowDelbot(false);
    navigate("/bot-detected");
  };

  const closeModal = () => {
    setShowAuthModal(false);
    setAuthType(null);
  };

  /* ===========================
     Read score from redirect
  ============================*/
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const scoreParam = params.get("score");

    if (scoreParam) {
      const score = Number(scoreParam);
      setFanScore(score);

      if (score >= requiredScore) {
        setIsFanVerified(true);
        alert("Fan Verified! Early access unlocked.");
      } else {
        alert("Fan score too low for early access.");
      }
    }
  }, []);

  return (
    <div className="min-h-screen relative overflow-hidden">
      <PopBackground />

      <div className="max-w-6xl mx-auto px-6 py-12 relative z-10">
        <h1 className="text-3xl text-white mb-4">
          {concert.artist} — {concert.title}
        </h1>

        {fanScore !== null && (
          <div className="mb-4 p-3 bg-purple-900/40 rounded-xl">
            <p className="text-white">
              Fan Score: <strong>{fanScore}</strong>
            </p>
            <p className="text-sm text-pink-300">
              {isFanVerified
                ? "Verified for early access"
                : "Not eligible for early access"}
            </p>
          </div>
        )}

        <div className="space-y-4">
          <button
            onClick={handleBuyTicket}
            disabled={isBuying}
            className="w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white py-4 rounded-xl"
          >
            {!isConnected
              ? "Connect Wallet to Buy"
              : "Buy Ticket / Join Queue"}
          </button>

          <button
            onClick={handleAuthorizeFan}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 rounded-xl"
          >
            {isFanVerified
              ? "Fan Verified ✓"
              : "Authorize as Fan (Spotify)"}
          </button>
        </div>
      </div>

      {showDelbot && (
        <DelbotVerification
          minDataPoints={50}
          onHumanVerified={proceedWithPurchase}
          onBotDetected={handleBotDetected}
          onCancel={() => setShowDelbot(false)}
        />
      )}

      {showAuthModal && authType === "onechain" && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center">
          <div className="bg-purple-950 p-6 rounded-2xl">
            <ConnectButton />
            <button onClick={closeModal}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}