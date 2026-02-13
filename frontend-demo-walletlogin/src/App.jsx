import React, { useState, useEffect } from 'react';
import './App.css';
import {
    ConnectButton,
    useCurrentAccount,
    useSignTransaction,
    useSuiClient,
    useSuiClientQuery,
    useWallets,
} from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';

// --- CONFIGURATION ---
// 1. The Latest Package ID (From your terminal output)
const PACKAGE_ID = '0xb61f72cc9d7b72b2068f79caf673686075689f71e776aaec8accdc8d989f1a95';
const OCT_TYPE = '0x2::oct::OCT';

// 2. The New Price (0.1 OCT)
const TICKET_PRICE = 100_000_000n; 

function App() {
    const [isOneWalletInstalled, setIsOneWalletInstalled] = useState(false);
    const [isBuying, setIsBuying] = useState(false);
    const [buyError, setBuyError] = useState('');
    const [buyDigest, setBuyDigest] = useState('');
    
    const currentAccount = useCurrentAccount();
    const wallets = useWallets();
    const { mutateAsync: signTransaction } = useSignTransaction();
    const suiClient = useSuiClient();

    // Fetch Balance for UI
    const { data: octBalance } = useSuiClientQuery(
        'getBalance',
        { owner: currentAccount?.address, coinType: OCT_TYPE },
        { enabled: !!currentAccount, staleTime: 10000 }
    );

    useEffect(() => {
        console.log('Available wallets:', wallets.map(w => w.name));
        
        // Check if OneWallet is in the available wallets list
        const hasOneWallet = wallets.some(wallet => 
            wallet.name === 'OneWallet' || 
            wallet.name.toLowerCase().includes('onewallet')
        );
        
        console.log('OneWallet detected via dapp-kit:', hasOneWallet);
        setIsOneWalletInstalled(hasOneWallet);
        
        // Also try legacy window check
        const hasWindowOneWallet = !!window.onewallet;
        console.log('window.onewallet:', hasWindowOneWallet);
        
        if (hasWindowOneWallet && !hasOneWallet) {
            setIsOneWalletInstalled(true);
        }
    }, [wallets]);

    const formatOct = (rawBalance) => {
        if (!rawBalance) return '0.00';
        return (Number(rawBalance) / 1_000_000_000).toFixed(2);
    };

    // --- THE ULTRA-LITE BUY FUNCTION ---
    const handleBuyTicket = async () => {
        setBuyError('');
        setBuyDigest('');

        // 1. Confirm Package ID (Double check this!)
        const PACKAGE_ID = '0xb61f72cc9d7b72b2068f79caf673686075689f71e776aaec8accdc8d989f1a95';
        const TICKET_PRICE_MIST = 100_000_000n; // 0.1 OCT

        if (!currentAccount) {
            setBuyError('Connect OneWallet to continue.');
            return;
        }
        setIsBuying(true);

        try {
            console.log('[TiX] Building Clean Transaction...');
            
            const tx = new Transaction();
            tx.setSender(currentAccount.address);
            
            // Generous Gas Budget to be safe
            tx.setGasBudget(100_000_000); 

            // --- STEP 1: Create a Temporary Coin ---
            // We split off 0.1 OCT from your Gas to pay for the ticket.
            const [tempCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(TICKET_PRICE_MIST)]);

            // --- STEP 2: Buy the Ticket ---
            // The contract "borrows" the coin, takes the money, and gives it back.
            tx.moveCall({
                target: `${PACKAGE_ID}::ticket::buy_ticket_oct`,
                arguments: [tempCoin], 
            });

            // --- STEP 3: THE MISSING FIX ---
            // We MUST transfer the used coin back to you.
            // Without this, the transaction fails because the object is "left dangling".
            tx.transferObjects([tempCoin], currentAccount.address);

            console.log('[TiX] Requesting Signature...');
            
            const { bytes, signature } = await signTransaction({ 
                transaction: tx 
            });
            
            console.log('[TiX] Executing...');
            const result = await suiClient.executeTransactionBlock({
                transactionBlock: bytes,
                signature,
                options: { showEffects: true },
            });

            console.log('[TiX] Success:', result.digest);

            if (result.effects?.status?.status === 'success') {
                setBuyDigest(result.digest);
            } else {
                setBuyError(`On-chain error: ${result.effects?.status?.error || 'unknown'}`);
            }
        } catch (error) {
            console.error('[TiX] Buy Error:', error);
            setBuyError(error?.message || 'Transaction failed');
        } finally {
            setIsBuying(false);
        }
    };

    return (
        <div className="App">
            {!currentAccount ? (
                <div className="landing-page">
                    <div className="hero">
                        <h1>🎫 TiX-One</h1>
                        <p className="tagline">Smart Tickets for Humans</p>
                        <p className="subtitle">
                            Buy, sell, and trade tickets with blockchain-enforced fair pricing.
                            No scalpers, no middlemen.
                        </p>

                        {/* 2. Smart Button Toggle */}
                        {isOneWalletInstalled ? (
                            <div className="ready-to-connect">
                                <p style={{ color: '#4ade80', marginBottom: '1rem' }}>✅ OneWallet Detected!</p>
                                <ConnectButton className="login-button" />
                            </div>
                        ) : (
                            <div className="install-required">
                                <p className="error-text" style={{ color: '#fbbf24', marginBottom: '1rem' }}>
                                    ⚠️ OneWallet Extension Required
                                </p>
                                <a 
                                    href="https://chromewebstore.google.com/detail/onewallet/gclmcgmpkgblaglfokkaclneihpnbkli"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="login-button"
                                    style={{ display: 'inline-block', textDecoration: 'none' }}
                                >
                                    📥 Click Here to Install OneWallet
                                </a>
                                <p className="hint" style={{ marginTop: '1rem', fontSize: '0.9rem', opacity: 0.7 }}>
                                    Refresh this page after installing!
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div className="dashboard">
                    <div className="wallet-card">
                        <h2>Welcome! 🎉</h2>
                        <div className="wallet-info">
                            <label>Your Sui Wallet Address:</label>
                            <div className="address-display">
                                <code>{currentAccount.address}</code>
                                <button
                                    onClick={() => navigator.clipboard.writeText(currentAccount.address)}
                                    className="copy-btn"
                                    title="Copy address"
                                >
                                    📋
                                </button>
                            </div>
                        </div>
                        <div className="info-box">
                            <p>✅ Connected via {currentAccount.label || 'OneWallet'}</p>
                            <p>💵 Balance: {formatOct(octBalance?.totalBalance)} OCT</p>
                            <p>🎫 Ready to purchase tickets</p>
                        </div>

                        {/* --- BUY BUTTON --- */}
                        <button
                            className="buy-button"
                            onClick={handleBuyTicket}
                            disabled={isBuying}
                        >
                            {isBuying ? 'Processing...' : 'Buy Ticket (0.1 OCT)'}
                        </button>

                        {buyError && <p className="buy-status error">{buyError}</p>}
                        {buyDigest && (
                            <p className="buy-status success">
                                Ticket minted! Tx: {buyDigest}
                            </p>
                        )}

                        <ConnectButton className="logout-button" />
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;