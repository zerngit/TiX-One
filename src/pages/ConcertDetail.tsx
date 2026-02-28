import { useParams, Link, useNavigate, useLocation } from "react-router";
import { useConcertById } from "../hooks/useConcerts";
import {
  Calendar,
  MapPin,
  Ticket,
  ArrowLeft,
  Wallet,
  Music,
  Lock,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { PopBackground } from "../components/PopBackground";
import { ConnectButton, useCurrentAccount } from "@mysten/dapp-kit";
import { useBuyTicket } from "../onechain/useBuyTicket";
import DelbotVerification from "../components/DelbotVerification";

export default function ConcertDetail() {
  const { id } = useParams();
  const currentAccount = useCurrentAccount();
  const { concert, loading: concertLoading } = useConcertById(id);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authType, setAuthType] = useState<
    "onechain" | "spotify" | null
  >(null);
  const { isSpotifyConnected, fanScores } = useAuth();
  const { buyTicketAtPrice, buyVerifiedFanTicket, joinWaitlist, isBuying, buyError, buyDigest, isConnected } = useBuyTicket();
  const [showDelbot, setShowDelbot] = useState(false);
  const [pendingPurchaseType, setPendingPurchaseType] = useState<"fan" | "public" | null>(null);
  const [quantity, setQuantity] = useState(1);
  const navigate = useNavigate();
  const location = useLocation();

  // ── Fan verification state ─────────────────────────────────────────────────
  const [isFanVerified, setIsFanVerified] = useState(false);
  const [fanScore, setFanScore] = useState<number | null>(null);
  const [fanToken, setFanToken] = useState<string | null>(null); // HMAC token issued by backend after Spotify check
  const [spotifyLoading, setSpotifyLoading] = useState(false);

  // ── Live clock (ticks every second) ───────────────────────────────────────
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Pre-verify from global Spotify check (done on homepage) ─────────────
  useEffect(() => {
    if (!concert) return;
    const stored = fanScores[concert.id];
    if (stored !== undefined) {
      setFanScore(stored);
      if (stored >= 60) setIsFanVerified(true);
    }
  }, [concert, fanScores]);

  // ── Read ?score= and ?fanToken= from URL after per-concert Spotify callback, clean URL ───
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const scoreStr  = params.get("score");
    const tokenStr  = params.get("fanToken");
    if (scoreStr !== null) {
      const score = parseInt(scoreStr, 10);
      setFanScore(score);
      if (score >= 60) setIsFanVerified(true);
    }
    if (tokenStr) setFanToken(tokenStr);
    if (scoreStr !== null || tokenStr) {
      // Strip query params so URL looks clean
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [location.search]);

  // ── Sale times derived from concert date ──────────────────────────────────
  // publicSaleTime = concert date at 10:00 UTC minus 14 days ("2 weeks before show")
  const publicSaleTime = (() => {
    if (!concert) return 0;
    const d = new Date(concert.date);
    d.setUTCHours(10, 0, 0, 0);
    return d.getTime() - 14 * 24 * 60 * 60 * 1000;
  })();
  const fanSaleTime = publicSaleTime - 5 * 60 * 1000; // 5-minute head start

  // ── Countdown formatter ───────────────────────────────────────────────────
  const formatCountdown = (targetMs: number): string => {
    const diff = targetMs - currentTime;
    if (diff <= 0) return "";
    const days  = Math.floor(diff / 86_400_000);
    const hours = Math.floor((diff % 86_400_000) / 3_600_000);
    const mins  = Math.floor((diff % 3_600_000) / 60_000);
    const secs  = Math.floor((diff % 60_000) / 1_000);
    if (days > 0)  return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
    return `${mins}m ${secs}s`;
  };

  const fanSaleOpen    = currentTime >= fanSaleTime;
  const publicSaleOpen = currentTime >= publicSaleTime;

  // ── Modal auto-close when wallet connects ─────────────────────────────────
  useEffect(() => {
    if (showAuthModal && authType === "onechain" && isConnected) {
      setShowAuthModal(false);
      setAuthType(null);
    }
  }, [showAuthModal, authType, isConnected]);

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

  // ── Trigger Spotify OAuth for the current concert ─────────────────────────
  const handleSpotifyAuth = useCallback(async () => {
    if (!concert) return;
    setSpotifyLoading(true);
    try {
      const backendUrl = typeof import.meta.env.VITE_BACKEND_URL === "string" && import.meta.env.VITE_BACKEND_URL
        ? import.meta.env.VITE_BACKEND_URL
        : "http://127.0.0.1:8787";
      const res = await fetch(
        `${backendUrl}/auth-url?eventId=${encodeURIComponent(concert.id)}&artistName=${encodeURIComponent(concert.artist)}`,
      );
      const data = await res.json();
      if (data.url) {
        window.location.assign(data.url);
      } else {
        alert(data.error || "Failed to get Spotify auth URL");
        setSpotifyLoading(false);
      }
    } catch {
      alert("Cannot reach backend. Make sure it is running.");
      setSpotifyLoading(false);
    }
  }, [concert]);

  if (concertLoading) {
    return (
      <div className="min-h-screen relative overflow-hidden flex items-center justify-center">
        <PopBackground />
        <div className="concert-lights" />
        <div className="fixed inset-0 bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900 animate-lights -z-10" />
        <div className="text-center relative z-10">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pink-500 mx-auto mb-4" />
          <p className="text-pink-200">Loading concert…</p>
        </div>
      </div>
    );
  }

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

  const handleBuyTicket = (type: "fan" | "public") => {
    if (!isConnected) {
      setAuthType("onechain");
      setShowAuthModal(true);
      return;
    }
    setPendingPurchaseType(type);
    setShowDelbot(true);
  };

  const handleFanPresale = () => {
    if (!fanSaleOpen) return; // guard: button disabled anyway
    if (!isFanVerified) {
      handleSpotifyAuth();
      return;
    }
    handleBuyTicket("fan");
  };

  const handlePublicSale = () => {
    if (!publicSaleOpen) return;
    handleBuyTicket("public");
  };

  const proceedWithPurchase = async () => {
    setShowDelbot(false);

    if (!concert.concert_object_id) {
      alert("This concert is not yet linked to the blockchain. Please contact the organizer.");
      setPendingPurchaseType(null);
      return;
    }

    let priceMist: bigint;
    try {
      priceMist = parseConcertPriceMist(concert.price || "");
      if (priceMist <= 0n) throw new Error("Concert price must be greater than 0.");
    } catch (e: any) {
      alert(e?.message || "Invalid concert price");
      setPendingPurchaseType(null);
      return;
    }

    // ── Verified Fan path — get backend Ed25519 signature first ───────────
    if (pendingPurchaseType === "fan" && isFanVerified && fanToken) {
      setPendingPurchaseType(null);
      const backendUrl = typeof import.meta.env.VITE_BACKEND_URL === "string" && import.meta.env.VITE_BACKEND_URL
        ? import.meta.env.VITE_BACKEND_URL
        : "http://127.0.0.1:8787";
      try {
        const signRes = await fetch(
          `${backendUrl}/sign-fan-purchase?wallet=${encodeURIComponent(currentAccount!.address)}&concertObjectId=${encodeURIComponent(concert.concert_object_id)}&fanToken=${encodeURIComponent(fanToken)}`
        );
        const signData = await signRes.json();
        if (signData.error) throw new Error(signData.error);
        const digest = await buyVerifiedFanTicket(priceMist, concert.concert_object_id, signData.signature, "Fan Presale");
        if (digest) {
          const go = window.confirm("Fan ticket minted! 🎉 Go to My Tickets now?");
          if (go) window.location.assign("/my-ticket");
        }
      } catch (err: any) {
        alert(err.message || "Could not get fan verification signature.");
      }
      return;
    }

    // ── Public sale path ─────────────────────────────────────────────────
    setPendingPurchaseType(null);
    buyTicketAtPrice(priceMist, concert.concert_object_id, "General Admission", quantity).then((digest) => {
      if (digest) {
        const shouldRedirect = window.confirm(`${quantity} ticket${quantity > 1 ? "s" : ""} minted! Go to My Tickets now?`);
        if (shouldRedirect) window.location.assign("/my-ticket");
      }
    });
  };

  const handleBotDetected = () => {
    setShowDelbot(false);
    setPendingPurchaseType(null);
    navigate("/bot-detected");
  };

  const closeModal = () => {
    setShowAuthModal(false);
    setAuthType(null);
  };

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

            {/* Action Buttons — Dual Countdown or Sold-Out Waitlist */}
            <div className="space-y-4">

              {/* Fan score badge (shown after Spotify callback) */}
              {fanScore !== null && concert.availableTickets > 0 && (
                <div className={`flex items-center gap-2 rounded-xl px-4 py-2 border-2 text-sm ${
                  isFanVerified
                    ? "bg-green-900/40 border-green-500/60 text-green-300"
                    : "bg-red-900/30 border-red-500/50 text-red-300"
                }`}>
                  <ShieldCheck className="w-4 h-4 flex-shrink-0" />
                  {isFanVerified
                    ? `Fan verified ✓ — Score: ${fanScore}/100`
                    : `Score too low (${fanScore}/100) — need 60+ for presale`}
                </div>
              )}

              {concert.availableTickets === 0 ? (
                /* ─── SOLD OUT: Show Join Waitlist ─── */
                <div className="space-y-3">
                  <div className="rounded-xl bg-red-900/30 border-2 border-red-500/50 text-red-300 px-4 py-3 text-center text-sm font-bold">
                    🔴 SOLD OUT
                  </div>

                  <button
                    onClick={async () => {
                      if (!isConnected) {
                        setAuthType("onechain");
                        setShowAuthModal(true);
                        return;
                      }
                      if (!concert.waitlist_object_id) {
                        alert("No waitlist has been created for this concert yet. Check back soon!");
                        return;
                      }
                      let priceMist: bigint;
                      try { priceMist = parseConcertPriceMist(concert.price || ""); }
                      catch (e: any) { alert(e?.message || "Invalid concert price"); return; }
                      await joinWaitlist(concert.waitlist_object_id, priceMist);
                    }}
                    disabled={isBuying || !concert.waitlist_object_id}
                    title={concert.waitlist_object_id
                      ? "Join the waitlist — your OCT is held in escrow until a ticket becomes available"
                      : "Waitlist coming soon"}
                    className="w-full py-4 px-6 rounded-xl flex items-center justify-center gap-3 text-base font-semibold transition-all duration-200 shadow-lg neon-border bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Clock className="w-5 h-5" />
                    {isBuying
                      ? "Processing…"
                      : concert.waitlist_object_id
                      ? "Join Waitlist (Deposit OCT)"
                      : "Waitlist Coming Soon"}
                  </button>

                  {concert.waitlist_object_id && (
                    <p className="text-xs text-purple-300/70 text-center">
                      Your OCT deposit is held in on-chain escrow. You will receive a ticket the moment a holder returns one.
                    </p>
                  )}
                </div>
              ) : (
                /* ─── TICKETS AVAILABLE: Normal buy buttons ─── */
                <>
                  {/* ── Button 1: Fan Presale (5-min head start) ── */}
                  <div>
                    <button
                      onClick={handleFanPresale}
                      disabled={!fanSaleOpen || isBuying || spotifyLoading}
                      className={`w-full py-4 px-6 rounded-xl flex items-center justify-center gap-3 text-base transition-all duration-200 shadow-lg neon-border
                        ${ fanSaleOpen && isFanVerified
                            ? "bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white hover:shadow-green-500/50"
                            : fanSaleOpen && !isFanVerified
                            ? "bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-700 hover:to-orange-700 text-white"
                            : "bg-purple-900/40 border-pink-500/30 text-pink-400 cursor-not-allowed opacity-70"
                        } disabled:opacity-60 disabled:cursor-not-allowed`}
                    >
                      {!fanSaleOpen ? (
                        <><Lock className="w-5 h-5" /> Fan Presale opens in {formatCountdown(fanSaleTime)}</>
                      ) : isFanVerified ? (
                        <><ShieldCheck className="w-5 h-5" /> Fan Presale — Buy Now (Verified ✓)</>
                      ) : spotifyLoading ? (
                        <><Clock className="w-5 h-5 animate-spin" /> Connecting to Spotify…</>
                      ) : (
                        <><Music className="w-5 h-5" /> Fan Presale — Verify with Spotify</>
                      )}
                    </button>
                    {fanSaleOpen && !isFanVerified && (
                      <p className="text-xs text-yellow-300/70 mt-1 text-center">
                        Scores 60+ get presale access. Your long-term listening history is checked.
                      </p>
                    )}
                  </div>

                  {/* ── Quantity Selector (shown during fan presale AND public sale) ── */}
                  {(fanSaleOpen || publicSaleOpen) && (
                    <div className="flex items-center justify-between bg-purple-950/40 border-2 border-pink-500/30 rounded-xl px-4 py-3 neon-border">
                      <span className="text-pink-200 text-sm font-medium">Quantity</span>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setQuantity(q => Math.max(1, q - 1))}
                          className="w-8 h-8 rounded-full bg-purple-800 hover:bg-purple-700 text-white text-lg font-bold flex items-center justify-center transition-colors"
                        >−</button>
                        <span className="text-white font-bold w-6 text-center">{quantity}</span>
                        <button
                          onClick={() => setQuantity(q => Math.min(concert.availableTickets, q + 1))}
                          className="w-8 h-8 rounded-full bg-purple-800 hover:bg-purple-700 text-white text-lg font-bold flex items-center justify-center transition-colors"
                        >+</button>
                      </div>
                    </div>
                  )}

                  {/* ── Button 2: Public Sale ── */}
                  <div>
                    <button
                      onClick={handlePublicSale}
                      disabled={!publicSaleOpen || isBuying}
                      className={`w-full py-4 px-6 rounded-xl flex items-center justify-center gap-3 text-base transition-all duration-200 shadow-lg neon-border
                        ${ publicSaleOpen
                            ? "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 text-white hover:shadow-pink-500/50"
                            : "bg-purple-900/40 border-pink-500/30 text-pink-400 cursor-not-allowed opacity-70"
                        } disabled:opacity-60 disabled:cursor-not-allowed`}
                    >
                      {!publicSaleOpen ? (
                        <><Lock className="w-5 h-5" /> Public Sale opens in {formatCountdown(publicSaleTime)}</>
                      ) : (
                        <><Wallet className="w-5 h-5" />
                          {!isConnected ? "Connect Wallet to Buy" : isBuying ? "Processing…" : "Public Sale — Buy Ticket"}
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
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
            </div>

            {!isConnected && !isFanVerified && (
              <p className="text-sm text-pink-300 text-center bg-purple-950/30 rounded-lg p-3 border-2 border-pink-500/30 neon-border">
                Connect your wallet or verify as a fan via Spotify to access ticketing features
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
          onCancel={() => { setShowDelbot(false); setPendingPurchaseType(null); }}
        />
      )}

      {/* Wallet connect modal (onechain only — Spotify is handled via redirect) */}
      {showAuthModal && authType === "onechain" && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gradient-to-br from-purple-950 to-indigo-950 border-2 border-pink-500/50 neon-border rounded-2xl max-w-md w-full p-6 md:p-8 shadow-2xl">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-purple-600/30 border-2 border-pink-500 neon-border rounded-full flex items-center justify-center mx-auto mb-4">
                <Wallet className="w-8 h-8 text-pink-300" />
              </div>
              <h3 className="text-2xl text-white mb-2 neon-text">Connect OneWallet</h3>
              <p className="text-base text-pink-300">
                Connect your OneChain wallet to purchase tickets or join the queue
              </p>
            </div>
            <div className="space-y-3">
              <ConnectButton className="w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white py-3 px-6 rounded-xl hover:from-pink-700 hover:to-purple-700 transition-all duration-200 text-base shadow-lg neon-border" />
              <button
                onClick={closeModal}
                className="w-full bg-purple-900/50 border-2 border-pink-500/50 text-white py-3 px-6 rounded-xl hover:bg-purple-800/60 hover:border-pink-400 transition-all duration-200 text-base neon-border"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}