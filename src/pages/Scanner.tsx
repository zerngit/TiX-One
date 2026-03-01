import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Html5Qrcode } from "html5-qrcode";
import { Transaction } from "@mysten/sui/transactions";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { ArrowLeft, Camera } from "lucide-react";
import { PopBackground } from "../components/PopBackground";
import { ADMIN_CAP_ID, CLOCK_OBJECT_ID, PACKAGE_ID } from "../onechain/config";
import { supabase } from "../lib/supabase";

type TicketInfo = {
  eventName: string;
  seat: string;
  artist: string;
  owner?: string;
};

export default function ScannerPage() {
  const currentAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();
  const navigate = useNavigate();

  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const realtimeChannelRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<"granted" | "denied" | null>(null);
  const [ticketData, setTicketData] = useState<TicketInfo | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [waitingForApproval, setWaitingForApproval] = useState(false);
  const [error, setError] = useState<string>("");

  const [isOrganizer, setIsOrganizer] = useState(false);
  const [isOrganizerLoading, setIsOrganizerLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const checkOrganizer = async () => {
      if (!currentAccount?.address) {
        setIsOrganizer(false);
        return;
      }

      setIsOrganizerLoading(true);
      try {
        const adminCapObj = await suiClient.getObject({
          id: ADMIN_CAP_ID,
          options: { showOwner: true },
        });

        const owner = (adminCapObj as any)?.data?.owner?.AddressOwner;
        if (!cancelled) setIsOrganizer(owner === currentAccount.address);
      } catch {
        if (!cancelled) setIsOrganizer(false);
      } finally {
        if (!cancelled) setIsOrganizerLoading(false);
      }
    };

    checkOrganizer();
    return () => {
      cancelled = true;
    };
  }, [currentAccount?.address, suiClient]);

  const stopScanner = async () => {
    if (html5QrCodeRef.current) {
      try {
        await html5QrCodeRef.current.stop();
        html5QrCodeRef.current.clear();
      } catch (e) {
        console.error("[Scanner] stop error", e);
      }
    }
    setIsScanning(false);
  };

  const checkInTicket = async (ticketObjectId: string, ticketOwnerAddress: string) => {
    if (!currentAccount) throw new Error("Not connected");

    const tx = new Transaction();
    tx.setSender(currentAccount.address);
    tx.setGasBudget(100_000_000);
    tx.moveCall({
      target: `${PACKAGE_ID}::ticket::verify_and_check_in`,
      arguments: [
        tx.object(ADMIN_CAP_ID),
        tx.pure.id(ticketObjectId),
        tx.pure.address(ticketOwnerAddress),
        tx.object(CLOCK_OBJECT_ID),
      ],
    });

    const response = await signAndExecuteTransaction({ transaction: tx });
    const result = await suiClient.waitForTransaction({
      digest: response.digest,
      options: { showEffects: true },
    });

    if (result.effects?.status?.status !== "success") {
      throw new Error(
        `Check-in transaction failed: ${result.effects?.status?.error || "unknown error"}`
      );
    }
  };

  // Called after a successful QR scan. Inserts a pending check-in request
  // and waits for the user to approve it via Supabase Realtime.
  const handleScan = async (decodedText: string) => {
    if (!currentAccount) return;
    if (!supabase) {
      setError("Supabase not configured");
      setScanResult("denied");
      return;
    }

    let ticketId: string;
    let owner: string;
    try {
      const data = JSON.parse(decodedText);
      ticketId = data.ticketId ?? data.id; // support both old and new QR format
      owner = data.owner;
      if (!ticketId || !owner) throw new Error("missing fields");
    } catch {
      setError("Invalid QR code format");
      setScanResult("denied");
      return;
    }

    // Insert a pending request row
    console.log("[Scanner] inserting check_in_request for ticket", ticketId, "owner", owner);
    const { data: row, error: insertError } = await supabase
      .from("check_in_requests")
      .insert({ ticket_id: ticketId, owner_address: owner, status: "pending" })
      .select()
      .single();

    if (insertError || !row) {
      console.error("[Scanner] insert failed", insertError);
      setError("Failed to send check-in request: " + (insertError?.message ?? "unknown"));
      setScanResult("denied");
      return;
    }
    console.log("[Scanner] check_in_request inserted", row);

    setWaitingForApproval(true);

    // Timeout handle so we can cancel it if resolved early
    let timeoutId: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
      setWaitingForApproval(false);
    };

    const channel = supabase
      .channel(`checkin:${row.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "check_in_requests",
          filter: `id=eq.${row.id}`,
        },
        async (payload) => {
          const updated = payload.new as { status: string; signature: string | null };
          if (updated.status === "approved" && updated.signature) {
            cleanup();
            await verifyAndCheckIn(ticketId, owner, updated.signature);
          } else if (updated.status === "denied") {
            cleanup();
            setError("User denied the check-in request");
            setScanResult("denied");
          }
        }
      )
      .subscribe();

    realtimeChannelRef.current = channel;

    // Auto-expire after 2 minutes
    timeoutId = setTimeout(() => {
      cleanup();
      setError("Approval timed out — rescan the ticket");
      setScanResult("denied");
    }, 120_000);
  };

  // Verifies the user's signature then executes the on-chain check-in.
  const verifyAndCheckIn = async (ticketId: string, owner: string, signature: string) => {
    if (!currentAccount) return;
    setIsProcessing(true);
    setError("");
    try {
      // 1. Cryptographically verify the signature
      const publicKey = await verifyPersonalMessageSignature(
        new TextEncoder().encode(ticketId),
        signature
      );
      const signerAddress = publicKey.toSuiAddress();
      if (signerAddress !== owner) {
        setError("Signature address mismatch — possible ticket fraud");
        setScanResult("denied");
        return;
      }

      // 2. Fetch ticket object from chain
      const ticketObject = await suiClient.getObject({
        id: ticketId,
        options: { showContent: true, showOwner: true },
      });
      if (!ticketObject.data) {
        setError("Ticket not found on blockchain");
        setScanResult("denied");
        return;
      }

      const ticketOwner = (ticketObject.data as any).owner?.AddressOwner;
      if (ticketOwner !== owner) {
        setError("Ticket owner mismatch");
        setScanResult("denied");
        return;
      }

      const content: any = (ticketObject.data as any).content?.fields || {};

      // 3. Check expiry
      const currentTime = Date.now();
      const expiresAt = parseInt(content.expires_at);
      if (currentTime >= expiresAt) {
        setError("This ticket has expired");
        setScanResult("denied");
        setTicketData({ eventName: content.event_name, seat: content.seat, artist: content.artist });
        return;
      }

      // 4. Check already checked in
      const checkInRecords = await suiClient.getOwnedObjects({
        owner: currentAccount.address,
        filter: { StructType: `${PACKAGE_ID}::ticket::CheckInRecord` },
        options: { showContent: true },
      });
      const alreadyCheckedIn = checkInRecords.data?.some((record: any) => {
        const fields = record.data?.content?.fields;
        return fields?.ticket_id === ticketId;
      });
      if (alreadyCheckedIn) {
        setError("This ticket has already been scanned");
        setScanResult("denied");
        setTicketData({ eventName: content.event_name, seat: content.seat, artist: content.artist });
        return;
      }

      // 5. Execute on-chain check-in
      await checkInTicket(ticketId, owner);
      setScanResult("granted");
      setTicketData({
        eventName: content.event_name,
        seat: content.seat,
        artist: content.artist,
        owner: ticketOwner,
      });
    } catch (e: any) {
      console.error("[Scanner] verify error", e);
      setError(e?.message || "Verification failed");
      setScanResult("denied");
    } finally {
      setIsProcessing(false);
    }
  };

  const startScanner = async () => {
    if (!currentAccount) {
      setError("Please connect your wallet first");
      return;
    }

    if (!isOrganizer) {
      setError("Organizer-only: this wallet is not authorized to scan tickets");
      return;
    }

    setIsScanning(true);
    setError("");
    setScanResult(null);
    setTicketData(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());

      const html5QrCode = new Html5Qrcode("qr-reader");
      html5QrCodeRef.current = html5QrCode;

      const viewportMin = Math.min(window.innerWidth, window.innerHeight);
      const qrSize = Math.floor(viewportMin * 0.8);

      await html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: qrSize, height: qrSize }, aspectRatio: 1.7777778 },
        async (decodedText) => {
          await stopScanner();
          await handleScan(decodedText);
        },
        (errorMessage) => {
          if (!errorMessage.includes("No MultiFormat Readers")) {
            // noisy; ignore
          }
        }
      );
    } catch (e) {
      console.error("[Scanner] start error", e);
      setError("Failed to access camera. Please grant camera permissions.");
      setIsScanning(false);
    }
  };

  const resetScanner = () => {
    // Clean up any lingering realtime subscription
    if (supabase && realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }
    setWaitingForApproval(false);
    setScanResult(null);
    setTicketData(null);
    setError("");
    startScanner();
  };

  useEffect(() => {
    return () => {
      html5QrCodeRef.current?.stop().catch(() => undefined);
      if (supabase && realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
      }
    };
  }, []);

  return (
    <div className="min-h-screen relative overflow-hidden">
      <PopBackground />
      <div className="concert-lights" />
      <div className="fixed inset-0 bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900 animate-lights -z-10" />

      <header className="bg-black/40 backdrop-blur-md shadow-lg border-b border-pink-500/50 neon-border sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-pink-300 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </Link>
          <div className="flex items-center gap-2">
            <Link
              to="/my-ticket"
              className="px-4 py-2 rounded-lg bg-purple-900/50 border-2 border-pink-500/40 text-white hover:bg-purple-800/60 hover:border-pink-400 transition-all text-sm neon-border"
            >
              My Tickets
            </Link>
            <Link
              to="/marketplace"
              className="px-4 py-2 rounded-lg bg-purple-900/50 border-2 border-pink-500/40 text-white hover:bg-purple-800/60 hover:border-pink-400 transition-all text-sm neon-border"
            >
              Marketplace
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-gradient-to-br from-pink-600 to-purple-600 rounded-lg shadow-lg neon-border">
            <Camera className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl text-white neon-text">Ticket Scanner</h1>
            <p className="text-sm text-pink-300">Verify QR codes and check-in on-chain</p>
          </div>
        </div>

        {!currentAccount ? (
          <div className="bg-purple-900/30 backdrop-blur-md rounded-2xl p-6 border-2 border-pink-500/30 neon-border shadow-xl">
            <h2 className="text-xl text-white neon-text mb-2">Authentication Required</h2>
            <p className="text-pink-200 mb-4">Connect your wallet to use the scanner.</p>
            <ConnectButton className="w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white py-3 px-6 rounded-xl hover:from-pink-700 hover:to-purple-700 transition-all duration-200 text-base shadow-lg neon-border" />
          </div>
        ) : (
          <>
            {!isScanning && !scanResult && !isProcessing && (
              <div className="bg-purple-900/30 backdrop-blur-md rounded-2xl p-6 border-2 border-pink-500/30 neon-border shadow-xl">
                <p className="text-pink-200 mb-4">Position the QR code within the frame.</p>
                {isOrganizerLoading ? (
                  <p className="text-sm text-pink-300 mb-4">Checking organizer permissions…</p>
                ) : !isOrganizer ? (
                  <p className="text-sm text-red-300 mb-4">
                    Organizer-only: connect with the organizer wallet (AdminCap owner) to scan.
                  </p>
                ) : null}
                <button
                  onClick={startScanner}
                  disabled={isOrganizerLoading || !isOrganizer}
                  className="w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white py-3 px-6 rounded-xl hover:from-pink-700 hover:to-purple-700 transition-all duration-200 shadow-lg neon-border"
                >
                  Start Scanner
                </button>
                {error && <p className="text-sm text-red-300 mt-3">{error}</p>}
              </div>
            )}

            {isScanning && (
              <div className="bg-purple-900/30 backdrop-blur-md rounded-2xl p-4 border-2 border-pink-500/30 neon-border shadow-xl">
                <div id="qr-reader" className="w-full overflow-hidden rounded-xl" />
                <button
                  onClick={stopScanner}
                  className="mt-4 w-full bg-purple-900/50 border-2 border-pink-500/50 text-white py-3 px-6 rounded-xl hover:bg-purple-800/60 hover:border-pink-400 transition-all duration-200 neon-border"
                >
                  Stop scanning
                </button>
              </div>
            )}

            {waitingForApproval && !isProcessing && (
              <div className="bg-purple-900/30 backdrop-blur-md rounded-2xl p-6 border-2 border-yellow-500/40 neon-border shadow-xl text-center">
                <div className="flex justify-center mb-4">
                  <div className="w-12 h-12 rounded-full border-4 border-yellow-400 border-t-transparent animate-spin" />
                </div>
                <h2 className="text-xl text-white neon-text mb-2">Waiting for Approval</h2>
                <p className="text-yellow-200 text-sm">A check-in request was sent to the ticket holder's phone. Waiting for them to approve…</p>
                <button
                  onClick={resetScanner}
                  className="mt-5 w-full bg-purple-900/50 border-2 border-yellow-500/40 text-white py-3 px-6 rounded-xl hover:bg-purple-800/60 transition-all duration-200"
                >
                  Cancel
                </button>
              </div>
            )}

            {isProcessing && (
              <div className="bg-purple-900/30 backdrop-blur-md rounded-2xl p-6 border-2 border-pink-500/30 neon-border shadow-xl">
                <p className="text-pink-200">Verifying ticket on-chain…</p>
              </div>
            )}

            {scanResult === "granted" && ticketData && (
              <div className="bg-green-900/20 backdrop-blur-md rounded-2xl p-6 border-2 border-green-500/40 shadow-xl">
                <h2 className="text-2xl text-white neon-text mb-2">ACCESS GRANTED</h2>
                <p className="text-green-200 mb-4">{ticketData.eventName}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                  <div className="bg-black/20 rounded-xl p-3 border border-green-500/20">
                    <div className="text-xs text-green-200">Artist</div>
                    <div className="text-white">{ticketData.artist}</div>
                  </div>
                  <div className="bg-black/20 rounded-xl p-3 border border-green-500/20">
                    <div className="text-xs text-green-200">Seat</div>
                    <div className="text-white">{ticketData.seat}</div>
                  </div>
                </div>
                <button
                  onClick={resetScanner}
                  className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-3 px-6 rounded-xl hover:from-green-700 hover:to-emerald-700 transition-all duration-200 shadow-lg"
                >
                  Scan Next Ticket
                </button>
              </div>
            )}

            {scanResult === "denied" && (
              <div className="bg-red-900/20 backdrop-blur-md rounded-2xl p-6 border-2 border-red-500/40 shadow-xl">
                <h2 className="text-2xl text-white neon-text mb-2">ACCESS DENIED</h2>
                <p className="text-red-200 mb-4">{error || "Verification failed"}</p>
                {ticketData && (
                  <div className="text-sm text-red-100 mb-4">
                    <div>{ticketData.eventName}</div>
                    <div>{ticketData.seat}</div>
                  </div>
                )}
                <button
                  onClick={resetScanner}
                  className="w-full bg-purple-900/50 border-2 border-red-500/50 text-white py-3 px-6 rounded-xl hover:bg-purple-800/60 hover:border-red-400 transition-all duration-200"
                >
                  Try Again
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
