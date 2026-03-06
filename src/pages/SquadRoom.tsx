import { useEffect, useState, useCallback } from "react";
import { useNavigate, useParams, useLocation } from "react-router";
import { useCurrentAccount } from "@mysten/dapp-kit";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  LogOut,
  RefreshCw,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { motion } from "motion/react";
import { supabase } from "../lib/supabase";

/* ─── Types ─── */
interface SquadInfo {
  id: string;
  name: string;
  vibe: string;
  concert_id: string;
  max_members: number;
  discord_channel_id: string | null;
  invite_url: string | null;
}

interface Member {
  id: string;
  wallet: string;
  bio: string;
  joined_at: string;
}

/* ─── Page ─── */
export default function SquadRoom() {
  const { squadId } = useParams<{ squadId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const currentAccount = useCurrentAccount();
  const walletAddress = currentAccount?.address || "";

  const { concertName } = (location.state as any) || {};

  const [squad, setSquad] = useState<SquadInfo | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [polling, setPolling] = useState(false);

  /* ── Fetch squad data ── */
  /* ── Fetch squad data ── */
  const fetchSquad = useCallback(async () => {
    if (!squadId || !supabase) return;
    try {
      const [{ data: squadData }, { data: membersData }] = await Promise.all([
        supabase.from("squads").select("*").eq("id", squadId).single(),
        supabase
          .from("squad_members")
          .select("*")
          .eq("squad_id", squadId)
          .order("joined_at", { ascending: true }),
      ]);
      if (squadData) setSquad(squadData);
      if (membersData) setMembers(membersData);
    } catch (err) {
      console.error("Failed to load squad room:", err);
    }
  }, [squadId]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await fetchSquad();
      setLoading(false);
    };
    init();
  }, [fetchSquad]);

  /* ── Poll until invite_url is ready (backend may still be creating) ── */
  useEffect(() => {
    if (!squad || squad.invite_url) return;
    setPolling(true);
    const interval = setInterval(async () => {
      if (!supabase || !squadId) return;
      const { data } = await supabase
        .from("squads")
        .select("invite_url, discord_channel_id")
        .eq("id", squadId)
        .single();
      if (data?.invite_url) {
        setSquad((prev) => (prev ? { ...prev, ...data } : prev));
        setPolling(false);
        clearInterval(interval);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [squad?.invite_url, squadId]);

  /* ── Handlers ── */
  const handleOpenDiscord = () => {
    if (squad?.invite_url) {
      window.open(squad.invite_url, "_blank");
    }
  };

  const handleLeave = async () => {
    if (!supabase || !squadId || !walletAddress) return;
    if (!window.confirm("Are you sure you want to leave this squad?")) return;
    setLeaving(true);
    try {
      await supabase
        .from("squad_members")
        .delete()
        .eq("squad_id", squadId)
        .eq("wallet", walletAddress);
      navigate(-1);
    } catch (err) {
      console.error("Leave error:", err);
      alert("Failed to leave squad");
    } finally {
      setLeaving(false);
    }
  };

  /* ── Helpers ── */
  const shortenWallet = (w: string) =>
    w.length > 12 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w;

  const getAvatarGradient = (wallet: string) => {
    const gradients = [
      "from-violet-500 to-indigo-600",
      "from-pink-500 to-rose-600",
      "from-emerald-500 to-teal-600",
      "from-amber-500 to-orange-600",
      "from-cyan-500 to-blue-600",
    ];
    let hash = 0;
    for (let i = 0; i < wallet.length; i++) {
      hash = wallet.charCodeAt(i) + ((hash << 5) - hash);
    }
    return gradients[Math.abs(hash) % gradients.length];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0d0a1a]">
        <Loader2 className="w-10 h-10 animate-spin text-purple-500" />
      </div>
    );
  }

  if (!squad) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#0d0a1a] text-white gap-4">
        <p className="text-white/50">Squad not found.</p>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-purple-400 hover:text-purple-300 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0a1a] text-white font-sans">
      {/* Fixed background blurs */}
      <div className="fixed top-0 right-0 w-[500px] h-[500px] bg-purple-600/10 blur-[120px] rounded-full -mr-64 -mt-64 pointer-events-none" />
      <div className="fixed bottom-0 left-0 w-[500px] h-[500px] bg-pink-600/10 blur-[120px] rounded-full -ml-64 -mb-64 pointer-events-none" />

      {/* Top nav bar */}
      <div className="relative border-b border-white/5 bg-black/20 backdrop-blur-xl px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            Back to Lobby
          </button>
        </div>
      </div>

      <div className="relative max-w-3xl mx-auto px-6 py-10 space-y-8">

        {/* Squad Header Card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative group"
        >
          <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-3xl blur opacity-20 group-hover:opacity-40 transition duration-700" />
          <div className="relative glass-card p-8 border-white/20 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
                  <Zap className="w-8 h-8 text-white fill-white" />
                </div>
                <div>
                  <h1 className="font-display font-bold text-2xl text-white">{squad.name}</h1>
                  <p className="text-sm text-white/40 mt-0.5">{concertName || "Concert Squad"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-emerald-400 font-medium">{members.length}/{squad.max_members} members</span>
              </div>
            </div>

            <p className="text-sm text-white/60 leading-relaxed">{squad.vibe}</p>

            {/* Discord CTA */}
            <div className="pt-2">
              {squad.invite_url ? (
                <button
                  onClick={handleOpenDiscord}
                  className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 rounded-2xl text-base font-bold text-white shadow-lg shadow-purple-500/30 transition-all active:scale-[0.98]"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
                  </svg>
                  Open Discord Room
                  <ExternalLink className="w-4 h-4 opacity-60" />
                </button>
              ) : (
                <div className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-white/5 border border-white/10 rounded-2xl text-sm text-white/40">
                  {polling ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Setting up your Discord room…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      Discord room not ready yet —&nbsp;
                      <button
                        onClick={fetchSquad}
                        className="text-purple-400 hover:text-purple-300 underline text-xs"
                      >
                        Refresh
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* Members Section */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-4"
        >
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-400" />
            <h2 className="font-display font-semibold text-lg text-white">Squad Members</h2>
          </div>

          <div className="space-y-3 mt-6">
  {members.map((m, index) => (
    <div
      key={m.id}
      className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl backdrop-blur-md transition-all duration-300 hover:-translate-y-1"
      style={{
        backgroundColor: "rgba(255, 255, 255, 0.06)",
        border: "1px solid rgba(255, 255, 255, 0.15)",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)"
      }}
    >
      {/* Member ID and Address */}
      <div className="flex items-center gap-3 flex-wrap">
        <span 
          style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.85rem", fontWeight: 600 }}
        >
          Member {index + 1}:
        </span>
        <span className="text-base font-bold text-white font-mono tracking-wide">
          {shortenWallet(m.wallet)}
        </span>
        
        {/* "YOU" Badge */}
        {m.wallet === walletAddress && (
          <span 
            className="text-[10px] px-2 py-0.5 rounded-md font-black uppercase tracking-wider"
            style={{
              backgroundColor: "rgba(167, 139, 246, 0.2)",
              color: "#c4b5fd",
              border: "1px solid rgba(167, 139, 246, 0.3)"
            }}
          >
            YOU
          </span>
        )}
      </div>
      
      {/* Online Status */}
      <div 
        className="flex items-center gap-2 px-3 py-1.5 rounded-full shrink-0"
        style={{
          backgroundColor: "rgba(52, 211, 153, 0.1)",
          border: "1px solid rgba(52, 211, 153, 0.3)"
        }}
      >
        <span 
          className="w-1.5 h-1.5 rounded-full animate-pulse" 
          style={{ backgroundColor: "#34d399" }} 
        />
        <span 
          className="text-[10px] font-black uppercase tracking-widest"
          style={{ color: "#34d399" }}
        >
          Online
        </span>
      </div>
    </div>
  ))}
</div>
        </motion.section>

        {/* Info note */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="flex items-start gap-3 p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20"
        >
          <Sparkles className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
          <p className="text-xs text-indigo-200/70 leading-relaxed">
            Squad chat lives in Discord. Click <strong className="text-indigo-300">Open Discord Room</strong> above to chat with your squad, share plans, and vibe together before the show!
          </p>
        </motion.div>

        {/* Leave */}
        <div className="flex justify-center pt-4 pb-6">
          <button
            onClick={handleLeave}
            disabled={leaving}
            className="flex items-center justify-center gap-2 px-6 py-3 rounded-[10px] text-[#fca5a5] hover:text-white transition-all active:scale-95 disabled:opacity-50 font-black uppercase tracking-widest text-xs"
            style={{
              border: "2px solid rgba(239,68,68,0.5)",
              background: "linear-gradient(135deg, rgba(127,0,0,0.5), rgba(185,28,28,0.4))",
              boxShadow: "0 0 16px rgba(239,68,68,0.2)"
            }}
          >
            {leaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
            {leaving ? "Leaving…" : "Leave Squad"}
          </button>
        </div>

      </div>
    </div>
  );
}
