import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { ArrowLeft, Lock } from "lucide-react";
import { PopBackground } from "../components/PopBackground";
import {
  LISTING_REGISTRY_ID,
  PACKAGE_ID,
  TICKET_TYPE,
  TRANSFER_POLICY_ID,
} from "../onechain/config";

export default function CheckoutPage() {
  const [searchParams] = useSearchParams();
  const currentAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();
  const navigate = useNavigate();

  const [ticketData, setTicketData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [error, setError] = useState<string>("");
  const kioskId = searchParams.get("kiosk") || "";
  const ticketId = searchParams.get("ticket") || "";
  const priceParam = searchParams.get("price");
  const priceMist = priceParam ? Number(priceParam) : NaN;

  useEffect(() => {
    const fetchTicket = async () => {
      if (!ticketId) {
        setError("Missing ticket id in the link.");
        setIsLoading(false);
        return;
      }

      try {
        const ticketObj = await suiClient.getObject({
          id: ticketId,
          options: { showContent: true },
        });

        const fields = (ticketObj.data as any)?.content?.fields;
        if (!fields) {
          setError("Ticket not found or no longer available.");
          setIsLoading(false);
          return;
        }

        setTicketData(fields);
      } catch (e) {
        console.error("[Checkout] fetch error", e);
        setError("Failed to load ticket details.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchTicket();
  }, [ticketId, suiClient]);

  const formatPrice = (mist: number) => (mist / 1_000_000_000).toFixed(2);

  const handlePurchase = async () => {
    if (!currentAccount) return;
    if (!kioskId || !ticketId || !Number.isFinite(priceMist)) {
      alert("Invalid private sale link.");
      return;
    }

    await proceedWithPurchase();
  };

  const proceedWithPurchase = async () => {
    if (!currentAccount) return;

    setIsPurchasing(true);
    try {
      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(priceMist)]);

      const [purchasedTicket, transferRequest] = tx.moveCall({
        target: "0x2::kiosk::purchase",
        typeArguments: [TICKET_TYPE],
        arguments: [tx.object(kioskId), tx.pure.id(ticketId), coin],
      });

      tx.moveCall({
        target: `${PACKAGE_ID}::ticket::verify_resale`,
        arguments: [
          tx.object(TRANSFER_POLICY_ID),
          transferRequest,
          tx.object(LISTING_REGISTRY_ID),
          purchasedTicket,
        ],
      });

      tx.moveCall({
        target: "0x2::transfer_policy::confirm_request",
        typeArguments: [TICKET_TYPE],
        arguments: [tx.object(TRANSFER_POLICY_ID), transferRequest],
      });

      tx.transferObjects([purchasedTicket], tx.pure.address(currentAccount.address));

      const result = await signAndExecuteTransaction({ transaction: tx });
      const receipt = await suiClient.waitForTransaction({
        digest: result.digest,
        options: { showEffects: true },
      });

      if (receipt.effects?.status?.status === "success") {
        alert('✅ Ticket purchased successfully! Check "My Tickets" to view it.');
        navigate("/my-ticket");
      } else {
        alert("❌ Purchase failed. Please try again.");
      }
    } catch (e: any) {
      console.error("[Checkout] purchase error", e);
      alert(`❌ Purchase failed: ${e?.message || "Unknown error"}`);
    } finally {
      setIsPurchasing(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      <PopBackground />
      <div className="concert-lights" />
      <div className="fixed inset-0 bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900 animate-lights -z-10" />

      <header className="bg-black/40 backdrop-blur-md shadow-lg border-b border-pink-500/50 neon-border sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-pink-300 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </Link>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-gradient-to-br from-pink-600 to-purple-600 rounded-lg shadow-lg neon-border">
            <Lock className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl text-white neon-text">Private Checkout</h1>
            <p className="text-sm text-pink-300">Secure private sale link</p>
          </div>
        </div>

        {isLoading ? (
          <div className="bg-purple-900/30 backdrop-blur-md rounded-2xl p-6 border-2 border-pink-500/30 neon-border shadow-xl">
            <p className="text-pink-200">Loading ticket details…</p>
          </div>
        ) : error ? (
          <div className="bg-purple-900/30 backdrop-blur-md rounded-2xl p-6 border-2 border-red-500/30 shadow-xl">
            <h2 className="text-xl text-white neon-text mb-2">Unable to load ticket</h2>
            <p className="text-red-200">{error}</p>
          </div>
        ) : (
          <div className="bg-purple-900/30 backdrop-blur-md rounded-2xl p-6 border-2 border-pink-500/30 neon-border shadow-xl">
            <h2 className="text-xl text-white neon-text">{ticketData.event_name}</h2>
            <p className="text-pink-200 mb-4">{ticketData.artist}</p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
              <div className="bg-purple-950/30 rounded-xl p-3 border border-pink-500/20">
                <div className="text-xs text-pink-300">Seat</div>
                <div className="text-white">{ticketData.seat}</div>
              </div>
              <div className="bg-purple-950/30 rounded-xl p-3 border border-pink-500/20">
                <div className="text-xs text-pink-300">Original Price</div>
                <div className="text-white">{formatPrice(parseInt(ticketData.original_price))} OCT</div>
              </div>
              <div className="bg-purple-950/30 rounded-xl p-3 border border-pink-500/20">
                <div className="text-xs text-pink-300">Private Sale Price</div>
                <div className="text-white">
                  {Number.isFinite(priceMist) ? `${formatPrice(priceMist)} OCT` : "N/A"}
                </div>
              </div>
            </div>

            {!currentAccount && (
              <div className="mb-4">
                <p className="text-pink-200 mb-3">Connect your wallet to complete purchase.</p>
                <ConnectButton className="w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white py-3 px-6 rounded-xl hover:from-pink-700 hover:to-purple-700 transition-all duration-200 text-base shadow-lg neon-border" />
              </div>
            )}

            <button
              onClick={handlePurchase}
              disabled={!currentAccount || isPurchasing || !Number.isFinite(priceMist)}
              className="w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white py-3 px-6 rounded-xl hover:from-pink-700 hover:to-purple-700 transition-all duration-200 shadow-lg neon-border disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isPurchasing ? "Purchasing…" : "Buy Ticket"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
