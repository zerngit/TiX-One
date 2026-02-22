import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentAccount, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';

const PACKAGE_ID = '0x5078e12cb9933003a472371980d685c5fcaf49018eacf26e7dbf3b469eeea815';
const TICKET_TYPE = `${PACKAGE_ID}::ticket::Ticket`;
const TICKET_LISTED_EVENT = `${PACKAGE_ID}::ticket::TicketListedEvent`;
const TRANSFER_POLICY_ID = '0x95b4586f63d5693f394a1fddb7a4e52b70e26ad0b3eaf419fe7d7184760fa965';
const LISTING_REGISTRY_ID = '0x8d041f2f03636d4c27264c8f53afd3b5e8171753a24f9b5a56ca6690f12cb829';

function Marketplace() {
    const [listings, setListings] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isPurchasing, setIsPurchasing] = useState(false);
    const [selectedListing, setSelectedListing] = useState(null);
    
    const currentAccount = useCurrentAccount();
    const suiClient = useSuiClient();
    const { mutate: signAndExecuteTransaction } = useSignAndExecuteTransaction();
    const navigate = useNavigate();

    useEffect(() => {
        fetchMarketplaceListings();
    }, [currentAccount]);

    // Helper: Format address to shorter form
    const formatAddress = (addr) => {
        if (!addr) return 'Unknown';
        return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
    };

    // Helper: Format price in OCT
    const formatPrice = (mist) => {
        return (mist / 1_000_000_000).toFixed(2);
    };

    // Helper: Check if listing belongs to current user
    const isOwnListing = (seller) => {
        return currentAccount && currentAccount.address === seller;
    };

    // Helper: Find seller's Kiosk by their address
    const getSellerKiosk = async (sellerAddress) => {
        try {
            const capObjects = await suiClient.getOwnedObjects({
                owner: sellerAddress,
                filter: { StructType: '0x2::kiosk::KioskOwnerCap' },
                options: { showContent: true }
            });

            if (capObjects.data && capObjects.data.length > 0) {
                return capObjects.data[0].data.content.fields.for;
            }
        } catch (err) {
            console.log('[Marketplace] Could not fetch seller Kiosk:', err);
        }
        return null;
    };

    // Helper: Read active kiosk listing price for a specific ticket
    const getActiveListingPrice = async (kioskId, ticketId) => {
        try {
            const dynamicFields = await suiClient.getDynamicFields({
                parentId: kioskId,
                limit: 100
            });

            const listingField = dynamicFields.data?.find((field) => {
                const isListingType = field?.name?.type?.includes('0x2::kiosk::Listing');
                if (!isListingType) return false;

                const rawId = typeof field.name.value === 'string'
                    ? field.name.value
                    : field.name.value?.id;

                return rawId === ticketId;
            });

            if (!listingField) {
                return null;
            }

            const listingObj = await suiClient.getDynamicFieldObject({
                parentId: kioskId,
                name: listingField.name,
            });

            const value = listingObj?.data?.content?.fields?.value;
            if (value === undefined || value === null) {
                return null;
            }

            return parseInt(value);
        } catch (err) {
            console.log('[Marketplace] Failed to read active listing price:', err);
            return null;
        }
    };

    const fetchMarketplaceListings = async () => {
        setIsLoading(true);
        try {
            console.log('[Marketplace] Fetching global marketplace via custom events...');
            
            const listingsArray = [];
            const processedTickets = new Set();

            const events = await suiClient.queryEvents({
                query: { 
                    MoveEventType: TICKET_LISTED_EVENT
                },
                limit: 100,
                order: 'descending'
            });

            if (events.data && events.data.length > 0) {
                for (const event of events.data) {
                    try {
                        const eventData = event.parsedJson;
                        const ticketId = eventData.ticket_id;

                        if (!ticketId || processedTickets.has(ticketId)) {
                            continue;
                        }

                        // 1. Fetch full ticket data and ownership
                        const ticketObj = await suiClient.getObject({
                            id: ticketId,
                            options: { showContent: true, showOwner: true }
                        });

                        if (!ticketObj.data) continue;

                        // 2. CRITICAL FIX: The Address Normalization Bypass
                        // We simply check if the owner is STILL an Object (the Kiosk).
                        // If a user buys it, the owner becomes an Address (AddressOwner).
                        const owner = ticketObj.data.owner;
                        const isStillInKiosk = owner && owner.ObjectOwner !== undefined;
                        
                        if (!isStillInKiosk) {
                            console.log('[Marketplace] Ticket sold or removed:', ticketId);
                            processedTickets.add(ticketId); 
                            continue; // Skip! It will NOT be visible on the market.
                        }

                        // 3. Get Kiosk ID to enable the "Buy" button for buyers
                        const kioskId = await getSellerKiosk(eventData.seller);
                        if (!kioskId) continue;

                        const ticketData = ticketObj.data.content.fields;

                        // 4. Require an active listing object in the seller's Kiosk
                        const activeListingPrice = await getActiveListingPrice(kioskId, ticketId);
                        if (activeListingPrice === null) {
                            console.log('[Marketplace] No active kiosk listing found:', ticketId);
                            processedTickets.add(ticketId);
                            continue;
                        }

                        // 5. Enforce face-value visibility in marketplace UI
                        const originalPrice = parseInt(ticketData.original_price);
                        if (activeListingPrice > originalPrice) {
                            console.log('[Marketplace] Overpriced listing filtered out:', ticketId);
                            processedTickets.add(ticketId);
                            continue;
                        }

                        listingsArray.push({
                            ticketId: ticketId,
                            kioskId: kioskId,
                            event_name: eventData.event_name,
                            artist: eventData.artist,
                            seat: ticketData.seat,
                            original_price: ticketData.original_price,
                            price: activeListingPrice,
                            expires_at: ticketData.expires_at,
                            seller: eventData.seller,
                            is_own_listing: isOwnListing(eventData.seller)
                        });

                        processedTickets.add(ticketId);
                    } catch (err) {
                        console.log('[Marketplace] Error processing event:', err);
                    }
                }
            }

            setListings(listingsArray);
            
        } catch (error) {
            console.error('[Marketplace] Critical error:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePurchase = async (listing) => {
        if (!currentAccount) {
            alert('Please connect your wallet first!');
            return;
        }

        if (listing.is_own_listing) {
            alert('You cannot purchase your own listing.');
            return;
        }

        const originalPrice = parseInt(listing.original_price);
        if (listing.price > originalPrice) {
            alert('❌ This listing violates face-value policy and is blocked.');
            return;
        }

        setIsPurchasing(true);
        setSelectedListing(listing);

        try {
            const tx = new Transaction();

            // 1. Split exact coin amount for payment
            const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(listing.price)]);

            // 2. Purchase from Kiosk (Returns the Ticket AND the TransferRequest)
            const [purchasedTicket, transferRequest] = tx.moveCall({
                target: '0x2::kiosk::purchase',
                typeArguments: [TICKET_TYPE],
                arguments: [
                    tx.object(listing.kioskId),
                    tx.pure.id(listing.ticketId),
                    coin
                ],
            });

            // 3. Show the receipt to our custom rule to verify the price cap wasn't broken
            tx.moveCall({
                target: `${PACKAGE_ID}::ticket::verify_resale`,
                arguments: [
                    tx.object(TRANSFER_POLICY_ID), // The global policy
                    tx.object(LISTING_REGISTRY_ID),
                    transferRequest,               // The receipt from the purchase
                    purchasedTicket                // The ticket itself
                ],
            });

            // 4. Confirm the transfer request is officially approved by the policy
            tx.moveCall({
                target: '0x2::transfer_policy::confirm_request',
                typeArguments: [TICKET_TYPE],
                arguments: [
                    tx.object(TRANSFER_POLICY_ID),
                    transferRequest
                ],
            });

            // 5. Finally, send the ticket directly to the buyer's wallet
            tx.transferObjects([purchasedTicket], tx.pure.address(currentAccount.address));

            await new Promise((resolve, reject) => {
                signAndExecuteTransaction(
                    { transaction: tx },
                    {
                        onSuccess: async (result) => {
                            console.log('[Marketplace] Purchase success:', result);
                            
                            // Wait for transaction confirmation
                            try {
                                const receipt = await suiClient.waitForTransaction({
                                    digest: result.digest,
                                    options: { showEffects: true }
                                });

                                if (receipt.effects?.status?.status === 'success') {
                                    alert('✅ Ticket purchased successfully! Check "My Tickets" to view it.');
                                    await fetchMarketplaceListings();
                                    resolve();
                                } else {
                                    alert('❌ Purchase failed. Please try again.');
                                    reject(new Error('Transaction failed'));
                                }
                            } catch (err) {
                                console.log('Transaction confirming...', err);
                                alert('✅ Purchase submitted! Refreshing marketplace...');
                                await fetchMarketplaceListings();
                                resolve();
                            }
                        },
                        onError: (error) => {
                            console.error('[Marketplace] Purchase error:', error);
                            alert(`❌ Purchase failed: ${error.message || 'Unknown error'}`);
                            reject(error);
                        }
                    }
                );
            });
        } catch (error) {
            console.error('[Marketplace] Error during purchase:', error);
        } finally {
            setIsPurchasing(false);
            setSelectedListing(null);
        }
    };

    const formatExpiration = (timestamp) => {
        const date = new Date(parseInt(timestamp));
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    if (isLoading) {
        return (
            <div className="ticket-page">
                <div className="ticket-header">
                    <button className="back-button" onClick={() => navigate('/')}>
                        ← Back
                    </button>
                    <h1>🛍️ Secondary Market</h1>
                </div>
                <div className="ticket-container">
                    <div className="spinner"></div>
                    <p>Loading marketplace listings...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="ticket-page">
            <div className="ticket-header">
                <button className="back-button" onClick={() => navigate('/')}>
                    ← Back
                </button>
                <h1>🛍️ Secondary Market</h1>
                <p className="subtitle-text">Buy tickets from other fans • Price cap enforced on-chain</p>
            </div>

            <div className="marketplace-info">
                <div className="info-card">
                    <h3>🛡️ Anti-Scalping Protection</h3>
                    <p>All resale prices are capped at the original purchase price (0.1 OCT)</p>
                </div>
            </div>

            {listings.length === 0 ? (
                <div className="ticket-container">
                    <div className="ticket-card denied">
                        <h2>📭 No Listings Yet</h2>
                        <p>Be the first to list a ticket on the secondary market!</p>
                        <button className="vip-button primary" onClick={() => navigate('/my-ticket')}>
                            List Your Ticket
                        </button>
                    </div>
                </div>
            ) : (
                <div className="marketplace-grid">
                    {listings.map((listing, index) => (
                        <div key={listing.ticketId} className={`marketplace-card ${listing.is_own_listing ? 'own-listing' : ''}`}>
                            <div className="marketplace-card-header">
                                <h3>{listing.event_name}</h3>
                                <span className={`listing-badge ${listing.is_own_listing ? 'own' : 'other'}`}>
                                    {listing.is_own_listing ? 'Your Listing' : 'Listed'}
                                </span>
                            </div>

                            <div className="seller-info-prominent">
                                <span className="seller-label">
                                    {listing.is_own_listing ? '👤 You' : '👤 Seller'}:
                                </span>
                                <code className={`seller-address ${listing.is_own_listing ? 'own' : ''}`}>
                                    {listing.is_own_listing 
                                        ? 'Your Ticket' 
                                        : formatAddress(listing.seller)
                                    }
                                </code>
                            </div>

                            <div className="marketplace-details">
                                <div className="detail-row">
                                    <span className="label">Artist:</span>
                                    <span className="value">{listing.artist}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="label">Seat:</span>
                                    <span className="value">{listing.seat}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="label">Expires:</span>
                                    <span className="value">{formatExpiration(listing.expires_at)}</span>
                                </div>
                            </div>

                            <div className="price-comparison">
                                <div className="price-item">
                                    <span className="price-label">Original Price</span>
                                    <span className="price-value original">
                                        {formatPrice(parseInt(listing.original_price))} OCT
                                    </span>
                                </div>
                                <div className="price-arrow">→</div>
                                <div className="price-item">
                                    <span className="price-label">Resale Price</span>
                                    <span className="price-value resale">
                                        {formatPrice(listing.price)} OCT
                                    </span>
                                </div>
                            </div>

                            {listing.price <= parseInt(listing.original_price) && (
                                <div className="verified-badge">
                                    ✓ Price cap verified
                                </div>
                            )}

                            <button
                                className={`vip-button ${listing.is_own_listing ? 'secondary' : 'success'}`}
                                onClick={() => handlePurchase(listing)}
                                disabled={isPurchasing || !currentAccount || listing.is_own_listing}
                            >
                                {!currentAccount 
                                    ? 'Connect Wallet to Buy'
                                    : listing.is_own_listing
                                    ? '✓ Your Listing'
                                    : isPurchasing && selectedListing?.ticketId === listing.ticketId
                                    ? 'Purchasing...'
                                    : '🛒 Buy Ticket'}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default Marketplace;
