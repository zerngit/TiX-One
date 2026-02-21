import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

function BotDetected() {
    const navigate = useNavigate();
    const location = useLocation();
    const score = location.state?.result;

    const handleAppeal = () => {
        window.location.href = 'mailto:support@tix-one.com?subject=Bot%20Detection%20Appeal';
    };

    return (
        <div className="ticket-page">
            <div className="ticket-header">
                <button className="back-button" onClick={() => navigate('/')}>
                    ← Back
                </button>
                <h1>Security Verification</h1>
            </div>

            <div className="ticket-container">
                <div className="ticket-card bot-detected-card">
                    <h2>🚨 Bot Detected</h2>
                    <p>Your purchase was stopped before wallet signing because movement analysis was flagged as bot-like.</p>

                    {score && (
                        <div className="bot-detected-raw">
                            <span>Raw Probability Score (Closer to 1 = Bot):</span>
                            <pre>{JSON.stringify(score, null, 2)}</pre>
                        </div>
                    )}

                    <div className="button-group">
                        <button className="vip-button secondary" onClick={() => navigate('/')}>
                            Return to Main Page
                        </button>
                        <button className="vip-button primary" onClick={handleAppeal}>
                            Appeal
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default BotDetected;
