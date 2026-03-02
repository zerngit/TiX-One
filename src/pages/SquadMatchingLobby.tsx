/*SquadMatchingLobby*/

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  ArrowLeft,
  ChevronRight,
  Circle,
  Compass,
  Hash,
  Loader2,
  Search,
  Sparkles,
  Star,
  Users,
  UserPlus,
  Wind,
  Zap,
} from "lucide-react";
import { motion } from "motion/react";
import { supabase } from "../lib/supabase";

/* ─── Types ─── */
interface Squad {
  id: string;
  name: string;
  vibe: string;
  concert_id: string;
  max_members: number;
  created_at: string;
  member_count?: number;
  members?: { wallet: string; bio: string }[];
}

interface MatchedSquad extends Squad {
  matchScore: number;
  reason: string;
}

/* ─── Page ─── */
export default function SquadMatchingLobby() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentAccount = useCurrentAccount();

  const { ticketId, concertName, concertId } = (location.state as any) || {};

  const walletAddress = currentAccount?.address || "";

  /* State */
  const [vibeText, setVibeText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [matched, setMatched] = useState<MatchedSquad[]>([]);
  const [showMatches, setShowMatches] = useState(false);

  const [allSquads, setAllSquads] = useState<Squad[]>([]);
  const [loadingSquads, setLoadingSquads] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedCategory, setSelectedCategory] = useState("All");
  const categories = ["All", "High Energy", "Chill", "VIP", "First-Timer", "Creative"];

  /* ── Fetch all squads ── */
  const fetchSquads = async () => {
    if (!supabase) return;
    setLoadingSquads(true);
    try {
      let query = supabase.from("squads").select("*");
      if (concertId) query = query.eq("concert_id", concertId);
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;

      // Fetch member counts for each squad
      const squadsWithMembers: Squad[] = [];
      for (const sq of data || []) {
        const { data: members } = await supabase
          .from("squad_members")
          .select("wallet, bio")
          .eq("squad_id", sq.id);
        squadsWithMembers.push({
          ...sq,
          member_count: members?.length || 0,
          members: members || [],
        });
      }
      setAllSquads(squadsWithMembers);
    } catch (err) {
      console.error("Failed to fetch squads:", err);
    } finally {
      setLoadingSquads(false);
    }
  };

  useEffect(() => {
    fetchSquads();
  }, [concertId]);

  /* ── Filtered squads ── */
  const filteredSquads = useMemo(() => {
    let result = allSquads;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) || s.vibe.toLowerCase().includes(q)
      );
    }
    if (selectedCategory !== "All") {
      const catLower = selectedCategory.toLowerCase();
      result = result.filter((s) => s.vibe.toLowerCase().includes(catLower));
    }
    return result;
  }, [allSquads, searchQuery, selectedCategory]);

  /* ── AI Analyze (Gemini) ── */
  const handleAnalyze = async () => {
    if (!vibeText.trim() || !supabase) return;
    setAnalyzing(true);
    setShowMatches(false);

    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string;
      if (!apiKey) throw new Error("Missing VITE_GEMINI_API_KEY");

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      // Build a compact squad list for the prompt
      const squadSummaries = allSquads
        .map((sq) => `id:${sq.id} | name:${sq.name} | vibe:${sq.vibe}`)
        .join("\n");

      const prompt = `You are a concert squad matching assistant.

User's vibe: "${vibeText}"

Available squads:
${squadSummaries}

Analyze the user's vibe against every squad listed above. Return a JSON array (no markdown, no code block) of ALL squads with the following fields:
- id (string)
- matchScore (integer 1-99)
- reason (1 short sentence explaining the match)

Order the array by matchScore descending.`;

      const result = await model.generateContent(prompt);
      const rawText = result.response.text().trim();

      // Strip any accidental markdown fences
      const jsonText = rawText.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();
      const parsed: { id: string; matchScore: number; reason: string }[] = JSON.parse(jsonText);

      // Merge Gemini scores back onto the full squad objects
      const scoreMap = new Map(parsed.map((p) => [p.id, p]));
      const scored: MatchedSquad[] = allSquads
        .map((sq) => {
          const gemini = scoreMap.get(sq.id);
          return {
            ...sq,
            matchScore: gemini?.matchScore ?? 20,
            reason: gemini?.reason ?? "Good overall match for your vibe!",
          };
        })
        .sort((a, b) => b.matchScore - a.matchScore);

      setMatched(scored.slice(0, 3));
      setShowMatches(true);
    } catch (err) {
      console.error("AI analysis error:", err);
    } finally {
      setAnalyzing(false);
    }
  };

  /* ── Join Squad ── */
  const handleJoinSquad = async (squadId: string) => {
    if (!supabase || !walletAddress) return;
    setJoiningId(squadId);
    try {
      // Check if already a member
      const { data: existing } = await supabase
        .from("squad_members")
        .select("id")
        .eq("squad_id", squadId)
        .eq("wallet", walletAddress)
        .maybeSingle();

      if (existing) {
        // Already a member, go directly to room
        navigate(`/squad/${squadId}`, {
          state: { concertName, concertId },
        });
        return;
      }

      const { error } = await supabase.from("squad_members").insert({
        squad_id: squadId,
        wallet: walletAddress,
        bio: vibeText || "",
      });
      if (error) throw error;

      navigate(`/squad/${squadId}`, {
        state: { concertName, concertId },
      });
    } catch (err) {
      console.error("Join error:", err);
      alert("Failed to join squad");
    } finally {
      setJoiningId(null);
    }
  };

  const shortenWallet = (w: string) =>
    w.length > 12 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w;

  /* ── Pick icon & color for a squad based on vibe text ── */
  const getSquadVisual = (vibe: string) => {
    const v = vibe.toLowerCase();
    if (v.includes("energy") || v.includes("bass") || v.includes("edm") || v.includes("mosh"))
      return { icon: Zap, color: "text-blue-400" };
    if (v.includes("chill") || v.includes("relax") || v.includes("calm") || v.includes("wave"))
      return { icon: Wind, color: "text-emerald-400" };
    if (v.includes("vip") || v.includes("premium") || v.includes("exclusive"))
      return { icon: Star, color: "text-amber-400" };
    if (v.includes("creative") || v.includes("art") || v.includes("neon") || v.includes("synth") || v.includes("dream"))
      return { icon: Sparkles, color: "text-purple-400" };
    if (v.includes("first") || v.includes("new") || v.includes("beginner"))
      return { icon: UserPlus, color: "text-cyan-400" };
    return { icon: Star, color: "text-pink-400" };
  };

  return (
    <div className="flex min-h-screen font-sans selection:bg-purple-500/30">
      {/* ═══ SIDEBAR ═══ */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-white/5 bg-black/20 backdrop-blur-xl sticky top-0 h-screen self-start">
        {/* Brand */}
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
            <Zap className="w-5 h-5 text-white fill-white" />
          </div>
          <div>
            <h1 className="font-display font-bold text-sm tracking-tight text-white">TIX-One Squads</h1>
            <p className="text-[10px] text-white/40 flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
              {allSquads.reduce((sum, s) => sum + (s.member_count || 0), 0)} Online
            </p>
          </div>
        </div>

        <nav className="flex-1 px-4 py-2 space-y-6 overflow-y-auto">
          {/* Back */}
          <div className="space-y-1">
            <button
              onClick={() => navigate(-1)}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-white/60 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Ticket
            </button>
          </div>

          {/* Explore */}
          <div className="space-y-1">
            <h2 className="px-3 text-[10px] font-bold uppercase tracking-widest text-white/30 mb-2">Explore</h2>
            <button className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium bg-white/10 text-white rounded-xl border border-white/10 shadow-inner">
              <Compass className="w-4 h-4 text-purple-400" />
              Squad Lobby
            </button>
          </div>

          {/* Categories */}
          <div className="space-y-1">
            <h2 className="px-3 text-[10px] font-bold uppercase tracking-widest text-white/30 mb-2">Categories</h2>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-all rounded-lg ${
                  selectedCategory === cat
                    ? "text-white bg-white/5"
                    : "text-white/50 hover:text-white hover:bg-white/5"
                }`}
              >
                <Hash className={`w-4 h-4 ${selectedCategory === cat ? "text-purple-400" : "text-white/20"}`} />
                {cat}
              </button>
            ))}
          </div>
        </nav>

        {/* User card */}
        {walletAddress && (
          <div className="p-4">
            <div className="p-3 rounded-2xl bg-gradient-to-r from-purple-900/40 to-pink-900/40 border border-white/10 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center font-bold text-xs text-white">
                {walletAddress.slice(2, 4).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate text-white">{shortenWallet(walletAddress)}</p>
                <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                  <Circle className="w-1.5 h-1.5 fill-current" /> Online
                </p>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* ═══ MAIN CONTENT ═══ */}
      <main className="flex-1 min-w-0 p-8 lg:p-12">
        <div className="max-w-4xl mx-auto space-y-12">

          {/* Header */}
          <header className="text-center space-y-2">
            <motion.h2
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="font-display font-bold text-4xl tracking-tight text-white"
            >
              Find Your Squad
            </motion.h2>
            <div className="flex items-center justify-center gap-4 text-white/40">
              <div className="h-px w-12 bg-gradient-to-r from-transparent to-white/20" />
              <div className="flex items-center gap-2">
                <Wind className="w-4 h-4" />
                <span className="text-xs font-medium uppercase tracking-widest">
                  {concertName || "Concert"} Lobby
                </span>
                <Wind className="w-4 h-4 rotate-180" />
              </div>
              <div className="h-px w-12 bg-gradient-to-l from-transparent to-white/20" />
            </div>
          </header>

          {/* ── AI Hero / Vibe Input ── */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative group"
          >
            <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-3xl blur opacity-20 group-hover:opacity-40 transition duration-1000 group-hover:duration-200" />
            <div className="relative glass-card p-8 border-white/20">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                </div>
                <div>
                  <h3 className="font-display font-semibold text-lg text-white">What's Your Vibe?</h3>
                  <p className="text-xs text-white/50">Tell us your sound-soul, and our AI matches you with the perfect squad!</p>
                </div>
              </div>

              <div className="relative">
                <textarea
                  value={vibeText}
                  onChange={(e) => setVibeText(e.target.value)}
                  maxLength={300}
                  placeholder="e.g., I'm a front-row EDM fanatic who loves bass drops and dancing all night! 🎵🔥"
                  className="w-full h-32 bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50 transition-all resize-none"
                />
                <div className="absolute bottom-4 right-4 flex items-center gap-4">
                  <span className="text-[10px] text-white/30 font-mono">{vibeText.length}/300</span>
                  <button
                    onClick={handleAnalyze}
                    disabled={analyzing || !vibeText.trim()}
                    className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-purple-500/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-white"
                  >
                    {analyzing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    {analyzing ? "Analyzing…" : "AI Analyze"}
                  </button>
                </div>
              </div>
            </div>
          </motion.section>

          {/* ── AI Match Results ── */}
          {showMatches && matched.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className="flex items-center gap-2">
                <Star className="w-5 h-5 text-yellow-400" />
                <h3 className="font-display font-semibold text-xl text-white">Top 3 Matches For You</h3>
              </div>
              <div className="space-y-3">
                {matched.map((sq, idx) => {
                  const { icon: SqIcon, color } = getSquadVisual(sq.vibe);
                  return (
                    <motion.div
                      key={sq.id}
                      whileHover={{ x: 4 }}
                      className="group relative flex items-center gap-6 p-5 glass-card hover:bg-white/10 transition-all cursor-pointer overflow-hidden"
                    >
                      {/* Waveform */}
                      <div className="absolute right-0 top-0 h-full w-1/3 opacity-10 pointer-events-none">
                        <svg viewBox="0 0 100 100" className="h-full w-full">
                          <path d="M0 50 Q 25 20 50 50 T 100 50" fill="none" stroke="currentColor" strokeWidth="2" className={color} />
                        </svg>
                      </div>

                      {/* Rank badge instead of icon */}
                      <div
                        className={`w-14 h-14 rounded-full flex items-center justify-center border-2 border-white/10 shadow-lg bg-black/40 font-black text-xl ${
                          idx === 0 ? "text-yellow-400" : idx === 1 ? "text-gray-300" : "text-orange-400"
                        }`}
                      >
                        #{idx + 1}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <h4 className="font-display font-bold text-base text-white">{sq.name}</h4>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                sq.matchScore >= 80
                                  ? "bg-green-500/20 text-green-300 border border-green-500/30"
                                  : sq.matchScore >= 60
                                  ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30"
                                  : "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                              }`}
                            >
                              {sq.matchScore}% match
                            </span>
                          </div>
                          <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-white/50 transition-colors" />
                        </div>
                        <p className="text-xs text-white/50 line-clamp-1 mb-1">{sq.vibe}</p>
                        <p className="text-xs text-violet-200/50 italic mb-2">"{sq.reason}"</p>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-1.5 text-[10px] text-white/40">
                            <Users className="w-3 h-3" />
                            <span>{sq.member_count || 0}/{sq.max_members} members</span>
                          </div>
                          {(sq.member_count || 0) > 0 && (
                            <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/80">
                              <span className="w-1 h-1 rounded-full bg-current" />
                              <span>{sq.member_count} online</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => handleJoinSquad(sq.id)}
                        disabled={joiningId === sq.id}
                        className="px-8 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 border border-white/10 rounded-xl text-xs font-bold transition-all text-white shadow-lg shadow-purple-500/20 disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {joiningId === sq.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <UserPlus className="w-3.5 h-3.5" />
                        )}
                        Join
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            </motion.section>
          )}

          {/* ── Browse All Squads ── */}
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-purple-400" />
                <h3 className="font-display font-semibold text-xl text-white">Browse All Squads</h3>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search squads..."
                  className="bg-white/5 border border-white/10 rounded-xl py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-purple-500/50 transition-all w-64"
                />
              </div>
            </div>

            {/* Filters */}
            <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
              {categories.map((filter) => (
                <button
                  key={filter}
                  onClick={() => setSelectedCategory(filter)}
                  className={`px-4 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                    selectedCategory === filter
                      ? "bg-purple-500 text-white shadow-lg shadow-purple-500/20"
                      : "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>

            {/* Squad Cards */}
            {loadingSquads ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
              </div>
            ) : filteredSquads.length === 0 ? (
              <div className="text-center py-16">
                <Users className="w-12 h-12 text-purple-500/30 mx-auto mb-3" />
                <p className="text-white/40 text-sm">No squads found</p>
              </div>
            ) : (
              <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                {filteredSquads.map((sq) => {
                  const { icon: SqIcon, color } = getSquadVisual(sq.vibe);
                  return (
                    <motion.div
                      key={sq.id}
                      whileHover={{ x: 4 }}
                      className="group relative flex items-center gap-6 p-5 glass-card hover:bg-white/10 transition-all cursor-pointer overflow-hidden"
                      onClick={() => handleJoinSquad(sq.id)}
                    >
                      {/* Background waveform */}
                      <div className="absolute right-0 top-0 h-full w-1/3 opacity-10 pointer-events-none">
                        <svg viewBox="0 0 100 100" className="h-full w-full">
                          <path d="M0 50 Q 25 20 50 50 T 100 50" fill="none" stroke="currentColor" strokeWidth="2" className={color} />
                        </svg>
                      </div>

                      <div className={`w-14 h-14 rounded-full flex items-center justify-center border-2 border-white/10 shadow-lg ${color} bg-black/40`}>
                        <SqIcon className="w-6 h-6" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h4 className="font-display font-bold text-base text-white">{sq.name}</h4>
                          <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-white/50 transition-colors" />
                        </div>
                        <p className="text-xs text-white/50 line-clamp-1 mb-3">{sq.vibe}</p>

                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-1.5 text-[10px] text-white/40">
                            <Users className="w-3 h-3" />
                            <span>{sq.member_count || 0}/{sq.max_members} members</span>
                          </div>
                          {(sq.member_count || 0) > 0 && (
                            <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/80">
                              <span className="w-1 h-1 rounded-full bg-current" />
                              <span>{sq.member_count} online</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleJoinSquad(sq.id);
                        }}
                        disabled={joiningId === sq.id || (sq.member_count || 0) >= sq.max_members}
                        className="px-8 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold transition-all text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                      >
                        {joiningId === sq.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (sq.member_count || 0) >= sq.max_members ? (
                          "Full"
                        ) : (
                          "Join"
                        )}
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Decorative background blurs */}
      <div className="fixed top-0 right-0 w-[500px] h-[500px] bg-purple-600/10 blur-[120px] rounded-full -mr-64 -mt-64 pointer-events-none" />
      <div className="fixed bottom-0 left-0 w-[500px] h-[500px] bg-pink-600/10 blur-[120px] rounded-full -ml-64 -mb-64 pointer-events-none" />
    </div>
  );
}
