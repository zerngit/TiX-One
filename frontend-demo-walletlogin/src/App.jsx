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

const PACKAGE_ID = '0x1e14e6efe5d73c72e325680daea333dcbfc930bc36572cf8791342907c394343';
const OCT_TYPE = '0x2::oct::OCT';
const TICKET_PRICE = 1_000_000_000n; // 1 OCT with 9 decimals

function App() {
    const [isOneWalletInstalled, setIsOneWalletInstalled] = useState(false);
    const [isBuying, setIsBuying] = useState(false);
    const [buyError, setBuyError] = useState('');
    const [buyDigest, setBuyDigest] = useState('');
    const [networkWarning, setNetworkWarning] = useState('');
    const currentAccount = useCurrentAccount();
    const wallets = useWallets();

    // Step 1: Wallet ONLY signs — no dry-run, no RPC call
    const { mutateAsync: signTransaction } = useSignTransaction();

    // Step 2: We execute via our own hardcoded RPC client
    const suiClient = useSuiClient();

    const { data: octBalance } = useSuiClientQuery(
        'getBalance',
        {
            owner: currentAccount?.address,
            coinType: OCT_TYPE,
        },
        {
            enabled: !!currentAccount,
            staleTime: 30000,
            gcTime: 60000,
        }
    );

    const { data: octCoins } = useSuiClientQuery(
        'getCoins',
        {
            owner: currentAccount?.address,
            coinType: OCT_TYPE,
        },
        {
            enabled: !!currentAccount,
            staleTime: 30000,
            gcTime: 60000,
        }
    );

    useEffect(() => {
        const hasOneWallet = wallets.some((wallet) =>
            wallet.name === 'OneWallet' || wallet.name.toLowerCase().includes('onewallet')
        );
        setIsOneWalletInstalled(hasOneWallet);

        const hasWindowOneWallet = !!window.onewallet;
        if (hasWindowOneWallet && !hasOneWallet) {
            setIsOneWalletInstalled(true);
        }

        if (window.onewallet?.chain) {
            const network = window.onewallet.chain();
            if (network !== 'testnet') {
                setNetworkWarning('⚠️ Please switch to OneChain Testnet in your wallet');
            } else {
                setNetworkWarning('');
            }
        }
    }, [wallets]);

    const formatOct = (rawBalance) => {
        if (!rawBalance) return '0.00';
        const asNumber = Number(rawBalance) / 1_000_000_000;
        return asNumber.toFixed(2);
    };

    const handleBuyTicket = async () => {
        setBuyError('');
        setBuyDigest('');

        if (!currentAccount) {
            setBuyError('Connect OneWallet to continue.');
            return;
        }

        if (window.onewallet?.chain) {
            const network = window.onewallet.chain();
            if (network !== 'testnet') {
                setBuyError('⚠️ Please switch to OneChain Testnet in your OneWallet');
                return;
            }
        }

        const coinList = octCoins?.data || [];
        const paymentCoin = coinList.find((coin) => BigInt(coin.balance) >= TICKET_PRICE);

        if (!paymentCoin) {
            setBuyError('Insufficient OCT balance. You need at least 1 OCT.');
            return;
        }

        setIsBuying(true);

        try {
            // ── SIMPLEST POSSIBLE PTB: just 1 moveCall, no splitCoins ──
            // The Move contract uses &mut Coin and splits internally
            const tx = new Transaction();
            tx.setSender(currentAccount.address);
            tx.setGasBudget(50_000_000);
            tx.setGasPrice(1000);

            // Use the OCT coin directly as gas AND as payment
            // The contract receives &mut Coin and splits 1 OCT from it
            tx.setGasPayment([{
                objectId: paymentCoin.coinObjectId,
                version: paymentCoin.version,
                digest: paymentCoin.digest,
            }]);

            // SINGLE moveCall — pass tx.gas as the mutable coin reference
            tx.moveCall({
                target: `${PACKAGE_ID}::ticket::buy_ticket_oct`,
                arguments: [tx.gas],
            });

            console.log('[TiX] 1/4 Building TX bytes via our RPC...');

            // Pre-build so wallet gets fully resolved bytes
            const txBytes = await tx.build({ client: suiClient });
            console.log('[TiX] 2/4 Pre-built (' + txBytes.length + ' bytes). Requesting wallet signature...');

            // Wallet ONLY signs — the TX is already fully resolved
            const { bytes, signature } = await signTransaction({
                transaction: Transaction.from(txBytes),
            });

            console.log('[TiX] 3/4 Signed. Executing via our RPC...');

            // We execute via our own hardcoded RPC
            const result = await suiClient.executeTransactionBlock({
                transactionBlock: bytes,
                signature,
                options: { showEffects: true },
            });

            console.log('[TiX] 4/4 Done:', result.digest);

            if (result.effects?.status?.status === 'success') {
                setBuyDigest(result.digest);
            } else {
                setBuyError(`On-chain error: ${result.effects?.status?.error || 'unknown'}`);
            }
        } catch (error) {
            console.error('[TiX] Error:', error);
            const msg = error?.message || String(error);
            if (msg.includes('Rejected') || msg.includes('rejected')) {
                setBuyError('Transaction was rejected in OneWallet.');
            } else {
                setBuyError(msg);
            }
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
                            <p>🎫 Ready to purchase tickets</p>
                            <p>💵 OCT Balance: {formatOct(octBalance?.totalBalance)} OCT</p>
                            {networkWarning && <p style={{ color: '#fbbf24' }}>{networkWarning}</p>}
                        </div>

                        <button
                            className="buy-button"
                            onClick={handleBuyTicket}
                            disabled={isBuying}
                        >
                            {isBuying ? 'Processing...' : 'Buy Ticket (1 OCT)'}
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