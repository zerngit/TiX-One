import { useParams, Link, useNavigate } from "react-router";
import { concerts } from "../data/concerts";
import {
  Calendar,
  MapPin,
  Ticket,
  ArrowLeft,
  Wallet,
  Music,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { PopBackground } from "../components/PopBackground";
import { ConnectButton } from "@mysten/dapp-kit";
import { useBuyTicket } from "../onechain/useBuyTicket";
import DelbotVerification from "../components/DelbotVerification";

export default function ConcertDetail() {
  const { id } = useParams();
  const concert = concerts.find((c) => c.id === id);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authType, setAuthType] = useState<
    "onechain" | "spotify" | null
  >(null);
  const { isSpotifyConnected, connectSpotify } = useAuth();
  const { buyTicketAtPrice, isBuying, buyError, buyDigest, isConnected } = useBuyTicket();
  const [showDelbot, setShowDelbot] = useState(false);
  const navigate = useNavigate();

  const parseConcertPriceMist = (priceLabel: string): bigint => {
    const raw = String(priceLabel ?? "")
      .trim()
      .replace(/\s*oct\s*$/i, "")
      .trim();
    if (!raw) throw new Error("Concert price is missing.");
    if (!/^\d+(\.\d{0,9})?$/.test(raw)) {
      throw new Error(`Invalid concert price format: ${priceLabel}`);
    }
    const [intPart, fracPart = ""] = raw.split(".");
    const fracPadded = (fracPart + "0".repeat(9)).slice(0, 9);
    return BigInt(intPart) * 1_000_000_000n + BigInt(fracPadded);
  };

  if (!concert) {
    return (
      <div className="min-h-screen relative overflow-hidden flex items-center justify-center">
        <PopBackground />
        <div className="concert-lights" />
        <div className="fixed inset-0 bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900 animate-lights -z-10" />
        
        <div className="text-center relative z-10 bg-purple-900/60 backdrop-blur-md rounded-2xl p-8 border-2 border-pink-500/50 neon-border">
          <h2 className="text-2xl text-white mb-4 neon-text">
            Concert not found
          </h2>
          <Link
            to="/"
            className="text-pink-300 hover:text-pink-100 flex items-center gap-2 justify-center"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  const handleBuyTicket = () => {
    if (!isConnected) {
      setAuthType("onechain");
      setShowAuthModal(true);
      return;
    }

    // Show Delbot verification before proceeding with purchase
    setShowDelbot(true);
  };

  const proceedWithPurchase = () => {
    setShowDelbot(false);

    let priceMist: bigint;
    try {
      priceMist = parseConcertPriceMist(concert?.price || "");
      if (priceMist <= 0n) throw new Error("Concert price must be greater than 0.");
    } catch (e: any) {
      alert(e?.message || "Invalid concert price");
      return;
    }

    buyTicketAtPrice(priceMist, {
      artist: concert.artist,
      eventName: concert.title,
      seat: "General Admission",
    }).then((digest) => {
      if (digest) {
        const shouldRedirect = window.confirm("Ticket minted! Go to My Tickets now?");
        if (shouldRedirect) window.location.assign("/my-ticket");
      }
    });
  };

  const handleBotDetected = () => {
    setShowDelbot(false);
    navigate("/bot-detected");
  };

  const handleAuthorizeFan = () => {
    if (isSpotifyConnected) {
      // Already connected, proceed with fan authorization
      alert("Fan already authorized via Spotify!");
    } else {
      setAuthType("spotify");
      setShowAuthModal(true);
    }
  };

  const closeModal = () => {
    setShowAuthModal(false);
    setAuthType(null);
  };

  const handleModalAuth = () => {
    if (authType === "spotify") {
      connectSpotify();
    }
    closeModal();
  };

  useEffect(() => {
    if (showAuthModal && authType === "onechain" && isConnected) {
      closeModal();
    }
  }, [showAuthModal, authType, isConnected]);

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Pop Art Interactive Background */}
      <PopBackground />
      
      {/* Animated Concert Lights Background */}
      <div className="concert-lights" />
      
      {/* Dynamic gradient background with animation */}
      <div className="fixed inset-0 bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900 animate-lights -z-10" />
      
      {/* Overlay pattern */}
      <div className="fixed inset-0 opacity-10 -z-10" style={{
        backgroundImage: `radial-gradient(circle at 20% 50%, rgba(255,255,255,0.2) 1px, transparent 1px),
                          radial-gradient(circle at 80% 80%, rgba(255,255,255,0.2) 1px, transparent 1px)`,
        backgroundSize: '50px 50px'
      }} />

      {/* Header */}
      <header className="bg-black/40 backdrop-blur-md shadow-lg border-b border-pink-500/50 neon-border relative z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-pink-300 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to concerts
          </Link>
        </div>
      </header>

      {/* Concert Details */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
          {/* Left Column - Image */}
          <div className="space-y-6">
            <div className="rounded-2xl overflow-hidden shadow-2xl border-2 border-pink-500/50 neon-border">
              <img
                src={concert.posterUrl}
                alt={`${concert.artist} - ${concert.title}`}
                className="w-full h-[400px] md:h-[500px] object-cover"
              />
            </div>

            <div className="bg-gradient-to-r from-purple-900/60 to-blue-900/60 backdrop-blur-md rounded-xl p-6 border-2 border-pink-500/50 neon-border shadow-lg">
              <h3 className="text-sm text-pink-200 mb-2 flex items-center gap-2">
                <span className="inline-block w-2 h-2 bg-pink-500 rounded-full animate-pulse" />
                Blockchain Verification
              </h3>
              <p className="text-sm text-pink-300">
                All tickets are minted as unique NFTs on the
                OneChain blockchain, ensuring authenticity and
                enabling secure resale.
              </p>
            </div>
          </div>

          {/* Right Column - Details and Actions */}
          <div className="space-y-6">
            <div className="bg-gradient-to-br from-purple-900/40 to-indigo-900/40 backdrop-blur-md rounded-2xl p-6 border-2 border-pink-500/50 neon-border shadow-xl">
              <span className="inline-block text-sm px-3 py-1 rounded-full bg-gradient-to-r from-pink-500 to-purple-500 text-white mb-4 shadow-md neon-border">
                {concert.genre}
              </span>
              <h1 className="text-3xl md:text-4xl text-white mb-2 neon-text">
                {concert.artist}
              </h1>
              <p className="text-xl text-pink-200 mb-6">
                {concert.title}
              </p>

              <div className="space-y-4 text-base">
                <div className="flex items-center gap-3 bg-purple-950/30 rounded-lg p-3 border border-pink-500/20">
                  <Calendar className="w-5 h-5 text-pink-400" />
                  <div>
                    <p className="text-white">
                      {concert.date}
                    </p>
                    <p className="text-sm text-pink-300">
                      {concert.time}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 bg-purple-950/30 rounded-lg p-3 border border-pink-500/20">
                  <MapPin className="w-5 h-5 text-pink-400" />
                  <div>
                    <p className="text-white">
                      {concert.venue}
                    </p>
                    <p className="text-sm text-pink-300">
                      {concert.location} • {concert.region}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 bg-purple-950/30 rounded-lg p-3 border border-pink-500/20">
                  <Ticket className="w-5 h-5 text-pink-400" />
                  <div>
                    <p className="text-white">
                      {concert.availableTickets.toLocaleString()}{" "}
                      tickets available
                    </p>
                    <p className="text-sm text-pink-300">
                      Price: {concert.price}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-purple-900/40 to-indigo-900/40 backdrop-blur-md rounded-2xl p-6 border-2 border-pink-500/50 neon-border shadow-xl">
              <h3 className="text-lg text-white mb-3 neon-text">
                About This Event
              </h3>
              <p className="text-base text-pink-200 leading-relaxed mb-4">
                {concert.description}
              </p>
              <p className="text-sm text-pink-300 flex items-center gap-2">
                <span className="inline-block w-2 h-2 bg-pink-500 rounded-full animate-pulse" />
                Artist Origin: {concert.artistOrigin}
              </p>
            </div>

            {/* Action Buttons */}
            <div className="space-y-4">
              <button
                onClick={handleBuyTicket}
                disabled={isBuying}
                className="w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white py-4 px-6 rounded-xl hover:from-pink-700 hover:to-purple-700 transition-all duration-200 shadow-lg hover:shadow-pink-500/50 flex items-center justify-center gap-3 text-base neon-border disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Wallet className="w-5 h-5" />
                {!isConnected
                  ? "Connect to Buy Ticket"
                  : isBuying
                  ? "Processing..."
                  : "Buy Ticket / Join Queue"}
              </button>

              {(buyError || buyDigest) && (
                <div className="bg-purple-950/30 backdrop-blur-sm rounded-xl p-4 border-2 border-pink-500/30 neon-border">
                  {buyError && (
                    <p className="text-sm text-red-300">{buyError}</p>
                  )}
                  {buyDigest && (
                    <p className="text-sm text-green-300">
                      Ticket minted! Tx: <span className="font-mono">{buyDigest}</span>
                    </p>
                  )}
                </div>
              )}

              <button
                onClick={handleAuthorizeFan}
                className="w-full bg-gradient-to-r from-green-600 to-emerald-600 border-2 border-green-500/50 text-white py-4 px-6 rounded-xl hover:from-green-700 hover:to-emerald-700 hover:border-green-400 transition-all duration-200 shadow-lg flex items-center justify-center gap-3 text-base neon-border"
              >
                <Music className="w-5 h-5" />
                {isSpotifyConnected
                  ? "Authorized Fan ✓"
                  : "Authorize as Fan (Spotify)"}
              </button>
            </div>

            {!isConnected && !isSpotifyConnected && (
              <p className="text-sm text-pink-300 text-center bg-purple-950/30 rounded-lg p-3 border-2 border-pink-500/30 neon-border">
                Connect your wallet or Spotify to access
                ticketing features
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Delbot Verification Modal */}
      {showDelbot && (
        <DelbotVerification
          minDataPoints={50}
          onHumanVerified={proceedWithPurchase}
          onBotDetected={handleBotDetected}
          onCancel={() => setShowDelbot(false)}
        />
      )}

      {/* Authentication Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gradient-to-br from-purple-950 to-indigo-950 border-2 border-pink-500/50 neon-border rounded-2xl max-w-md w-full p-6 md:p-8 shadow-2xl">
            <div className="text-center mb-6">
              {authType === "onechain" ? (
                <>
                  <div className="w-16 h-16 bg-purple-600/30 border-2 border-pink-500 neon-border rounded-full flex items-center justify-center mx-auto mb-4">
                    <Wallet className="w-8 h-8 text-pink-300" />
                  </div>
                  <h3 className="text-2xl text-white mb-2 neon-text">
                    Connect OneWallet
                  </h3>
                  <p className="text-base text-pink-300">
                    Connect your OneChain OneWallet to purchase
                    tickets or join the queue
                  </p>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 bg-green-600/30 border-2 border-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Music className="w-8 h-8 text-green-300" />
                  </div>
                  <h3 className="text-2xl text-white mb-2 neon-text">
                    Connect with Spotify
                  </h3>
                  <p className="text-base text-pink-300">
                    Verify your fan status by connecting your
                    Spotify account
                  </p>
                </>
              )}
            </div>

            <div className="space-y-3">
              {authType === "onechain" ? (
                <ConnectButton className="w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white py-3 px-6 rounded-xl hover:from-pink-700 hover:to-purple-700 transition-all duration-200 text-base shadow-lg neon-border" />
              ) : (
                <button
                  onClick={handleModalAuth}
                  className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-3 px-6 rounded-xl hover:from-green-700 hover:to-emerald-700 transition-all duration-200 text-base shadow-lg"
                >
                  Connect Spotify
                </button>
              )}
              
              <button
                onClick={closeModal}
                className="w-full bg-purple-900/50 border-2 border-pink-500/50 text-white py-3 px-6 rounded-xl hover:bg-purple-800/60 hover:border-pink-400 transition-all duration-200 text-base neon-border"
              >
                Cancel
              </button>
            </div>

            <p className="text-xs text-pink-400 text-center mt-4 bg-purple-950/30 rounded-lg p-2 border border-pink-500/30">
              Authentication will be handled by the backend
            </p>
          </div>
        </div>
      )}
    </div>
  );
}