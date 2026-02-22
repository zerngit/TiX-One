import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentAccount, useSuiClient, useSignPersonalMessage, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { QRCodeSVG } from 'qrcode.react';
import { Transaction } from '@mysten/sui/transactions';

const PACKAGE_ID = '0x5078e12cb9933003a472371980d685c5fcaf49018eacf26e7dbf3b469eeea815';
const TICKET_TYPE = `${PACKAGE_ID}::ticket::Ticket`;
const KIOSK_TYPE = '0x2::kiosk::Kiosk';
const KIOSK_OWNER_CAP_TYPE = '0x2::kiosk::KioskOwnerCap';
const LISTING_REGISTRY_ID = '0x8d041f2f03636d4c27264c8f53afd3b5e8171753a24f9b5a56ca6690f12cb829';

function MyTicket() {
    const [tickets, setTickets] = useState([]);
    const [selectedTicket, setSelectedTicket] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [signature, setSignature] = useState(null);
    const [kiosk, setKiosk] = useState(null);
    const [kioskOwnerCap, setKioskOwnerCap] = useState(null);
    const [isCreatingKiosk, setIsCreatingKiosk] = useState(false);
    const [isListing, setIsListing] = useState(false);
    const [showListingModal, setShowListingModal] = useState(false);
    const [listingMode, setListingMode] = useState('public');
    const [privateLinks, setPrivateLinks] = useState({});
    
    const currentAccount = useCurrentAccount();
    const suiClient = useSuiClient();
    const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();
    const { mutate: signAndExecuteTransaction } = useSignAndExecuteTransaction();
    const navigate = useNavigate();

    useEffect(() => {
        if (currentAccount) {
            fetchTickets();
            fetchKiosk();
        } else {
            setIsLoading(false);
        }
    }, [currentAccount]);

    const fetchTickets = async () => {
        setIsLoading(true);
        try {
            const ownedObjects = await suiClient.getOwnedObjects({
                owner: currentAccount.address,
                filter: { StructType: TICKET_TYPE },
                options: {
                    showContent: true,
                    showType: true,
                }
            });

            if (ownedObjects.data && ownedObjects.data.length > 0) {
                const ticketList = ownedObjects.data.map(obj => ({
                    objectId: obj.data.objectId,
                    ...obj.data.content.fields
                }));
                setTickets(ticketList);
                setSelectedTicket(ticketList[0]);
            }
        } catch (error) {
            console.error('[MyTicket] Error fetching tickets:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchKiosk = async () => {
        try {
            // Fetch KioskOwnerCap (owned by user)
            const capObjects = await suiClient.getOwnedObjects({
                owner: currentAccount.address,
                filter: { StructType: KIOSK_OWNER_CAP_TYPE },
                options: {
                    showContent: true,
                    showType: true,
                }
            });

            if (capObjects.data && capObjects.data.length > 0) {
                const cap = capObjects.data[0];
                setKioskOwnerCap(cap);
                
                // The KioskOwnerCap contains a reference to the Kiosk ID
                // Extract the Kiosk ID from the cap's 'for' field
                const kioskId = cap.data.content.fields.for;
                console.log('[MyTicket] Found Kiosk ID:', kioskId);
                
                // Fetch the actual Kiosk object
                const kioskObject = await suiClient.getObject({
                    id: kioskId,
                    options: {
                        showContent: true,
                        showType: true,
                    }
                });
                
                if (kioskObject.data) {
                    setKiosk(kioskObject);
                    console.log('[MyTicket] Kiosk loaded successfully');
                }
            } else {
                console.log('[MyTicket] No KioskOwnerCap found');
            }
        } catch (error) {
            console.error('[MyTicket] Error fetching kiosk:', error);
        }
    };

    const generateSignature = async (ticket) => {
        try {
            // Sign a message to prove ownership
            const message = `TiX-One-Auth:${ticket.objectId}`;
            const messageBytes = new TextEncoder().encode(message);
            
            const result = await signPersonalMessage({
                message: messageBytes
            });
            
            setSignature(result.signature);
            return result.signature;
        } catch (error) {
            console.error('[MyTicket] Signature error:', error);
            return null;
        }
    };

    useEffect(() => {
        if (selectedTicket && currentAccount) {
            generateSignature(selectedTicket);
        }
    }, [selectedTicket]);

    const formatExpiration = (timestamp) => {
        const date = new Date(parseInt(timestamp));
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const generateQRData = (ticket) => {
        // Simplified QR data for easier scanning
        return JSON.stringify({
            id: ticket.objectId,
            owner: currentAccount.address,
        });
    };

    const createKiosk = async () => {
        setIsCreatingKiosk(true);
        try {
            const tx = new Transaction();
            tx.moveCall({
                target: '0x2::kiosk::default',
                arguments: [],
            });

            await new Promise((resolve, reject) => {
                signAndExecuteTransaction(
                    { transaction: tx },
                    {
                        onSuccess: async () => {
                            await new Promise(r => setTimeout(r, 1000));
                            await fetchKiosk();
                            resolve();
                        },
                        onError: (error) => {
                            console.error('[MyTicket] Kiosk creation error:', error);
                            reject(error);
                        }
                    }
                );
            });

            alert('✅ Kiosk created! Your shop is now open for business.');
        } catch (error) {
            console.error('[MyTicket] Error creating kiosk:', error);
            alert('Failed to create kiosk');
        } finally {
            setIsCreatingKiosk(false);
        }
    };

    const handleListOnMarketplace = async () => {
        const priceInMist = parseInt(selectedTicket.original_price);

        setIsListing(true);
        try {
            const tx = new Transaction();

            // Single atomic call: check cap + emit event + place/list
            tx.moveCall({
                target: `${PACKAGE_ID}::ticket::safe_list_ticket`,
                arguments: [
                    tx.object(kiosk.data.objectId),
                    tx.object(kioskOwnerCap.data.objectId),
                    tx.object(selectedTicket.objectId),
                    tx.pure.u64(priceInMist),
                    tx.object(LISTING_REGISTRY_ID)
                ],
            });

            await new Promise((resolve, reject) => {
                signAndExecuteTransaction(
                    { transaction: tx },
                    {
                        onSuccess: async () => {
                            setShowListingModal(false);
                            setListingMode('public');
                            setTickets(prev => prev.filter(t => t.objectId !== selectedTicket.objectId));
                            setSelectedTicket(null);
                            alert('✅ Ticket listed on global marketplace! Redirecting...');
                            navigate('/marketplace');
                            resolve();
                        },
                        onError: (error) => {
                            console.error('[MyTicket] Listing error:', error);
                            alert('Transaction failed. Check the console for details.');
                            reject(error);
                        }
                    }
                );
            });
        } catch (error) {
            console.error('[MyTicket] Error listing ticket:', error);
            alert('Failed to list ticket. Make sure you have enough OCT for gas fees.');
        } finally {
            setIsListing(false);
        }
    };

    const copyPrivateLink = async (url) => {
        try {
            await navigator.clipboard.writeText(url);
            alert('Private link copied to clipboard!');
        } catch (err) {
            console.error('[MyTicket] Clipboard error:', err);
            alert(`Private link: ${url}`);
        }
    };

    const handlePrivateListing = async () => {
        const priceInMist = parseInt(selectedTicket.original_price);

        setIsListing(true);
        try {
            const tx = new Transaction();

            // Single atomic call: check cap + place/list (no event)
            tx.moveCall({
                target: `${PACKAGE_ID}::ticket::safe_private_list_ticket`,
                arguments: [
                    tx.object(kiosk.data.objectId),
                    tx.object(kioskOwnerCap.data.objectId),
                    tx.object(selectedTicket.objectId),
                    tx.pure.u64(priceInMist),
                    tx.object(LISTING_REGISTRY_ID)
                ],
            });

            await new Promise((resolve, reject) => {
                signAndExecuteTransaction(
                    { transaction: tx },
                    {
                        onSuccess: async () => {
                            setShowListingModal(false);
                            setListingMode('public');
                            await new Promise(r => setTimeout(r, 1000));
                            await fetchTickets();

                            const url = `${window.location.origin}/buy?kiosk=${kiosk.data.objectId}&ticket=${selectedTicket.objectId}&price=${priceInMist}`;
                            setPrivateLinks(prev => ({
                                ...prev,
                                [selectedTicket.objectId]: url
                            }));

                            resolve();
                        },
                        onError: (error) => {
                            console.error('[MyTicket] Private listing error:', error);
                            alert('Transaction failed. Check the console for details.');
                            reject(error);
                        }
                    }
                );
            });
        } catch (error) {
            console.error('[MyTicket] Error creating private listing:', error);
            alert('Failed to create private listing. Make sure you have enough OCT for gas fees.');
        } finally {
            setIsListing(false);
        }
    };

    if (!currentAccount) {
        return (
            <div className="ticket-page">
                <div className="ticket-container">
                    <div className="ticket-card denied">
                        <h2>🔒 Not Connected</h2>
                        <p>Please connect your wallet to view your tickets</p>
                        <button className="vip-button primary" onClick={() => navigate('/')}>
                            Connect Wallet
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="ticket-page">
                <div className="ticket-container">
                    <div className="spinner"></div>
                    <p>Loading your tickets...</p>
                </div>
            </div>
        );
    }

    if (tickets.length === 0) {
        return (
            <div className="ticket-page">
                <div className="ticket-container">
                    <div className="ticket-card denied">
                        <h2>🎫 No Tickets Found</h2>
                        <p>You don't have any tickets yet</p>
                        <button className="vip-button primary" onClick={() => navigate('/')}>
                            Buy a Ticket
                        </button>
                    </div>
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
                <h1>🎫 My Tickets</h1>
            </div>

            {tickets.length > 1 && (
                <div className="ticket-selector">
                    <label>Select Ticket:</label>
                    <select 
                        value={selectedTicket?.objectId} 
                        onChange={(e) => {
                            const ticket = tickets.find(t => t.objectId === e.target.value);
                            setSelectedTicket(ticket);
                        }}
                    >
                        {tickets.map((ticket, index) => (
                            <option key={ticket.objectId} value={ticket.objectId}>
                                Ticket #{index + 1} - {ticket.event_name}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {selectedTicket && (
                <div className="ticket-display">
                    <div className="ticket-card granted">
                        <div className="ticket-info-header">
                            <h2>{selectedTicket.event_name}</h2>
                            <p className="artist-name">{selectedTicket.artist}</p>
                        </div>

                        {/* QR Code */}
                        <div className="qr-code-container">
                            <QRCodeSVG
                                value={generateQRData(selectedTicket)}
                                size={320}
                                level="M"
                                includeMargin={true}
                            />
                        </div>

                        {/* Ticket Details */}
                        <div className="ticket-details-grid">
                            <div className="detail-item">
                                <label>Seat</label>
                                <p>{selectedTicket.seat}</p>
                            </div>
                            <div className="detail-item">
                                <label>Status</label>
                                <p className={selectedTicket.is_scanned ? "scanned" : "valid"}>
                                    {selectedTicket.is_scanned ? "✓ Scanned" : "✓ Valid"}
                                </p>
                            </div>
                            <div className="detail-item">
                                <label>Expires</label>
                                <p>{formatExpiration(selectedTicket.expires_at)}</p>
                            </div>
                            <div className="detail-item">
                                <label>Price Paid</label>
                                <p>{(parseInt(selectedTicket.original_price) / 1_000_000_000).toFixed(2)} OCT</p>
                            </div>
                        </div>

                        {/* Inventory Status Badge */}
                        <div className={`inventory-status ${kiosk ? 'unlisted' : 'no-kiosk'}`}>
                            <span className="status-icon">📦</span>
                            <div className="status-text">
                                <strong>Inventory Status:</strong>
                                <span>{kiosk ? 'In Your Wallet (Unlisted)' : 'Ready to List'}</span>
                            </div>
                        </div>

                        <div className="ticket-id">
                            <label>Ticket ID</label>
                            <code>{selectedTicket.objectId.slice(0, 12)}...{selectedTicket.objectId.slice(-8)}</code>
                        </div>

                        {selectedTicket.is_scanned && (
                            <div className="warning-banner">
                                ⚠️ This ticket has already been scanned and cannot be reused
                            </div>
                        )}

                        {/* Notification for unlisted tickets */}
                        {kiosk && !selectedTicket.is_scanned && (
                            <div className="notification-banner unlisted">
                                <span className="notification-icon">💡</span>
                                <div className="notification-content">
                                    <strong>Want to sell this ticket?</strong>
                                    <p>List it on the marketplace for other fans to buy. Max price: {(parseInt(selectedTicket.original_price) / 1_000_000_000).toFixed(2)} OCT</p>
                                </div>
                            </div>
                        )}

                        {!kiosk && (
                            <div className="action-section">
                                <h3>🛍️ Global Marketplace</h3>
                                <p>To resell this ticket on BlueMove/Tradeport, first open your shop</p>
                                <button 
                                    className="vip-button primary"
                                    onClick={createKiosk}
                                    disabled={isCreatingKiosk}
                                >
                                    {isCreatingKiosk ? 'Setting up Shop...' : '+ Set Up Shop'}
                                </button>
                            </div>
                        )}

                        {kiosk && !selectedTicket.is_scanned && (
                            <div className="action-section">
                                <h3>🌐 List on Global Market</h3>
                                <p>Make this ticket available for resale on BlueMove, Tradeport & other Sui marketplaces</p>
                                <button 
                                    className="vip-button success"
                                    onClick={() => {
                                        setListingMode('public');
                                        setShowListingModal(true);
                                    }}
                                    disabled={isListing}
                                >
                                    📤 List on Global Market
                                </button>
                                {!privateLinks[selectedTicket.objectId] ? (
                                    <button 
                                        className="vip-button secondary"
                                        onClick={() => {
                                            setListingMode('private');
                                            setShowListingModal(true);
                                        }}
                                        disabled={isListing}
                                    >
                                        🔗 Create Private Link
                                    </button>
                                ) : (
                                    <div className="private-link-box" style={{ marginTop: '15px', padding: '15px', background: 'rgba(255,255,255,0.5)', borderRadius: '12px', border: '2px dashed #667eea' }}>
                                        <p style={{ margin: '0 0 10px 0', fontSize: '0.9rem', color: '#666', fontWeight: 'bold' }}>✅ Private Link Ready!</p>
                                        <div className="address-display" style={{ padding: '10px' }}>
                                            <code style={{ fontSize: '0.75rem' }}>{privateLinks[selectedTicket.objectId]}</code>
                                            <button
                                                onClick={() => copyPrivateLink(privateLinks[selectedTicket.objectId])}
                                                className="copy-btn"
                                                title="Copy link"
                                            >
                                                📋
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="qr-instructions">
                            <p>📱 Show this QR code at the venue entrance</p>
                            <p className="small-text">Do not share or screenshot this code</p>
                        </div>
                    </div>
                </div>
            )}

            {showListingModal && (
                <div className="modal-overlay" onClick={() => {
                    if (!isListing) {
                        setShowListingModal(false);
                        setListingMode('public');
                    }
                }}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <h2>{listingMode === 'private' ? '🔗 Create Private Link' : '🌐 List on Market'}</h2>
                        <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '12px', margin: '20px 0', border: '1px solid #e2e8f0' }}>
                            <p style={{ margin: '0 0 10px 0', color: '#64748b', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 'bold' }}>
                                Fixed Resale Price
                            </p>
                            <p style={{ margin: 0, color: '#0f172a', fontSize: '2rem', fontWeight: '800' }}>
                                {(parseInt(selectedTicket.original_price) / 1_000_000_000).toFixed(2)} OCT
                            </p>
                        </div>
                        <p style={{ color: '#475569', fontSize: '0.95rem', lineHeight: '1.5', marginBottom: '20px' }}>
                            To prevent scalping, TiX-One enforces a strict face-value resale policy. This ticket will be securely listed for exactly what you paid for it.
                        </p>

                        <div className="modal-actions">
                            <button 
                                className="modal-button cancel"
                                onClick={() => {
                                    setShowListingModal(false);
                                    setListingMode('public');
                                }}
                                disabled={isListing}
                            >
                                Cancel
                            </button>
                            <button 
                                className="modal-button confirm"
                                onClick={listingMode === 'private' ? handlePrivateListing : handleListOnMarketplace}
                                disabled={isListing}
                            >
                                {isListing ? 'Listing...' : listingMode === 'private' ? 'Create Private Link' : 'List at Face Value'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default MyTicket;
