import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router";
import { useCurrentAccount } from "@mysten/dapp-kit";
import {
  ArrowLeft,
  Hash,
  Loader2,
  LogOut,
  Paperclip,
  Star,
  Users,
  Phone,
  Video,
  Smile,
} from "lucide-react";
import { supabase } from "../lib/supabase";

/* ─── Types ─── */
interface Member {
  id: string;
  wallet: string;
  bio: string;
}

interface Message {
  id: string;
  sender: string;
  content: string;
  created_at: string;
}

interface SquadInfo {
  id: string;
  name: string;
  vibe: string;
  concert_id: string;
  max_members: number;
}

/* ─── Page ─── */
export default function SquadRoom() {
  const { squadId } = useParams<{ squadId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const currentAccount = useCurrentAccount();
  const walletAddress = currentAccount?.address || "";

  const [squad, setSquad] = useState<SquadInfo | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  /* ── Fetch squad data ── */
  useEffect(() => {
    if (!squadId || !supabase) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const { data: squadData } = await supabase
          .from("squads")
          .select("*")
          .eq("id", squadId)
          .single();
        if (squadData) setSquad(squadData);

        const { data: membersData } = await supabase
          .from("squad_members")
          .select("*")
          .eq("squad_id", squadId)
          .order("joined_at", { ascending: true });
        if (membersData) setMembers(membersData);

        const { data: messagesData } = await supabase
          .from("squad_messages")
          .select("*")
          .eq("squad_id", squadId)
          .order("created_at", { ascending: true });
        if (messagesData) setMessages(messagesData);
      } catch (err) {
        console.error("Failed to load squad room:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    const channel = supabase
      .channel(`squad-${squadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "squad_messages", filter: `squad_id=eq.${squadId}` },
        (payload: any) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            if (prev.find((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "squad_members", filter: `squad_id=eq.${squadId}` },
        () => {
          supabase
            .from("squad_members")
            .select("*")
            .eq("squad_id", squadId)
            .order("joined_at", { ascending: true })
            .then(({ data }) => {
              if (data) setMembers(data);
            });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [squadId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  /* ── Handlers ── */
  const handleSend = async () => {
    if (!newMessage.trim() || !supabase || !squadId || !walletAddress) return;
    setSending(true);
    const text = newMessage.trim();
    setNewMessage("");
    try {
      const { data, error } = await supabase
        .from("squad_messages")
        .insert({ squad_id: squadId, sender: walletAddress, content: text })
        .select()
        .single();
      if (error) throw error;
      // Add optimistically — realtime deduplication will skip if subscription also fires
      if (data) {
        setMessages((prev) =>
          prev.find((m) => m.id === data.id) ? prev : [...prev, data as Message]
        );
      }
    } catch (err) {
      console.error("Send error:", err);
      setNewMessage(text); // restore on failure
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleLeave = async () => {
    if (!supabase || !squadId || !walletAddress) return;
    if (!window.confirm("Are you sure you want to leave this squad?")) return;
    setLeaving(true);
    try {
      await supabase.from("squad_members").delete().eq("squad_id", squadId).eq("wallet", walletAddress);
      navigate(-1);
    } catch (err) {
      console.error("Leave error:", err);
      alert("Failed to leave squad");
    } finally {
      setLeaving(false);
    }
  };

  /* ── Helpers ── */
  const shortenWallet = (w: string) => (w.length > 12 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w);

  const formatTime = (ts: string) => {
    return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  };

  const formatDate = (ts: string) => {
    const d = new Date(ts);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "Today";
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const getAvatarColor = (wallet: string) => {
    const gradients = [
      "linear-gradient(135deg, #8b5cf6, #4f46e5)", // violet-indigo
      "linear-gradient(135deg, #ec4899, #e11d48)", // pink-rose
      "linear-gradient(135deg, #10b981, #0d9488)", // emerald-teal
      "linear-gradient(135deg, #f59e0b, #ea580c)", // amber-orange
      "linear-gradient(135deg, #06b6d4, #2563eb)", // cyan-blue
    ];
    let hash = 0;
    for (let i = 0; i < wallet.length; i++) {
      hash = wallet.charCodeAt(i) + ((hash << 5) - hash);
    }
    return gradients[Math.abs(hash) % gradients.length];
  };

  const groupedMessages = messages.reduce<{ date: string; msgs: Message[] }[]>((acc, msg) => {
    const dateStr = formatDate(msg.created_at);
    const lastGroup = acc[acc.length - 1];
    if (lastGroup && lastGroup.date === dateStr) {
      lastGroup.msgs.push(msg);
    } else {
      acc.push({ date: dateStr, msgs: [msg] });
    }
    return acc;
  }, []);

  const groupBySender = (msgs: Message[]) => {
    const groups: { sender: string; messages: Message[] }[] = [];
    for (const msg of msgs) {
      const last = groups[groups.length - 1];
      if (last && last.sender === msg.sender) {
        last.messages.push(msg);
      } else {
        groups.push({ sender: msg.sender, messages: [msg] });
      }
    }
    return groups;
  };

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", backgroundColor: "#0d0a1a" }}>
        <Loader2 className="w-10 h-10 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "row", height: "100vh", overflow: "hidden", backgroundColor: "#0d0a1a", color: "white", fontFamily: "sans-serif" }}>
      
      {/* ═══ LEFT SIDEBAR ═══ */}
      <div className="hidden md:flex" style={{ display: "flex", flexDirection: "column", width: "280px", flexShrink: 0, backgroundColor: "#130f2a", borderRight: "1px solid rgba(255,255,255,0.05)" }}>
        
        {/* Top Avatars */}
        <div style={{ padding: "16px", paddingBottom: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
            <Users size={16} color="rgba(168, 85, 247, 0.5)" />
            <div style={{ display: "flex", marginLeft: "4px" }}>
              {members.slice(0, 4).map((m, i) => (
                <div key={m.id} style={{ width: "28px", height: "28px", borderRadius: "50%", background: getAvatarColor(m.wallet), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: "bold", border: "2px solid #130f2a", marginLeft: i > 0 ? "-8px" : "0" }}>
                  {m.wallet.slice(2, 4).toUpperCase()}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Members List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 12px" }}>
          <div style={{ fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "1px", color: "rgba(168, 85, 247, 0.4)", marginBottom: "8px", paddingLeft: "4px" }}>
            Members — {members.length}/{squad?.max_members || 5}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {members.map((m) => (
              <div key={m.id} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "10px", padding: "8px", borderRadius: "8px", cursor: "pointer" }} onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(168, 85, 247, 0.1)")} onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}>
                <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: getAvatarColor(m.wallet), flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: "bold" }}>
                  {m.wallet.slice(2, 4).toUpperCase()}
                </div>
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <div style={{ fontSize: "12px", fontWeight: "500", color: "rgba(255,255,255,0.8)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {shortenWallet(m.wallet)} {m.wallet === walletAddress && <span style={{ color: "#a855f7", fontSize: "10px" }}>(you)</span>}
                  </div>
                  {m.bio && (
                    <div style={{ fontSize: "11px", color: "rgba(168, 85, 247, 0.4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.bio}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Leave Button */}
        <div style={{ padding: "16px", borderTop: "1px solid rgba(168, 85, 247, 0.1)" }}>
          <button onClick={handleLeave} disabled={leaving} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "10px", borderRadius: "8px", color: "rgba(248, 113, 113, 0.8)", backgroundColor: "rgba(248, 113, 113, 0.05)", border: "none", cursor: "pointer", fontSize: "13px", fontWeight: "500" }}>
            {leaving ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
            {leaving ? "Leaving…" : "Leave Squad"}
          </button>
        </div>
      </div>

      {/* ═══ CHAT PANEL ═══ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, backgroundColor: "#0d0a1a" }}>
        
        {/* Header */}
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: "64px", flexShrink: 0, padding: "0 24px", backgroundColor: "#13102b", borderBottom: "1px solid rgba(168, 85, 247, 0.1)" }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "12px" }}>
            <button onClick={() => navigate(-1)} style={{ background: "none", border: "none", color: "rgba(168, 85, 247, 0.6)", cursor: "pointer" }}>
              <ArrowLeft size={18} />
            </button>
            <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "linear-gradient(135deg, #8b5cf6, #4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: "bold" }}>
              {squad?.name?.charAt(0) || "S"}
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "15px", fontWeight: "600" }}>{squad?.name || "Squad Chat"}</span>
              <span style={{ fontSize: "11px", color: "#4ade80" }}>{members.length} online</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: "16px", color: "rgba(168, 85, 247, 0.5)" }}>
            <Video size={18} style={{ cursor: "pointer" }} />
            <Phone size={18} style={{ cursor: "pointer" }} />
          </div>
        </div>

        {/* Messages Container */}
        <div ref={chatContainerRef} style={{ flex: 1, overflowY: "auto", padding: "24px", display: "flex", flexDirection: "column" }}>
          {messages.length === 0 ? (
            <div style={{ margin: "auto", textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
              <Hash size={48} style={{ margin: "0 auto 16px", opacity: 0.2 }} />
              <h3>Welcome to #{squad?.name || "Squad Chat"}</h3>
              <p style={{ fontSize: "12px" }}>Say hello to your squad mates!</p>
            </div>
          ) : (
            groupedMessages.map((group) => (
              <div key={group.date} style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ textAlign: "center", margin: "24px 0" }}>
                  <span style={{ fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", backgroundColor: "rgba(26, 21, 48, 0.8)", padding: "4px 12px", borderRadius: "12px", color: "rgba(168, 85, 247, 0.5)" }}>
                    {group.date}
                  </span>
                </div>

                {groupBySender(group.msgs).map((senderGroup, gIdx) => {
                  const isMe = senderGroup.sender === walletAddress;
                  const firstMsg = senderGroup.messages[0];

                  return (
                    <div key={`${senderGroup.sender}-${gIdx}`} style={{ display: "flex", flexDirection: isMe ? "row-reverse" : "row", gap: "12px", marginBottom: "16px", width: "100%" }}>
                      
                      <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: getAvatarColor(senderGroup.sender), flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "bold", marginTop: "4px" }}>
                        {senderGroup.sender.slice(2, 4).toUpperCase()}
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", maxWidth: "75%", alignItems: isMe ? "flex-end" : "flex-start" }}>
                        <div style={{ display: "flex", flexDirection: isMe ? "row-reverse" : "row", alignItems: "baseline", gap: "8px", marginBottom: "4px" }}>
                          <span style={{ fontSize: "12px", fontWeight: "600", color: "rgba(255,255,255,0.8)" }}>{shortenWallet(senderGroup.sender)}</span>
                          <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)" }}>{formatTime(firstMsg.created_at)}</span>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: isMe ? "flex-end" : "flex-start" }}>
                          {senderGroup.messages.map((msg, mIdx) => (
                            <div key={msg.id} style={{ padding: "10px 14px", backgroundColor: isMe ? "rgba(139, 92, 246, 0.2)" : "rgba(30, 22, 64, 0.9)", border: isMe ? "1px solid rgba(139, 92, 246, 0.3)" : "1px solid rgba(255,255,255,0.05)", borderRadius: "16px", borderTopLeftRadius: isMe || mIdx > 0 ? "16px" : "4px", borderTopRightRadius: !isMe || mIdx > 0 ? "16px" : "4px", fontSize: "14px", color: "#f8fafc", wordBreak: "break-word", whiteSpace: "pre-wrap", lineHeight: "1.5" }}>
                              {msg.content}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Field */}
        <div style={{ flexShrink: 0, padding: "16px 24px", backgroundColor: "#0d0a1a" }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", backgroundColor: "rgba(21, 16, 48, 0.6)", border: "1px solid rgba(168, 85, 247, 0.2)", borderRadius: "16px", padding: "8px 16px", gap: "12px" }}>
            <textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Send a message..."
              rows={1}
              style={{ flex: 1, backgroundColor: "transparent", border: "none", outline: "none", color: "white", fontSize: "14px", resize: "none", padding: "6px 0", minHeight: "24px", maxHeight: "120px" }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = Math.min(target.scrollHeight, 120) + "px";
              }}
            />
            <div style={{ display: "flex", flexDirection: "row", gap: "8px", paddingBottom: "4px", flexShrink: 0 }}>
              <button style={{ background: "none", border: "none", color: "rgba(168, 85, 247, 0.4)", cursor: "pointer" }}><Paperclip size={18} /></button>
              <button style={{ background: "none", border: "none", color: "rgba(168, 85, 247, 0.4)", cursor: "pointer" }}><Smile size={18} /></button>
              <button onClick={handleSend} disabled={sending || !newMessage.trim()} style={{ background: "none", border: "none", color: sending || !newMessage.trim() ? "rgba(168, 85, 247, 0.2)" : "#a855f7", cursor: sending || !newMessage.trim() ? "not-allowed" : "pointer", marginLeft: "4px" }}>
                {sending ? <Loader2 size={18} className="animate-spin" /> : <Star size={18} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}