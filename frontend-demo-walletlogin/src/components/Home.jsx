import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ConnectButton,
    useCurrentAccount,
    useSignTransaction,
    useSuiClient,
    useSuiClientQuery,
    useWallets,
} from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import BotDetectionModal from './BotDetectionModal';

// --- CONFIGURATION ---
const PACKAGE_ID = '0xaab69602cc3fef8fdc9785c38a75508438eb074bf6775bb2e41a921956cf7a3f';
const OCT_TYPE = '0x2::oct::OCT';
const CLOCK_OBJECT = '0x6';
const TICKET_PRICE = 100_000_000n; 

function Home() {
    const [isOneWalletInstalled, setIsOneWalletInstalled] = useState(false);
    const [isBuying, setIsBuying] = useState(false);
    const [buyError, setBuyError] = useState('');
    const [buyDigest, setBuyDigest] = useState('');
    
    // Bot Detection State
    const [isBotModalOpen, setIsBotModalOpen] = useState(false);

    const currentAccount = useCurrentAccount();
    const wallets = useWallets();
    const navigate = useNavigate();
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
        
        const hasOneWallet = wallets.some(wallet => 
            wallet.name === 'OneWallet' || 
            wallet.name.toLowerCase().includes('onewallet')
        );
        
        console.log('OneWallet detected via dapp-kit:', hasOneWallet);
        setIsOneWalletInstalled(hasOneWallet);
        
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

    const handleBuyClick = () => {
        setBuyError('');
        setBuyDigest('');

        if (!currentAccount) {
            setBuyError('Connect OneWallet to continue.');
            return;
        }

        // Open modal instead of buying directly
        setIsBotModalOpen(true);
    };

    const handleBotVerified = async (isHuman, result) => {
        setIsBotModalOpen(false);
        if (isHuman) {
            await executeTransaction();
        } else {
            console.warn('Bot detected', result);
            setBuyError('Bot detected! Transaction aborted.');
            // Optionally navigate to bot detected page
            navigate('/bot-detected', { state: { result } });
        }
    };

    const executeTransaction = async () => {
        setIsBuying(true);

        const TICKET_PRICE_MIST = 100_000_000n; // 0.1 OCT

        try {
            console.log('[TiX] Building Clean Transaction...');
            
            const tx = new Transaction();
            tx.setSender(currentAccount.address);
            tx.setGasBudget(100_000_000); 

            const [tempCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(TICKET_PRICE_MIST)]);

            tx.moveCall({
                target: `${PACKAGE_ID}::ticket::buy_ticket_oct`,
                arguments: [
                    tempCoin,
                    tx.object(CLOCK_OBJECT), // Clock
                ], 
            });

            // No need to transfer tempCoin - function handles it internally

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
                            onClick={handleBuyClick}
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

                        {/* --- TICKET ACTIONS --- */}
                        <div className="button-grid">
                            <button
                                className="action-button ticket"
                                onClick={() => navigate('/my-ticket')}
                            >
                                🎫 My Tickets
                            </button>
                            <button
                                className="action-button marketplace"
                                onClick={() => navigate('/marketplace')}
                            >
                                🛍️ Secondary Market
                            </button>
                            <button
                                className="action-button scanner"
                                onClick={() => navigate('/scanner')}
                            >
                                📸 Scanner
                            </button>
                        </div>

                        <ConnectButton className="logout-button" />
                    </div>
                </div>
            )}
            
            <BotDetectionModal 
                isOpen={isBotModalOpen} 
                onClose={() => setIsBotModalOpen(false)} 
                onVerified={handleBotVerified}
            />
        </div>
    );
}

export default Home;
