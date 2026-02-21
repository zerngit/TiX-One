import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ConnectButton, useCurrentAccount, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';

const PACKAGE_ID = '0xaab69602cc3fef8fdc9785c38a75508438eb074bf6775bb2e41a921956cf7a3f';
const TICKET_TYPE = `${PACKAGE_ID}::ticket::Ticket`;
const TRANSFER_POLICY_ID = '0x8997dc1f0088d885da8cbd644c72b301eb27a68fb12da3f5d0c52659a8ce4209';

function Checkout() {
    const [searchParams] = useSearchParams();
    const currentAccount = useCurrentAccount();
    const suiClient = useSuiClient();
    const { mutate: signAndExecuteTransaction } = useSignAndExecuteTransaction();
    const navigate = useNavigate();

    const [ticketData, setTicketData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isPurchasing, setIsPurchasing] = useState(false);
    const [error, setError] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    const [mousePoint, setMousePoint] = useState({ x: 0, y: 0 });
    const [dataPoints, setDataPoints] = useState(0);
    const [verification, setVerification] = useState({
        status: 'idle',
        message: 'Waiting for data...',
        result: null,
    });

    const recorderRef = useRef({
        records: [],
        addRecord(record) {
            this.records.push(record);
        },
        getRecords() {
            return this.records;
        },
        clear() {
            this.records = [];
        },
    });

    const kioskId = searchParams.get('kiosk');
    const ticketId = searchParams.get('ticket');
    const priceParam = searchParams.get('price');
    const priceMist = priceParam ? Number(priceParam) : NaN;

    useEffect(() => {
        const fetchTicket = async () => {
            if (!ticketId) {
                setError('Missing ticket id in the link.');
                setIsLoading(false);
                return;
            }

            try {
                const ticketObj = await suiClient.getObject({
                    id: ticketId,
                    options: { showContent: true }
                });

                if (!ticketObj.data?.content?.fields) {
                    setError('Ticket not found or no longer available.');
                    setIsLoading(false);
                    return;
                }

                setTicketData(ticketObj.data.content.fields);
            } catch (err) {
                console.error('[Checkout] Ticket fetch error:', err);
                setError('Failed to load ticket details.');
            } finally {
                setIsLoading(false);
            }
        };

        fetchTicket();
    }, [ticketId, suiClient]);

    const formatPrice = (mist) => {
        return (mist / 1_000_000_000).toFixed(2);
    };

    useEffect(() => {
        let mounted = true;

        const ensureDelbotLoaded = async () => {
            if (window.delbot?.Models?.rnn3?.predict) return;

            const existingScript = document.querySelector('script[data-delbot="true"]');
            if (existingScript) return;

            // Try multiple candidate locations where devs commonly place static files
            const candidates = [
                '/delbot.min.js', // public root (vite public/)
                'delbot.min.js', // relative to current path
                '/assets/delbot.min.js', // built asset root
                `${window.location.pathname}delbot.min.js`,
                `${window.location.origin}${window.location.pathname}delbot.min.js`,
            ];

            let found = null;

            for (const url of candidates) {
                try {
                    // try a short fetch to check availability
                    const res = await fetch(url, { method: 'GET' });
                    if (res && res.ok) {
                        found = url;
                        break;
                    }
                } catch (e) {
                    // ignore and try next
                }
            }

            if (!found) {
                if (!mounted) return;
                setVerification({
                    status: 'error',
                    message: 'Delbot script not found. Put delbot.min.js in the project `public/` directory or in `dist` root.',
                    result: null,
                });
                return;
            }

            // inject the first-found script URL. We fetch and sanitize the file to remove
            // inner "use strict" directives that can cause browser SyntaxErrors.
            const injectScript = async (url) => {
                try {
                    const res = await fetch(url, { method: 'GET' });
                    if (res && res.ok) {
                        let text = await res.text();
                        // remove strict directives that can break the library in some bundling contexts
                        text = text.replace(/"use strict";/g, '');
                        const blob = new Blob([text], { type: 'text/javascript' });
                        const blobUrl = URL.createObjectURL(blob);

                        return await new Promise((resolve, reject) => {
                            const script = document.createElement('script');
                            script.src = blobUrl;
                            script.async = true;
                            script.dataset.delbot = 'true';
                            script.onload = () => {
                                console.log(`Delbot loaded from ${url}`);
                                resolve(url);
                            };
                            script.onerror = (e) => {
                                console.warn(`Delbot failed to load from blob of ${url}`, e);
                                URL.revokeObjectURL(blobUrl);
                                script.remove();
                                reject(new Error(`Failed to load delbot from ${url}`));
                            };
                            document.body.appendChild(script);
                        });
                    }
                } catch (err) {
                    // fallthrough to try direct script injection
                }

                // last-resort: try to inject by src directly
                return new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = url;
                    script.async = true;
                    script.dataset.delbot = 'true';
                    script.onload = () => {
                        console.log(`Delbot loaded from ${url}`);
                        resolve(url);
                    };
                    script.onerror = (e) => {
                        console.warn(`Delbot failed to load from ${url}`, e);
                        script.remove();
                        reject(new Error(`Failed to load delbot from ${url}`));
                    };
                    document.body.appendChild(script);
                });
            };

            try {
                await injectScript(found);
            } catch (err) {
                // Try common CDN fallbacks if local copy has syntax/runtime issues
                const cdnCandidates = [
                    'https://cdn.jsdelivr.net/npm/@chrisgdt/delbot-mouse@1.3.3/dist/delbot.min.js',
                    'https://cdn.jsdelivr.net/npm/@chrisgdt/delbot-mouse/dist/delbot.min.js',
                    'https://unpkg.com/@chrisgdt/delbot-mouse@1.3.3/dist/delbot.min.js'
                ];

                let loaded = false;
                for (const cdn of cdnCandidates) {
                    try {
                        await injectScript(cdn);
                        loaded = true;
                        break;
                    } catch (e) {
                        // continue to next CDN
                    }
                }

                if (!loaded) {
                    if (!mounted) return;
                    setVerification({
                        status: 'error',
                        message: 'Delbot script could not be loaded. Check console for details.',
                        result: null,
                    });
                    return;
                }
            }
        };

        ensureDelbotLoaded();

        return () => {
            mounted = false;
        };
    }, []);

    const handleMouseMove = (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = Math.max(0, Math.round(event.clientX - rect.left));
        const y = Math.max(0, Math.round(event.clientY - rect.top));

        recorderRef.current.addRecord({
            x,
            y,
            t: Date.now(),
        });

        setMousePoint({ x, y });
        setDataPoints(recorderRef.current.getRecords().length);

        if (verification.status === 'idle') {
            setVerification((previous) => ({
                ...previous,
                message: 'Collecting movement data...',
            }));
        }
    };

    const clearTelemetry = () => {
        recorderRef.current.clear();
        setDataPoints(0);
        setMousePoint({ x: 0, y: 0 });
        setVerification({
            status: 'idle',
            message: 'Waiting for data...',
            result: null,
        });
    };

    const verifyHumanBeforePurchase = async () => {
        if (!window.delbot?.Models?.rnn3?.predict) {
            setVerification({
                status: 'error',
                message: 'Delbot model is not available. Please load delbot.min.js.',
                result: null,
            });

            return { approved: false, redirect: false };
        }

        if (recorderRef.current.getRecords().length < 10) {
            setVerification({
                status: 'error',
                message: 'Please move your mouse more before verification (at least 10 points).',
                result: null,
            });

            return { approved: false, redirect: false };
        }

        setVerification({
            status: 'verifying',
            message: 'Verifying movement with Delbot AI...',
            result: null,
        });

        try {
            const result = await window.delbot.Models.rnn3.predict(recorderRef.current);
            const isHuman = typeof result === 'number' ? result < 0.5 : (result[0] > result[1]);

            if (isHuman) {
                setVerification({
                    status: 'human',
                    message: '✅ HUMAN DETECTED',
                    result,
                });

                return { approved: true, redirect: false, result };
            }

            setVerification({
                status: 'bot',
                message: '🚨 BOT DETECTED',
                result,
            });

            return { approved: false, redirect: true, result };
        } catch (err) {
            console.error(err);
            setVerification({
                status: 'error',
                message: `Verification Error: ${err.message}`,
                result: null,
            });

            return { approved: false, redirect: false };
        }
    };

    const handlePurchase = async () => {
        if (!currentAccount) {
            return;
        }

        if (!kioskId || !ticketId || !Number.isFinite(priceMist)) {
            alert('Invalid private sale link.');
            return;
        }

        setIsVerifying(true);
        const verificationResult = await verifyHumanBeforePurchase();
        setIsVerifying(false);

        if (!verificationResult.approved) {
            if (verificationResult.redirect) {
                navigate('/bot-detected', {
                    state: {
                        result: verificationResult.result,
                    },
                });
            }

            return;
        }

        setIsPurchasing(true);

        try {
            const tx = new Transaction();

            // 1. Split exact coin amount for payment
            const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(priceMist)]);

            // 2. Purchase from Kiosk (Returns the Ticket AND the TransferRequest)
            const [purchasedTicket, transferRequest] = tx.moveCall({
                target: '0x2::kiosk::purchase',
                typeArguments: [TICKET_TYPE],
                arguments: [
                    tx.object(kioskId),
                    tx.pure.id(ticketId),
                    coin
                ],
            });

            // 3. Show the receipt to our custom rule to verify the price cap wasn't broken
            tx.moveCall({
                target: `${PACKAGE_ID}::ticket::verify_resale`,
                arguments: [
                    tx.object(TRANSFER_POLICY_ID),
                    transferRequest,
                    purchasedTicket
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
                            console.log('[Checkout] Purchase success:', result);
                            try {
                                const receipt = await suiClient.waitForTransaction({
                                    digest: result.digest,
                                    options: { showEffects: true }
                                });

                                if (receipt.effects?.status?.status === 'success') {
                                    alert('✅ Ticket purchased successfully! Check "My Tickets" to view it.');
                                    navigate('/my-ticket');
                                    resolve();
                                } else {
                                    alert('❌ Purchase failed. Please try again.');
                                    reject(new Error('Transaction failed'));
                                }
                            } catch (err) {
                                console.log('[Checkout] Transaction confirming...', err);
                                alert('✅ Purchase submitted! Check "My Tickets" shortly.');
                                navigate('/my-ticket');
                                resolve();
                            }
                        },
                        onError: (err) => {
                            console.error('[Checkout] Purchase error:', err);
                            alert(`❌ Purchase failed: ${err.message || 'Unknown error'}`);
                            reject(err);
                        }
                    }
                );
            });
        } catch (err) {
            console.error('[Checkout] Error during purchase:', err);
            alert('Purchase failed. Please try again.');
        } finally {
            setIsPurchasing(false);
        }
    };

    if (isLoading) {
        return (
            <div className="ticket-page">
                <div className="ticket-header">
                    <button className="back-button" onClick={() => navigate('/')}>
                        ← Back
                    </button>
                    <h1>🔒 Private Checkout</h1>
                </div>
                <div className="ticket-container">
                    <div className="spinner"></div>
                    <p>Loading ticket details...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="ticket-page">
                <div className="ticket-header">
                    <button className="back-button" onClick={() => navigate('/')}>
                        ← Back
                    </button>
                    <h1>🔒 Private Checkout</h1>
                </div>
                <div className="ticket-container">
                    <div className="ticket-card denied">
                        <h2>⚠️ Unable to load ticket</h2>
                        <p>{error}</p>
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
                <h1>🔒 Private Checkout</h1>
                <p className="subtitle-text">Secure private sale • Price cap enforced on-chain</p>
            </div>

            <div className="ticket-container">
                <div className="ticket-card">
                    <h2>{ticketData.event_name}</h2>
                    <p className="artist-name">{ticketData.artist}</p>

                    <div className="ticket-details">
                        <div className="detail-item">
                            <label>Seat</label>
                            <span>{ticketData.seat}</span>
                        </div>
                        <div className="detail-item">
                            <label>Original Price</label>
                            <span>{formatPrice(parseInt(ticketData.original_price))} OCT</span>
                        </div>
                        <div className="detail-item">
                            <label>Private Sale Price</label>
                            <span>{Number.isFinite(priceMist) ? `${formatPrice(priceMist)} OCT` : 'N/A'}</span>
                        </div>
                    </div>

                    {!currentAccount && (
                        <div className="connect-section">
                            <p>Please connect your wallet to complete purchase.</p>
                            <ConnectButton />
                        </div>
                    )}

                    <button
                        className="vip-button success"
                        onClick={handlePurchase}
                        disabled={!currentAccount || isPurchasing || isVerifying || !Number.isFinite(priceMist)}
                    >
                        {isVerifying ? 'Verifying Human...' : isPurchasing ? 'Purchasing...' : '🛒 Buy Ticket'}
                    </button>

                    <div className="action-section">
                        <h3>Delbot Human Verification</h3>
                        <p>Move your cursor naturally inside the box to generate telemetry before purchase.</p>

                        <div className="delbot-telemetry-box" onMouseMove={handleMouseMove}>
                            <span className="delbot-telemetry-hint">Hover and move your mouse around here</span>
                            <span className="delbot-telemetry-coords">X: {mousePoint.x} | Y: {mousePoint.y}</span>
                        </div>

                        <div className="delbot-toolbar">
                            <span className="delbot-points">Data Points: {dataPoints}</span>
                            <button
                                className="vip-button secondary delbot-clear-btn"
                                onClick={clearTelemetry}
                                type="button"
                            >
                                Clear
                            </button>
                        </div>

                        <div className={`delbot-result-box ${verification.status}`}>
                            <div>{verification.message}</div>
                            {verification.result !== null && (
                                <>
                                    <span className="delbot-raw-title">Raw Probability Score (Closer to 1 = Bot):</span>
                                    <pre>{JSON.stringify(verification.result, null, 2)}</pre>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Checkout;
