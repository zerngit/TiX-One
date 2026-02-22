import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentAccount, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { Html5Qrcode } from 'html5-qrcode';
import { Transaction } from '@mysten/sui/transactions';

const PACKAGE_ID = '0x5078e12cb9933003a472371980d685c5fcaf49018eacf26e7dbf3b469eeea815';
const ADMIN_CAP_ID = '0xd8cc35a9f7a228b12cd8375d207bd85eacca656d16e89030eb37c82bf7daeb26';
const CLOCK_OBJECT = '0x6';

function Scanner() {
    const [isScanning, setIsScanning] = useState(false);
    const [scanResult, setScanResult] = useState(null);
    const [ticketData, setTicketData] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState('');
    
    const scannerRef = useRef(null);
    const html5QrCodeRef = useRef(null);
    
    const currentAccount = useCurrentAccount();
    const suiClient = useSuiClient();
    const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();
    const navigate = useNavigate();

    const startScanner = async () => {
        if (!currentAccount) {
            setError('Please connect your wallet first');
            return;
        }

        setIsScanning(true);
        setError('');
        setScanResult(null);
        setTicketData(null);

        try {
            // Request camera permissions first
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach(track => track.stop()); // Stop the stream, we just needed permission

            const html5QrCode = new Html5Qrcode("qr-reader");
            html5QrCodeRef.current = html5QrCode;

            const config = {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0
            };

            await html5QrCode.start(
                { facingMode: "environment" },
                config,
                onScanSuccess,
                onScanError
            );
            
            console.log('[Scanner] Camera started successfully');
        } catch (err) {
            console.error('[Scanner] Error starting camera:', err);
            setError('Failed to access camera. Please grant camera permissions.');
            setIsScanning(false);
        }
    };

    const stopScanner = async () => {
        if (html5QrCodeRef.current) {
            try {
                await html5QrCodeRef.current.stop();
                html5QrCodeRef.current.clear();
            } catch (err) {
                console.error('[Scanner] Error stopping scanner:', err);
            }
        }
        setIsScanning(false);
    };

    const onScanSuccess = async (decodedText) => {
        console.log('[Scanner] ✅ QR Code detected!', decodedText);
        
        // Stop scanner immediately
        await stopScanner();
        
        // Verify the ticket
        await verifyTicket(decodedText);
    };

    const onScanError = (errorMessage) => {
        // Ignore common scanning errors (too noisy)
        // Only log if it's a real error, not just "No QR code found"
        if (!errorMessage.includes('No MultiFormat Readers')) {
            console.log('[Scanner] Scan error:', errorMessage);
        }
    };

    const verifyTicket = async (qrData) => {
        setIsProcessing(true);
        setError('');

        try {
            // Parse QR data
            const data = JSON.parse(qrData);
            const { id, owner } = data;
            const objectId = id; // Support both formats

            if (!objectId || !owner) {
                setError('Invalid QR code format');
                setScanResult('denied');
                setIsProcessing(false);
                return;
            }

            // Step 1: Fetch ticket from blockchain
            console.log('[Scanner] Fetching ticket:', objectId);
            const ticketObject = await suiClient.getObject({
                id: objectId,
                options: {
                    showContent: true,
                    showOwner: true,
                }
            });

            if (!ticketObject.data) {
                setError('Ticket not found on blockchain');
                setScanResult('denied');
                setIsProcessing(false);
                return;
            }

            // Step 2: Verify ownership
            const ticketOwner = ticketObject.data.owner?.AddressOwner;
            if (ticketOwner !== owner) {
                setError('Ticket owner mismatch');
                setScanResult('denied');
                setIsProcessing(false);
                return;
            }

            const content = ticketObject.data.content.fields;

            // Step 3: Check for existing check-in record
            console.log('[Scanner] Checking for existing check-in records...');
            const checkInRecords = await suiClient.getOwnedObjects({
                owner: currentAccount.address, // Admin owns CheckInRecords
                filter: {
                    StructType: `${PACKAGE_ID}::ticket::CheckInRecord`
                },
                options: {
                    showContent: true,
                }
            });

            // Check if this ticket ID already has a check-in record
            const alreadyCheckedIn = checkInRecords.data?.some(record => {
                const fields = record.data?.content?.fields;
                return fields?.ticket_id === objectId;
            });

            if (alreadyCheckedIn) {
                setError('This ticket has already been scanned');
                setScanResult('denied');
                setTicketData({
                    eventName: content.event_name,
                    seat: content.seat,
                    artist: content.artist,
                });
                setIsProcessing(false);
                return;
            }

            // Step 4: Check expiration
            
            const currentTime = Date.now();
            const expiresAt = parseInt(content.expires_at);
            if (currentTime >= expiresAt) {
                setError('This ticket has expired');
                setScanResult('denied');
                setTicketData({
                    eventName: content.event_name,
                    seat: content.seat,
                    artist: content.artist,
                });
                setIsProcessing(false);
                return;
            }

            // Step 5: Execute check-in transaction
            console.log('[Scanner] Executing check-in...');
            await checkInTicket(objectId, owner);

            // Success!
            setScanResult('granted');
            setTicketData({
                eventName: content.event_name,
                seat: content.seat,
                artist: content.artist,
                owner: ticketOwner,
            });

        } catch (err) {
            console.error('[Scanner] Verification error:', err);
            setError(err.message || 'Verification failed');
            setScanResult('denied');
        } finally {
            setIsProcessing(false);
        }
    };

    const checkInTicket = async (ticketObjectId, ticketOwnerAddress) => {
        const tx = new Transaction();
        tx.setSender(currentAccount.address); // ADMIN signs (owns AdminCap)
        tx.setGasBudget(100_000_000);

        // Call verify_and_check_in with ID only (no ownership conflict!)
        tx.moveCall({
            target: `${PACKAGE_ID}::ticket::verify_and_check_in`,
            arguments: [
                tx.object(ADMIN_CAP_ID),              // 1. AdminCap (organizer permission)
                tx.pure.id(ticketObjectId),           // 2. Ticket ID (not object!)
                tx.pure.address(ticketOwnerAddress),  // 3. Ticket owner address
                tx.object(CLOCK_OBJECT),              // 4. Clock for timestamp
            ],
        });

        // 1. Broadcast the transaction
        const response = await signAndExecuteTransaction({
            transaction: tx,
        });
        console.log('[Scanner] Tx broadcasted, waiting for confirmation...', response.digest);
        
        // 2. Wait for the blockchain to index it and return the full receipt
        const result = await suiClient.waitForTransaction({
            digest: response.digest,
            options: {
                showEffects: true,
            },
        });
        console.log('[Scanner] Final result:', result);
        console.log('[Scanner] Effects:', result.effects);
        
        // 3. Check the verified status
        if (result.effects?.status?.status !== 'success') {
            throw new Error(`Check-in transaction failed: ${result.effects?.status?.error || 'unknown error'}`);
        }
    };

    const resetScanner = () => {
        setScanResult(null);
        setTicketData(null);
        setError('');
        startScanner();
    };

    useEffect(() => {
        return () => {
            if (html5QrCodeRef.current) {
                html5QrCodeRef.current.stop().catch(console.error);
            }
        };
    }, []);

    if (!currentAccount) {
        return (
            <div className="scanner-page">
                <div className="scanner-container">
                    <div className="scanner-card">
                        <h2>🔒 Authentication Required</h2>
                        <p>Please connect your wallet to use the scanner</p>
                        <button className="vip-button primary" onClick={() => navigate('/')}>
                            Connect Wallet
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="scanner-page">
            <div className="scanner-header">
                <button className="back-button" onClick={() => navigate('/')}>
                    ← Back
                </button>
                <h1>📸 Ticket Scanner</h1>
            </div>

            {!isScanning && !scanResult && (
                <div className="scanner-container">
                    <div className="scanner-card">
                        <div className="scanner-icon">📱</div>
                        <h2>Ready to Scan</h2>
                        <p>Position the QR code within the frame</p>
                        <button className="vip-button primary" onClick={startScanner}>
                            Start Scanner
                        </button>
                    </div>
                </div>
            )}

            {isScanning && (
                <div className="scanner-active">
                    <div id="qr-reader" ref={scannerRef}></div>
                    <div className="scanner-overlay">
                        <div className="scan-frame"></div>
                        <p className="scan-instruction">📱 Align QR code within frame</p>
                        <p className="scan-hint">Looking for QR code...</p>
                    </div>
                    <button className="stop-scan-button" onClick={stopScanner}>
                        ✕ Stop Scanning
                    </button>
                </div>
            )}

            {isProcessing && (
                <div className="scanner-processing">
                    <div className="spinner"></div>
                    <h2>Verifying Ticket...</h2>
                    <p>Please wait while we check the blockchain</p>
                </div>
            )}

            {scanResult === 'granted' && ticketData && (
                <div className="scan-result granted">
                    <div className="result-icon">✓</div>
                    <h1>ACCESS GRANTED</h1>
                    <div className="result-details">
                        <h2>{ticketData.eventName}</h2>
                        <p className="artist">{ticketData.artist}</p>
                        <div className="seat-info">
                            <span className="seat-label">Seat:</span>
                            <span className="seat-value">{ticketData.seat}</span>
                        </div>
                    </div>
                    <button className="vip-button primary" onClick={resetScanner}>
                        Scan Next Ticket
                    </button>
                </div>
            )}

            {scanResult === 'denied' && (
                <div className="scan-result denied">
                    <div className="result-icon">✕</div>
                    <h1>ACCESS DENIED</h1>
                    <p className="error-message">{error}</p>
                    {ticketData && (
                        <div className="result-details">
                            <p>{ticketData.eventName}</p>
                            <p>{ticketData.seat}</p>
                        </div>
                    )}
                    <button className="vip-button secondary" onClick={resetScanner}>
                        Try Again
                    </button>
                </div>
            )}
        </div>
    );
}

export default Scanner;
