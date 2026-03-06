import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Copy,
  MapPin,
  DollarSign,
  CheckCircle2,
  Users,
} from "lucide-react";
import {
  KIOSK_OWNER_CAP_TYPE,
  LISTING_REGISTRY_ID,
  PACKAGE_ID,
  TICKET_LISTED_EVENT,
  TICKET_TYPE,
} from "../onechain/config";
import { useBuyTicket } from "../onechain/useBuyTicket";
import { useConcerts } from "../hooks/useConcerts";

type TicketFields = Record<string, any> & { objectId: string };

export default function MyTicketPage() {
  const currentAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const navigate = useNavigate();

  const storageKeyPublicListings = (address: string) => `tixone.publicListings.v1:${address}`;

  const parseMistU64 = (value: unknown): bigint | null => {
    try {
      if (value === null || value === undefined) return null;
      const parsed = BigInt(String(value));
      if (parsed < 0n) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const formatMistToOct2 = (value: unknown): string | null => {
    const mist = parseMistU64(value);
    if (mist === null) return null;

    const scaled = (mist * 100n) / 1_000_000_000n;
    const whole = scaled / 100n;
    const cents = scaled % 100n;
    return `${whole.toString()}.${cents.toString().padStart(2, "0")}`;
  };

  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();

  const [tickets, setTickets] = useState<TicketFields[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string>("");
  const [ticketIdExpanded, setTicketIdExpanded] = useState(false);
  const [copiedTicketId, setCopiedTicketId] = useState(false);
  const selectedTicket = useMemo(
    () => tickets.find((t) => t.objectId === selectedTicketId) || null,
    [tickets, selectedTicketId]
  );

  // Fetch all concerts from Supabase (falls back to static data if Supabase is unavailable)
  const { concerts: allConcerts } = useConcerts();

  const selectedConcert = useMemo(() => {
    if (!selectedTicket || allConcerts.length === 0) return null;

    const ticketArtist = String((selectedTicket as any).artist || "").trim();
    const ticketEventName = String((selectedTicket as any).event_name || "").trim();

    const byExact = allConcerts.find(
      (c) => c.artist === ticketArtist && c.title === ticketEventName
    );
    if (byExact) return byExact;

    const byIncludes = allConcerts.find(
      (c) =>
        c.artist === ticketArtist &&
        ticketEventName &&
        ticketEventName.toLowerCase().includes(c.title.toLowerCase())
    );
    if (byIncludes) return byIncludes;

    return allConcerts.find((c) => c.artist === ticketArtist) || null;
  }, [selectedTicket, allConcerts]);

  const [isLoading, setIsLoading] = useState(true);

  const [kioskId, setKioskId] = useState<string>("");
  const [kioskOwnerCapId, setKioskOwnerCapId] = useState<string>("");
  const [isCreatingKiosk, setIsCreatingKiosk] = useState(false);

  const [listingStatusByTicketId, setListingStatusByTicketId] = useState<
    Record<string, "none" | "public">
  >();

  // Smart-sell hook
  const { sellOrListTicket, isBuying: isSelling } = useBuyTicket();

  useEffect(() => {
    if (!currentAccount?.address) {
      setListingStatusByTicketId({});
      return;
    }

    try {
      const rawListed = window.localStorage.getItem(storageKeyPublicListings(currentAccount.address));
      if (rawListed) {
        const parsed = JSON.parse(rawListed) as unknown;
        if (parsed && typeof parsed === "object") {
          const next: Record<string, "none" | "public"> = {};
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof k !== "string") continue;
            if (v === "public" || v === "none") next[k] = v;
          }
          setListingStatusByTicketId(next);
        }
      }
    } catch (e) {
      console.warn("[MyTicket] failed to load listing status", e);
      setListingStatusByTicketId({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAccount?.address]);

  useEffect(() => {
    if (!currentAccount?.address) return;
    try {
      window.localStorage.setItem(
        storageKeyPublicListings(currentAccount.address),
        JSON.stringify(listingStatusByTicketId)
      );
    } catch (e) {
      console.warn("[MyTicket] failed to persist listing status", e);
    }
  }, [currentAccount?.address, listingStatusByTicketId]);

  useEffect(() => {
    setTicketIdExpanded(false);
    setCopiedTicketId(false);
  }, [selectedTicketId]);

  const selectedListingStatus = selectedTicket?.objectId
    ? listingStatusByTicketId?.[selectedTicket.objectId]
    : undefined;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!currentAccount?.address || !selectedTicket?.objectId || !kioskId) return;
      const ticketId = selectedTicket.objectId;

      // If we already know it's public-listed, keep UI stable.
      if (listingStatusByTicketId?.[ticketId] === "public") return;

      try {
        const dynamicFields = await suiClient.getDynamicFields({ parentId: kioskId, limit: 200 });
        const listingField = (dynamicFields.data || []).find((field: any) => {
          const isListingType = String(field?.name?.type || "").includes("0x2::kiosk::Listing");
          if (!isListingType) return false;
          const raw = field?.name?.value;
          const rawId = typeof raw === "string" ? raw : raw?.id;
          return rawId === ticketId;
        });

        if (listingField) {
          if (!cancelled) {
            setListingStatusByTicketId((prev) => {
              if (prev?.[ticketId] === "none") return prev;
              return { ...prev, [ticketId]: "none" };
            });
          }
          return;
        }

        // Listing exists in kiosk; check whether it was listed publicly (appears in marketplace events).
        const events = await suiClient.queryEvents({
          query: { MoveEventType: TICKET_LISTED_EVENT },
          limit: 100,
          order: "descending",
        });
        const isPublic = (events.data || []).some((ev: any) => {
          const json: any = ev?.parsedJson;
          return json?.ticket_id === ticketId;
        });

        if (!cancelled) {
          const nextStatus: "public" | "none" = isPublic ? "public" : "none";
          setListingStatusByTicketId((prev) => {
            if (prev?.[ticketId] === nextStatus) return prev;
            return { ...prev, [ticketId]: nextStatus };
          });
        }
      } catch (e) {
        console.warn("[MyTicket] listing status check failed", e);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [currentAccount?.address, kioskId, selectedListingStatus, selectedTicket?.objectId, suiClient]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!currentAccount) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const [ownedTickets, capObjects] = await Promise.all([
          suiClient.getOwnedObjects({
            owner: currentAccount.address,
            filter: { StructType: TICKET_TYPE },
            options: { showContent: true, showType: true },
          }),
          suiClient.getOwnedObjects({
            owner: currentAccount.address,
            filter: { StructType: KIOSK_OWNER_CAP_TYPE },
            options: { showContent: true, showType: true },
          }),
        ]);

        if (cancelled) return;

        const cap = capObjects.data?.[0];
        const capKioskId = ((cap?.data as any)?.content as any)?.fields?.for;
        const nextKioskOwnerCapId = cap?.data?.objectId && capKioskId ? cap.data.objectId : "";
        const nextKioskId = cap?.data?.objectId && capKioskId ? capKioskId : "";

        const ownedList: TicketFields[] =
          ownedTickets.data?.map((obj: any) => ({
            objectId: obj.data.objectId,
            ...(obj.data.content?.fields || {}),
          })) || [];

        let kioskList: TicketFields[] = [];
        if (nextKioskId) {
          try {
            const dynamicFields = await suiClient.getDynamicFields({
              parentId: nextKioskId,
              limit: 200,
            });

            const candidateIds = Array.from(
              new Set(
                (dynamicFields.data || [])
                  .filter((field: any) => {
                    const t = String(field?.name?.type || "");
                    // Items and Listings both key off the item object id in kiosk dynamic fields
                    return t.includes("0x2::kiosk::Item") || t.includes("0x2::kiosk::Listing");
                  })
                  .map((field: any) => {
                    const raw = field?.name?.value;
                    if (typeof raw === "string") return raw;
                    if (raw && typeof raw === "object" && typeof raw.id === "string") return raw.id;
                    return null;
                  })
                  .filter(Boolean)
              )
            ) as string[];

            const kioskObjects = await Promise.all(
              candidateIds.map((id) =>
                suiClient
                  .getObject({ id, options: { showContent: true, showType: true } })
                  .catch(() => null)
              )
            );

            kioskList = kioskObjects
              .filter((obj: any) => obj?.data?.type === TICKET_TYPE)
              .map((obj: any) => ({
                objectId: obj.data.objectId,
                ...(obj.data.content?.fields || {}),
              }));
          } catch (e) {
            console.warn("[MyTicket] kiosk inventory load error", e);
          }
        }

        const merged: TicketFields[] = [];
        const seen = new Set<string>();
        for (const t of ownedList) {
          if (!seen.has(t.objectId)) {
            merged.push(t);
            seen.add(t.objectId);
          }
        }
        for (const t of kioskList) {
          if (!seen.has(t.objectId)) {
            merged.push(t);
            seen.add(t.objectId);
          }
        }

        setTickets(merged);
        setSelectedTicketId((prev) => {
          if (prev && seen.has(prev)) return prev;
          return merged[0]?.objectId || "";
        });

        setKioskOwnerCapId(nextKioskOwnerCapId);
        setKioskId(nextKioskId);
      } catch (e) {
        console.error("[MyTicket] load error", e);
      } finally {
        setIsLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [currentAccount, suiClient]);

  // ── Derived: has this concert already happened? ──────────────────────────
  const isPastEvent = useMemo(() => {
    if (!selectedConcert?.date) return false;
    return new Date(selectedConcert.date) < new Date();
  }, [selectedConcert?.date]);

  const formatExpiration = (timestamp: string) => {
    const date = new Date(parseInt(timestamp));
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const qrData = useMemo(() => {
    if (!selectedTicket || !currentAccount) return "";
    return JSON.stringify({ ticketId: selectedTicket.objectId, owner: currentAccount.address });
  }, [selectedTicket, currentAccount]);

  const ticketIdDisplay = useMemo(() => {
    if (!selectedTicket?.objectId) return "";
    const id = selectedTicket.objectId;
    if (ticketIdExpanded) return id;
    if (id.length <= 18) return id;
    return `${id.slice(0, 10)}…${id.slice(-8)}`;
  }, [selectedTicket?.objectId, ticketIdExpanded]);

  const createKiosk = async () => {
    if (!currentAccount) return;
    setIsCreatingKiosk(true);
    try {
      const tx = new Transaction();
      tx.moveCall({ target: "0x2::kiosk::default", arguments: [] });
      await signAndExecuteTransaction({ transaction: tx });
      await new Promise((r) => setTimeout(r, 1000));
      const caps = await suiClient.getOwnedObjects({
        owner: currentAccount.address,
        filter: { StructType: KIOSK_OWNER_CAP_TYPE },
        options: { showContent: true, showType: true },
      });
      const cap = caps.data?.[0];
      const capKioskId = ((cap?.data as any)?.content as any)?.fields?.for;
      if (cap?.data?.objectId && capKioskId) {
        setKioskOwnerCapId(cap.data.objectId);
        setKioskId(capKioskId);
      }
      alert("✅ Kiosk created! Your shop is now open for business.");
    } catch (e) {
      console.error("[MyTicket] kiosk create error", e);
      alert("Failed to create kiosk");
    } finally {
      setIsCreatingKiosk(false);
    }
  };

  const requireKiosk = () => {
    if (!kioskId || !kioskOwnerCapId) {
      alert("Please create a Kiosk first (one-time).");
      return false;
    }
    return true;
  };

  const copyTicketId = async () => {
    if (!selectedTicket?.objectId) return;
    try {
      await navigator.clipboard.writeText(selectedTicket.objectId);
      setCopiedTicketId(true);
      window.setTimeout(() => setCopiedTicketId(false), 1400);
    } catch (e) {
      console.error("[MyTicket] copy ticket id error", e);
      alert(selectedTicket.objectId);
    }
  };

  /**
   * Smart Sell — one button:
   *  • Waitlist non-empty → ticket goes to first waiting buyer, OCT comes to seller.
   *  • Waitlist empty    → ticket is auto-listed in seller's Kiosk at face value.
   */
  const sellAtFaceValue = async () => {
    if (!currentAccount || !selectedTicket) return;
    if (!requireKiosk()) return;

    if (listingStatusByTicketId?.[selectedTicket.objectId] === "public") {
      alert("This ticket is already listed and cannot be sold again.");
      return;
    }

    // selectedConcert is already a SupabaseConcert fetched live from Supabase
    const concertObjectId = selectedConcert?.concert_object_id;
    const waitlistObjectId = selectedConcert?.waitlist_object_id;

    if (!concertObjectId) {
      alert("Concert is not yet linked on-chain. Please try again later.");
      return;
    }
    if (!waitlistObjectId) {
      alert("No waitlist is active for this concert.");
      return;
    }

    const confirmed = window.confirm(
      `Sell this ticket at face value (${formatMistToOct2(selectedTicket.original_price) ?? "?"} OCT)?\n\n` +
      `• If someone is in the waitlist → they get your ticket instantly and you receive OCT.\n` +
      `• If no one is waiting → your ticket is listed on the public marketplace.`
    );
    if (!confirmed) return;

    const digest = await sellOrListTicket(
      selectedTicket.objectId,
      concertObjectId,
      waitlistObjectId,
      kioskId,
      kioskOwnerCapId,
    );

    if (digest) {
      setListingStatusByTicketId((prev) => ({ ...prev, [selectedTicket.objectId]: "public" }));
      alert("✅ Done! Your ticket was sold or listed at face value.");
      navigate("/marketplace");
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background: Restored global neon gradient */}
      <div className="fixed inset-0 bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900 animate-lights -z-10" />

      {/* --- HEADER --- */}
      <header className="sticky top-0 z-40 border-b border-pink-500/50 bg-black/40 backdrop-blur-md neon-border">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-2 text-pink-300 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
            Back
          </Link>
          <h1 className="text-lg sm:text-xl font-bold text-white neon-text">Your Ticket</h1>
          <Link
            to="/my-waitlists"
            className="text-sm text-pink-300 hover:text-white transition-colors border border-pink-500/40 rounded-lg px-3 py-1.5"
          >
            My Waitlists
          </Link>
        </div>
      </header>

      {/* --- MAIN CONTENT --- */}
      <div className="max-w-[900px] mx-auto px-4 py-8 sm:py-10 relative z-10">
        
        {!currentAccount ? (
          <div className="rounded-3xl border border-pink-500/50 bg-purple-900/40 neon-border backdrop-blur-md p-7 sm:p-8 shadow-[0_0_30px_rgba(236,72,153,0.15)] text-center">
            <h2 className="text-2xl font-bold text-white mb-2 neon-text">Connect to view tickets</h2>
            <p className="text-pink-200 mb-6">Connect your wallet to see your on-chain tickets.</p>
            <ConnectButton className="w-full rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 border-none shadow-[0_0_15px_rgba(236,72,153,0.4)] text-white py-3 px-6 hover:from-pink-500 hover:to-purple-500 transition-colors font-bold" />
          </div>
        ) : isLoading ? (
          <div className="text-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pink-500 mx-auto mb-4"></div>
            <p className="text-pink-200">Loading your tickets…</p>
          </div>
        ) : (
          <>
            {tickets.length === 0 ? (
              <div className="rounded-3xl border border-pink-500/50 bg-purple-900/40 neon-border backdrop-blur-md p-7 sm:p-8 shadow-[0_0_30px_rgba(236,72,153,0.15)] text-center">
                <h2 className="text-2xl font-bold text-white mb-2 neon-text">No tickets found</h2>
                <p className="text-pink-200 mb-6">You don't own any tickets yet.</p>
                <button onClick={() => navigate("/")} className="w-full rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 border-none shadow-[0_0_15px_rgba(236,72,153,0.4)] text-white py-3 px-6 hover:from-pink-500 hover:to-purple-500 transition-colors font-bold">
                  Buy a Ticket
                </button>
              </div>
            ) : (
              <>
                {/* --- THE ORIGINAL TICKET SELECTOR --- */}
            {tickets.length > 1 && (
              <div className="rounded-2xl border border-pink-500/30 bg-purple-900/40 backdrop-blur-md p-4 shadow-2xl">
                <label className="block text-xs font-bold uppercase tracking-wider text-pink-400 mb-2">Select Ticket</label>
                <select 
                  className="w-full rounded-xl bg-[#0a051e] border border-pink-500/50 text-white p-3 outline-none focus:border-pink-400 font-semibold"
                  value={selectedTicketId}
                  onChange={(e) => setSelectedTicketId(e.target.value)}
                >
                  {tickets.map((t, index) => (
                    <option key={t.objectId} value={t.objectId} className="bg-[#0a051e] text-purple-300">
                      Ticket #{index + 1} - {t.event_name || "Event"}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* --- THE UPGRADED REALISTIC TICKET CARD --- */}
            {selectedTicket && (
              <div className="w-full rounded-3xl border border-pink-500/40 bg-purple-950/60 backdrop-blur-md shadow-[0_0_50px_rgba(236,72,153,0.15)] overflow-hidden">
                
                {/* 1. EVENT HEADER (Professional) */}
                <div className="relative flex flex-col justify-center text-center overflow-hidden bg-gradient-to-br from-[#1a0533] via-[#2d0a5e] to-[#0f0c3d]">
                  {/* Top accent bar */}
                  <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-pink-500 via-purple-400 to-pink-500" />
                  {/* Subtle radial glow */}
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(168,85,247,0.18)_0%,transparent_70%)]" />
                  {/* Decorative corner lines */}
                  <div className="absolute top-4 left-4 w-10 h-10 border-t-2 border-l-2 border-pink-500/40 rounded-tl-lg" />
                  <div className="absolute top-4 right-4 w-10 h-10 border-t-2 border-r-2 border-pink-500/40 rounded-tr-lg" />
                  <div className="absolute bottom-4 left-4 w-10 h-10 border-b-2 border-l-2 border-pink-500/40 rounded-bl-lg" />
                  <div className="absolute bottom-4 right-4 w-10 h-10 border-b-2 border-r-2 border-pink-500/40 rounded-br-lg" />

                  <div className="relative z-10 px-10 py-10">
                    <div className="flex items-center justify-center gap-3 mb-3">
                      <div className="text-xs font-bold tracking-[0.3em] uppercase text-pink-400">Official Event Ticket</div>
                      {isPastEvent && (
                        <span style={{ fontSize: "0.65rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" as const, background: "linear-gradient(135deg, #7f1d1d, #991b1b)", border: "1px solid rgba(239,68,68,0.6)", color: "#fca5a5", borderRadius: "999px", padding: "3px 10px", whiteSpace: "nowrap" as const }}>
                          Past Event
                        </span>
                      )}
                    </div>
                    <h2 className="text-3xl sm:text-4xl font-black text-white leading-tight tracking-wide">
                      {selectedConcert?.title || selectedTicket.event_name}
                    </h2>
                    <div className="mt-3 flex items-center justify-center gap-3">
                      <div className="h-px w-12 bg-gradient-to-r from-transparent to-pink-500/60" />
                      <p className="text-sm sm:text-base font-bold tracking-[0.2em] uppercase text-pink-300">
                        {selectedConcert?.artist || selectedTicket.artist}
                      </p>
                      <div className="h-px w-12 bg-gradient-to-l from-transparent to-pink-500/60" />
                    </div>
                  </div>
                  {/* Bottom accent bar */}
                  <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-pink-500/50 to-transparent" />
                </div>

                {/* 2. TICKET BODY */}
                <div className="p-5 sm:p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 items-start gap-5 sm:gap-6">
                    {/* Left Column: QR */}
                    <div className="self-start rounded-2xl border border-pink-500/20 bg-white shadow-[0_0_30px_rgba(236,72,153,0.3)] w-fit mx-auto leading-[0]">
                      {qrData ? (
                        <QRCodeSVG
                          value={qrData}
                          size={470}
                          level="M"
                          includeMargin={true}
                          bgColor="#FFFFFF"
                          fgColor="#0B0B0F"
                        />
                      ) : null}
                    </div>

                    {/* Right Column: Details */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Block A: Seat */}
                      <div className="rounded-2xl border border-pink-500/20 bg-purple-950/50 backdrop-blur-md p-5 shadow-xl">
                        <div className="text-sm sm:text-base font-bold uppercase tracking-wider text-pink-400 mb-3">Seat Info</div>
                        <div className="text-2xl sm:text-3xl font-bold text-white drop-shadow-md leading-tight">
                          {selectedTicket.seat || "General Admission"}
                        </div>
                        <div className="mt-1 text-sm text-gray-300 font-medium">Standing / Open Floor</div>
                      </div>

                      {/* Block B: Date & Time */}
                      <div className="rounded-2xl border border-pink-500/20 bg-purple-950/50 backdrop-blur-md p-5 shadow-xl">
                        <div className="flex items-center gap-2 text-sm sm:text-base font-bold uppercase tracking-wider text-pink-400 mb-3">
                          <Calendar className="w-4 h-4 text-pink-400" />
                          Date & Time
                        </div>
                        <div className="text-base sm:text-lg font-bold text-white drop-shadow-md">
                          {selectedConcert?.date || "TBA"}
                          <span className="text-gray-400 mx-2">•</span>
                          <span className="inline-flex items-center gap-1.5">
                            <Clock className="w-4 h-4 text-pink-400" />
                            {selectedConcert?.time || "TBA"}
                          </span>
                        </div>
                      </div>

                      {/* Block C: Venue */}
                      <div className="rounded-2xl border border-pink-500/20 bg-purple-950/50 backdrop-blur-md p-5 shadow-xl">
                        <div className="flex items-center gap-2 text-sm sm:text-base font-bold uppercase tracking-wider text-pink-400 mb-3">
                          <MapPin className="w-4 h-4 text-pink-400" />
                          Venue
                        </div>
                        <div className="text-base sm:text-lg font-bold text-white drop-shadow-md">
                          {selectedConcert?.venue || "TBA"}
                        </div>
                        <div className="mt-1 text-sm text-gray-300 font-medium">{selectedConcert?.location || ""}</div>
                      </div>

                      {/* Block D: Price */}
                      <div className="rounded-2xl border border-pink-500/20 bg-purple-950/50 backdrop-blur-md p-5 shadow-xl">
                        <div className="text-sm sm:text-base font-bold uppercase tracking-wider text-pink-400 mb-3">Paid</div>
                        <div className="text-2xl font-bold text-white drop-shadow-md">
                          {formatMistToOct2(selectedTicket.original_price) ?? "—"} <span className="text-pink-300 text-sm ml-1">OCT</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 3. VERIFICATION SECTION */}
                  <div className="mt-14 rounded-2xl border border-pink-500/20 bg-purple-950/50 backdrop-blur-md p-5 shadow-xl">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-bold text-white drop-shadow-md">Verified on Chain</div>
                        <div className="mt-1 text-sm text-gray-300">Network: OneChain Testnet</div>
                      </div>
                      <div className="inline-flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1.5">
                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                        <span className="text-sm font-bold text-green-400">Verified</span>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="text-xs font-bold uppercase tracking-wider text-pink-400 mb-2">Ticket ID</div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setTicketIdExpanded((v) => !v)}
                          className="flex-1 rounded-xl border border-pink-500/30 bg-black/40 px-3 py-2 text-left font-mono text-sm text-pink-200 hover:bg-black/60 transition-colors"
                          title={ticketIdExpanded ? "Click to collapse" : "Click to expand"}
                        >
                          {ticketIdDisplay}
                        </button>
                        <button
                          type="button"
                          onClick={copyTicketId}
                          className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-pink-500/50 bg-pink-600/20 px-3 py-2 text-sm font-bold text-pink-300 hover:bg-pink-600/40 transition-colors"
                          title="Copy Ticket ID"
                        >
                          <Copy className="w-4 h-4" />
                          {copiedTicketId ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 4. SQUAD ROOM */}
                  <div className="mt-14 rounded-2xl border border-pink-500/20 bg-purple-950/50 backdrop-blur-md p-5 shadow-xl">
                    <div className="text-sm font-bold text-white drop-shadow-md">Squad Room</div>
                    <div className="mt-1 text-sm text-gray-300">
                      Let AI match you with fans who share your concert vibe. Join or create a private Discord squad room.
                    </div>
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() => navigate("/squad-lobby", { state: { ticketId: selectedTicket?.objectId, concertName: selectedConcert?.title, concertId: selectedConcert?.id } })}
                        className="w-full rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 border-none text-white py-3 px-5 hover:from-pink-500 hover:to-purple-500 transition-colors font-bold shadow-[0_0_15px_rgba(236,72,153,0.4)] flex items-center justify-center gap-2"
                      >
                        <Users className="w-5 h-5" />
                        Find Your Squad
                      </button>
                    </div>
                  </div>

                  {/* 5. RESALE ACTIONS */}
                  {isPastEvent ? (
                    <div className="mt-14 rounded-2xl border border-red-900/30 bg-red-950/20 backdrop-blur-md p-5 shadow-xl text-center">
                      <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#f87171", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "8px" }}>
                        Event Has Ended
                      </div>
                      <div className="text-sm text-gray-400">This concert has passed. Resale is no longer available.</div>
                    </div>
                  ) : (
                    <div className="mt-14 rounded-2xl border border-pink-500/20 bg-purple-950/50 backdrop-blur-md p-5 shadow-xl">
                      <div className="text-sm font-bold text-white drop-shadow-md">Resale Options</div>
                      <div className="mt-1 text-sm text-gray-300">
                        TiX-One enforces strict face-value resale with a price cap.
                      </div>

                      {!kioskId ? (
                      <div className="mt-4">
                        <button
                          onClick={createKiosk}
                          disabled={isCreatingKiosk}
                          className="w-full rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 border-none text-white py-3 px-5 hover:from-pink-500 hover:to-purple-500 transition-colors font-bold shadow-[0_0_15px_rgba(236,72,153,0.4)] disabled:opacity-60 disabled:cursor-not-allowed"
                          title="Required to enable resale actions"
                        >
                          {isCreatingKiosk ? "Setting up…" : "Set Up Resale Shop"}
                        </button>
                      </div>
                    ) : (
                      <div className="mt-4">
                        {listingStatusByTicketId?.[selectedTicket.objectId] === "public" ? (
                          <button
                            disabled
                            className="w-full rounded-xl border border-green-500/40 bg-green-500/10 text-green-300 py-3 px-5 font-bold cursor-not-allowed"
                          >
                            <div className="flex items-center justify-center gap-2">
                              <CheckCircle2 className="w-4 h-4 text-green-400" />
                              Sold / Listed
                            </div>
                            <div className="mt-1 text-xs text-green-300/80 font-medium">Transaction complete</div>
                          </button>
                        ) : (
                          <button
                            onClick={sellAtFaceValue}
                            disabled={isSelling || !selectedConcert?.waitlist_object_id || !selectedConcert?.concert_object_id}
                            className="w-full rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 border-none text-white py-4 px-5 hover:from-pink-500 hover:to-purple-500 transition-colors font-bold shadow-[0_0_20px_rgba(236,72,153,0.5)] disabled:opacity-60 disabled:cursor-not-allowed"
                            title="Sell at face value — goes to waitlist buyer first, or listed on marketplace if queue is empty"
                          >
                            <div className="flex items-center justify-center gap-2 text-base">
                              <DollarSign className="w-5 h-5" />
                              {isSelling ? "Processing…" : "Sell at Face Value"}
                            </div>
                            <div className="mt-1 text-xs text-pink-200 font-medium">
                              {selectedConcert?.waitlist_object_id
                                ? "Priority to waitlist buyers · Falls back to marketplace"
                                : "Loading concert data…"}
                            </div>
                          </button>
                        )}
                      </div>
                    )}

                    </div>
                  )}
                </div>
              </div>
            )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}