import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { ArrowLeft, Shield, ShoppingCart } from "lucide-react";
import { PopBackground } from "../components/PopBackground";
import {
  ADMIN_CAP_ID,
  LISTING_REGISTRY_ID,
  PACKAGE_ID,
  TICKET_LISTED_EVENT,
  TICKET_TYPE,
  TRANSFER_POLICY_ID,
} from "../onechain/config";

type Listing = {
  ticketId: string;
  kioskId: string;
  event_name: string;
  artist: string;
  seat: string;
  original_price: string;
  price: number;
  expires_at: string;
  seller: string;
  is_own_listing: boolean;
};

export default function MarketplacePage() {
  const currentAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();
  const navigate = useNavigate();

  const [isOrganizer, setIsOrganizer] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const checkOrganizer = async () => {
      if (!currentAccount?.address) { setIsOrganizer(false); return; }
      try {
        const adminCapObj = await suiClient.getObject({ id: ADMIN_CAP_ID, options: { showOwner: true } });
        const owner = (adminCapObj as any)?.data?.owner?.AddressOwner;
        if (!cancelled) setIsOrganizer(owner === currentAccount.address);
      } catch {
        if (!cancelled) setIsOrganizer(false);
      }
    };
    checkOrganizer();
    return () => { cancelled = true; };
  }, [currentAccount?.address, suiClient]);

  const [listings, setListings] = useState<Listing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string>("");

  const formatAddress = (addr: string) =>
    addr ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : "Unknown";

  const formatPrice = (mist: number) => (mist / 1_000_000_000).toFixed(2);

  const formatExpiration = (timestamp: string) => {
    const date = new Date(parseInt(timestamp));
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const isOwnListing = (seller: string) =>
    !!currentAccount && currentAccount.address === seller;

  const getSellerKiosk = async (sellerAddress: string) => {
    try {
      const capObjects = await suiClient.getOwnedObjects({
        owner: sellerAddress,
        filter: { StructType: "0x2::kiosk::KioskOwnerCap" },
        options: { showContent: true },
      });
      return capObjects.data?.[0]?.data?.content?.fields?.for || null;
    } catch {
      return null;
    }
  };

  const getActiveListingPrice = async (kioskId: string, ticketId: string) => {
    try {
      const dynamicFields = await suiClient.getDynamicFields({
        parentId: kioskId,
        limit: 100,
      });

      const listingField = dynamicFields.data?.find((field: any) => {
        const isListingType = field?.name?.type?.includes("0x2::kiosk::Listing");
        if (!isListingType) return false;
        const rawId = typeof field.name.value === "string" ? field.name.value : field.name.value?.id;
        return rawId === ticketId;
      });

      if (!listingField) return null;

      const listingObj = await suiClient.getDynamicFieldObject({
        parentId: kioskId,
        name: listingField.name,
      });
      const value = listingObj?.data?.content?.fields?.value;
      if (value === undefined || value === null) return null;
      return parseInt(value);
    } catch {
      return null;
    }
  };

  const fetchMarketplaceListings = async () => {
    setIsLoading(true);
    try {
      const listingsArray: Listing[] = [];
      const processedTickets = new Set<string>();

      const events = await suiClient.queryEvents({
        query: { MoveEventType: TICKET_LISTED_EVENT },
        limit: 100,
        order: "descending",
      });

      for (const event of events.data || []) {
        const eventData: any = (event as any).parsedJson;
        const ticketId = eventData?.ticket_id;
        if (!ticketId || processedTickets.has(ticketId)) continue;

        const ticketObj = await suiClient.getObject({
          id: ticketId,
          options: { showContent: true, showOwner: true },
        });
        if (!ticketObj.data) continue;

        const owner: any = (ticketObj.data as any).owner;
        const isStillInKiosk = owner && owner.ObjectOwner !== undefined;
        if (!isStillInKiosk) {
          processedTickets.add(ticketId);
          continue;
        }

        const kioskId = await getSellerKiosk(eventData.seller);
        if (!kioskId) {
          processedTickets.add(ticketId);
          continue;
        }

        const ticketData: any = (ticketObj.data as any).content?.fields || {};
        const activeListingPrice = await getActiveListingPrice(kioskId, ticketId);
        if (activeListingPrice === null) {
          processedTickets.add(ticketId);
          continue;
        }

        const originalPrice = parseInt(ticketData.original_price);
        if (activeListingPrice > originalPrice) {
          processedTickets.add(ticketId);
          continue;
        }

        listingsArray.push({
          ticketId,
          kioskId,
          event_name: eventData.event_name,
          artist: eventData.artist,
          seat: ticketData.seat,
          original_price: ticketData.original_price,
          price: activeListingPrice,
          expires_at: ticketData.expires_at,
          seller: eventData.seller,
          is_own_listing: isOwnListing(eventData.seller),
        });
        processedTickets.add(ticketId);
      }

      setListings(listingsArray);
    } catch (e) {
      console.error("[Marketplace] load error", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMarketplaceListings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAccount?.address]);

  const handlePurchase = async (listing: Listing) => {
    if (!currentAccount) {
      alert("Please connect your wallet first!");
      return;
    }
    if (listing.is_own_listing) {
      alert("You cannot purchase your own listing.");
      return;
    }
    const originalPrice = parseInt(listing.original_price);
    if (listing.price > originalPrice) {
      alert("❌ This listing violates face-value policy and is blocked.");
      return;
    }

    setIsPurchasing(true);
    setSelectedTicketId(listing.ticketId);
    try {
      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(listing.price)]);

      const [purchasedTicket, transferRequest] = tx.moveCall({
        target: "0x2::kiosk::purchase",
        typeArguments: [TICKET_TYPE],
        arguments: [tx.object(listing.kioskId), tx.pure.id(listing.ticketId), coin],
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
        await fetchMarketplaceListings();
      } else {
        alert("❌ Purchase failed. Please try again.");
      }
    } catch (e: any) {
      console.error("[Marketplace] purchase error", e);
      alert(`❌ Purchase failed: ${e?.message || "Unknown error"}`);
    } finally {
      setIsPurchasing(false);
      setSelectedTicketId("");
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      <PopBackground />
      <div className="concert-lights" />
      <div className="fixed inset-0 bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900 animate-lights -z-10" />

      <header className="bg-black/40 backdrop-blur-md shadow-lg border-b border-pink-500/50 neon-border sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-4">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 text-pink-300 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </button>
          <div className="flex items-center gap-2">
            <Link
              to="/my-ticket"
              className="px-4 py-2 rounded-lg bg-purple-900/50 border-2 border-pink-500/40 text-white hover:bg-purple-800/60 hover:border-pink-400 transition-all text-sm neon-border"
            >
              My Tickets
            </Link>
            {isOrganizer && (
              <Link
                to="/scanner"
                className="px-4 py-2 rounded-lg bg-purple-900/50 border-2 border-pink-500/40 text-white hover:bg-purple-800/60 hover:border-pink-400 transition-all text-sm neon-border"
              >
                Scanner
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-gradient-to-br from-pink-600 to-purple-600 rounded-lg shadow-lg neon-border">
            <ShoppingCart className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl text-white neon-text">Secondary Market</h1>
            <p className="text-sm text-pink-300">Face-value policy enforced on-chain</p>
          </div>
        </div>

        <div className="bg-purple-900/30 backdrop-blur-md rounded-2xl p-5 border-2 border-pink-500/30 neon-border shadow-xl mb-6">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-pink-300 mt-1" />
            <div>
              <h3 className="text-white neon-text">Anti-Scalping Protection</h3>
              <p className="text-pink-200 text-sm">
                Listings above original price are filtered out and blocked by policy verification.
              </p>
            </div>
          </div>
        </div>

        {!currentAccount && (
          <div className="bg-purple-900/30 backdrop-blur-md rounded-2xl p-6 border-2 border-pink-500/30 neon-border shadow-xl mb-6">
            <p className="text-pink-200 mb-4">Connect OneWallet to buy from the marketplace.</p>
            <ConnectButton className="w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white py-3 px-6 rounded-xl hover:from-pink-700 hover:to-purple-700 transition-all duration-200 text-base shadow-lg neon-border" />
          </div>
        )}

        {isLoading ? (
          <div className="bg-purple-900/30 backdrop-blur-md rounded-2xl p-6 border-2 border-pink-500/30 neon-border shadow-xl">
            <p className="text-pink-200">Loading listings…</p>
          </div>
        ) : listings.length === 0 ? (
          <div className="bg-purple-900/30 backdrop-blur-md rounded-2xl p-6 border-2 border-pink-500/30 neon-border shadow-xl">
            <h2 className="text-xl text-white neon-text mb-2">No listings yet</h2>
            <p className="text-pink-200 mb-4">Be the first to list a ticket.</p>
            <Link
              to="/my-ticket"
              className="inline-block bg-gradient-to-r from-pink-600 to-purple-600 text-white py-3 px-6 rounded-xl hover:from-pink-700 hover:to-purple-700 transition-all duration-200 shadow-lg neon-border"
            >
              List a ticket
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {listings.map((listing) => (
              <div
                key={listing.ticketId}
                className={`bg-purple-900/30 backdrop-blur-md rounded-2xl p-5 border-2 shadow-xl neon-border ${
                  listing.is_own_listing
                    ? "border-green-500/40"
                    : "border-pink-500/30"
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h3 className="text-white font-medium">{listing.event_name}</h3>
                    <p className="text-sm text-pink-200">{listing.artist}</p>
                  </div>
                  <span
                    className={`text-xs px-3 py-1 rounded-full border ${
                      listing.is_own_listing
                        ? "bg-green-600/20 text-green-200 border-green-500/40"
                        : "bg-pink-600/20 text-pink-200 border-pink-500/40"
                    }`}
                  >
                    {listing.is_own_listing ? "Your listing" : "Listed"}
                  </span>
                </div>

                <div className="bg-purple-950/30 rounded-xl p-3 border border-pink-500/20 mb-3">
                  <div className="text-xs text-pink-300 mb-1">Seller</div>
                  <div className="font-mono text-xs text-white">
                    {listing.is_own_listing ? "You" : formatAddress(listing.seller)}
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-pink-300">Seat</span>
                    <span className="text-white">{listing.seat}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-pink-300">Expires</span>
                    <span className="text-white">{formatExpiration(listing.expires_at)}</span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="bg-purple-950/30 rounded-xl p-3 border border-pink-500/20">
                    <div className="text-xs text-pink-300">Original</div>
                    <div className="text-white">{formatPrice(parseInt(listing.original_price))} OCT</div>
                  </div>
                  <div className="bg-purple-950/30 rounded-xl p-3 border border-pink-500/20">
                    <div className="text-xs text-pink-300">Resale</div>
                    <div className="text-white">{formatPrice(listing.price)} OCT</div>
                  </div>
                </div>

                <button
                  onClick={() => handlePurchase(listing)}
                  disabled={!currentAccount || listing.is_own_listing || isPurchasing}
                  className="mt-4 w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white py-3 px-6 rounded-xl hover:from-pink-700 hover:to-purple-700 transition-all duration-200 shadow-lg neon-border disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {!currentAccount
                    ? "Connect Wallet to Buy"
                    : listing.is_own_listing
                    ? "✓ Your Listing"
                    : isPurchasing && selectedTicketId === listing.ticketId
                    ? "Purchasing…"
                    : "Buy Ticket"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
