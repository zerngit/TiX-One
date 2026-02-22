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
import { ArrowLeft, Camera } from "lucide-react";
import { PopBackground } from "../components/PopBackground";
import { ADMIN_CAP_ID, CLOCK_OBJECT_ID, PACKAGE_ID } from "../onechain/config";

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

  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<"granted" | "denied" | null>(null);
  const [ticketData, setTicketData] = useState<TicketInfo | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
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

  const verifyTicket = async (qrData: string) => {
    if (!currentAccount) return;
    setIsProcessing(true);
    setError("");
    try {
      const data = JSON.parse(qrData);
      const { id, owner } = data;
      const objectId = id;

      if (!objectId || !owner) {
        setError("Invalid QR code format");
        setScanResult("denied");
        return;
      }

      const ticketObject = await suiClient.getObject({
        id: objectId,
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

      // Check for existing check-in record
      const checkInRecords = await suiClient.getOwnedObjects({
        owner: currentAccount.address,
        filter: { StructType: `${PACKAGE_ID}::ticket::CheckInRecord` },
        options: { showContent: true },
      });
      const alreadyCheckedIn = checkInRecords.data?.some((record: any) => {
        const fields = record.data?.content?.fields;
        return fields?.ticket_id === objectId;
      });
      if (alreadyCheckedIn) {
        setError("This ticket has already been scanned");
        setScanResult("denied");
        setTicketData({
          eventName: content.event_name,
          seat: content.seat,
          artist: content.artist,
        });
        return;
      }

      const currentTime = Date.now();
      const expiresAt = parseInt(content.expires_at);
      if (currentTime >= expiresAt) {
        setError("This ticket has expired");
        setScanResult("denied");
        setTicketData({
          eventName: content.event_name,
          seat: content.seat,
          artist: content.artist,
        });
        return;
      }

      await checkInTicket(objectId, owner);
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

      await html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
        async (decodedText) => {
          await stopScanner();
          await verifyTicket(decodedText);
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
    setScanResult(null);
    setTicketData(null);
    setError("");
    startScanner();
  };

  useEffect(() => {
    return () => {
      html5QrCodeRef.current?.stop().catch(() => undefined);
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
                <div id="qr-reader" className="w-full" />
                <button
                  onClick={stopScanner}
                  className="mt-4 w-full bg-purple-900/50 border-2 border-pink-500/50 text-white py-3 px-6 rounded-xl hover:bg-purple-800/60 hover:border-pink-400 transition-all duration-200 neon-border"
                >
                  Stop scanning
                </button>
              </div>
            )}

            {isProcessing && (
              <div className="bg-purple-900/30 backdrop-blur-md rounded-2xl p-6 border-2 border-pink-500/30 neon-border shadow-xl">
                <p className="text-pink-200">Verifying ticket…</p>
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
