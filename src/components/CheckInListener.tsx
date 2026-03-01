import { useEffect, useState } from "react";
import { useCurrentAccount, useSignPersonalMessage, useSuiClient } from "@mysten/dapp-kit";
import { Camera } from "lucide-react";
import { supabase } from "../lib/supabase";

type PendingCheckIn = {
  id: string;
  ticket_id: string;
  owner_address: string;
  status: string;
};

type TicketMeta = {
  eventName: string;
  artist: string;
  seat: string;
};

export function CheckInListener() {
  const currentAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();

  const [pendingCheckIn, setPendingCheckIn] = useState<PendingCheckIn | null>(null);
  const [ticketMeta, setTicketMeta] = useState<TicketMeta | null>(null);
  const [isApproving, setIsApproving] = useState(false);

  // Fetch ticket details from chain so the modal shows event name / seat
  useEffect(() => {
    if (!pendingCheckIn) { setTicketMeta(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const obj = await suiClient.getObject({
          id: pendingCheckIn.ticket_id,
          options: { showContent: true },
        });
        const fields: any = (obj.data as any)?.content?.fields || {};
        if (!cancelled) {
          setTicketMeta({
            eventName: fields.event_name || pendingCheckIn.ticket_id.slice(0, 16) + "…",
            artist: fields.artist || "",
            seat: fields.seat || "",
          });
        }
      } catch {
        if (!cancelled) {
          setTicketMeta({
            eventName: pendingCheckIn.ticket_id.slice(0, 16) + "…",
            artist: "",
            seat: "",
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [pendingCheckIn, suiClient]);

  // ── Realtime + polling subscription ──────────────────────────────────────
  useEffect(() => {
    if (!supabase || !currentAccount?.address) {
      console.warn("[CheckInListener] Supabase not ready or no account — skipping");
      return;
    }

    const address = currentAccount.address;
    console.log("[CheckInListener] subscribing for address", address);

    const channel = supabase
      .channel(`checkin_global:${address}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "check_in_requests" },
        (payload) => {
          console.log("[CheckInListener] realtime INSERT", payload.new);
          const row = payload.new as PendingCheckIn;
          if (row.owner_address === address && row.status === "pending") {
            setPendingCheckIn(row);
          }
        }
      )
      .subscribe((status) => {
        console.log("[CheckInListener] channel status:", status);
      });

    // Polling fallback every 5 s
    const pollInterval = setInterval(async () => {
      const { data } = await supabase!
        .from("check_in_requests")
        .select("*")
        .eq("owner_address", address)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!data) return;
      setPendingCheckIn((prev) => {
        if (prev?.id === data.id) return prev;
        console.log("[CheckInListener] poll found pending request", data);
        return data as PendingCheckIn;
      });
    }, 5000);

    return () => {
      clearInterval(pollInterval);
      supabase?.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAccount?.address]);

  const approveCheckIn = async () => {
    if (!pendingCheckIn || !currentAccount || !supabase) return;
    setIsApproving(true);
    try {
      const messageBytes = new TextEncoder().encode(pendingCheckIn.ticket_id);
      const { signature } = await signPersonalMessage({ message: messageBytes });
      await supabase
        .from("check_in_requests")
        .update({ status: "approved", signature })
        .eq("id", pendingCheckIn.id);
      setPendingCheckIn(null);
    } catch (e) {
      console.error("[CheckInListener] approve error", e);
    } finally {
      setIsApproving(false);
    }
  };

  const denyCheckIn = async () => {
    if (!pendingCheckIn || !supabase) return;
    await supabase
      .from("check_in_requests")
      .update({ status: "denied" })
      .eq("id", pendingCheckIn.id);
    setPendingCheckIn(null);
  };

  if (!pendingCheckIn) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "380px",
          borderRadius: "24px",
          border: "2px solid rgba(250,204,21,0.6)",
          background: "linear-gradient(to bottom, #3b0764, #1e1b4b)",
          boxShadow: "0 0 60px rgba(234,179,8,0.35), 0 25px 50px rgba(0,0,0,0.8)",
          padding: "32px 28px",
          textAlign: "center",
          color: "#fff",
        }}
      >
        {/* Icon */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "16px" }}>
          <div
            style={{
              padding: "12px",
              borderRadius: "50%",
              background: "rgba(250,204,21,0.1)",
              border: "2px solid rgba(250,204,21,0.4)",
              display: "inline-flex",
            }}
          >
            <Camera style={{ width: "32px", height: "32px", color: "#fde047" }} />
          </div>
        </div>

        <p style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase", color: "#facc15", marginBottom: "6px" }}>
          Gate Scanner Requesting
        </p>

        {ticketMeta ? (
          <>
            <h2 style={{ fontSize: "22px", fontWeight: 900, color: "#fff", marginBottom: "4px", lineHeight: 1.2 }}>
              {ticketMeta.eventName}
            </h2>
            {ticketMeta.artist && (
              <p style={{ fontSize: "14px", color: "#f9a8d4", marginBottom: "4px" }}>{ticketMeta.artist}</p>
            )}
            {ticketMeta.seat && (
              <p style={{ fontSize: "12px", color: "#9ca3af" }}>Seat: {ticketMeta.seat}</p>
            )}
          </>
        ) : (
          <div style={{ height: "48px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div className="w-5 h-5 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
          </div>
        )}

        <p style={{ marginTop: "16px", fontSize: "13px", color: "#d1d5db", lineHeight: 1.6 }}>
          A gate scanner wants to check you in. Sign with your wallet to confirm your identity.
        </p>

        <div style={{ marginTop: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <button
            onClick={approveCheckIn}
            disabled={isApproving}
            style={{
              width: "100%",
              borderRadius: "12px",
              background: isApproving ? "#065f46" : "linear-gradient(to right, #22c55e, #10b981)",
              color: "#fff",
              padding: "14px 20px",
              fontWeight: 700,
              fontSize: "15px",
              border: "none",
              cursor: isApproving ? "not-allowed" : "pointer",
              opacity: isApproving ? 0.7 : 1,
              boxShadow: "0 0 20px rgba(52,211,153,0.4)",
            }}
          >
            {isApproving ? "Signing…" : "✅ Approve & Sign"}
          </button>
          <button
            onClick={denyCheckIn}
            disabled={isApproving}
            style={{
              width: "100%",
              borderRadius: "12px",
              background: "rgba(127,29,29,0.3)",
              color: "#fca5a5",
              padding: "12px 20px",
              fontWeight: 700,
              fontSize: "13px",
              border: "2px solid rgba(239,68,68,0.5)",
              cursor: isApproving ? "not-allowed" : "pointer",
              opacity: isApproving ? 0.6 : 1,
            }}
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
