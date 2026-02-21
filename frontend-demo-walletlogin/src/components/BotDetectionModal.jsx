import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './BotDetectionModal.css';

function BotDetectionModal({ isOpen, onClose, onVerified }) {
    const navigate = useNavigate();
    const [mousePoint, setMousePoint] = useState({ x: 0, y: 0 });
    const [dataPoints, setDataPoints] = useState(0);
    const [verification, setVerification] = useState({
        status: 'idle', // idle, verifying, human, bot, error
        message: 'Waiting for data...',
        result: null,
    });
    
    // Use a ref for recorder to avoid re-renders on every mouse move affecting logic
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

    useEffect(() => {
        if (!isOpen) return;

        let mounted = true;
        
        const ensureDelbotLoaded = async () => {
            // Helper to upgrade ref if needed
            const upgradeRecorder = () => {
                if (window.delbot && window.delbot.Recorder && !(recorderRef.current instanceof window.delbot.Recorder)) {
                    try {
                        console.log("Upgrading to native Delbot Recorder...");
                        const oldRecords = recorderRef.current.getRecords ? recorderRef.current.getRecords() : [];
                        recorderRef.current = new window.delbot.Recorder(window.screen.width, window.screen.height);
                        // The library sets max size to limited by default, maybe set higher
                        if (recorderRef.current.setMaxSize) recorderRef.current.setMaxSize(1000); // optional

                        if (oldRecords && oldRecords.length > 0) {
                            oldRecords.forEach(r => {
                                // ensure format is compatible (time vs t)
                                recorderRef.current.addRecord({
                                    time: r.time || r.t || Date.now(),
                                    x: r.x,
                                    y: r.y,
                                    type: r.type || 'move'
                                });
                            });
                        }
                    } catch (e) {
                        console.warn("Failed to upgrade recorder", e);
                    }
                }
            };

            if (window.delbot?.Models?.rnn3?.predict) {
                upgradeRecorder();
                return;
            }

            // Check if script is already injected
            const existingScript = document.querySelector('script[data-delbot="true"]');
            if (existingScript) return;

            // Try loading from public/ or relative paths
            const candidates = [
                '/delbot.min.js',
                'delbot.min.js',
                '/assets/delbot.min.js',
                `${window.location.origin}/delbot.min.js`
            ];

            let scriptUrl = null;

            // Simple fetch check
            for (const url of candidates) {
                try {
                    const res = await fetch(url, { method: 'HEAD' });
                    if (res.ok) {
                        scriptUrl = url;
                        break;
                    }
                } catch (e) {
                    // ignore
                }
            }

            // Fallback to CDN if local not found
            if (!scriptUrl) {
                scriptUrl = 'https://cdn.jsdelivr.net/npm/@chrisgdt/delbot-mouse@1.3.3/dist/delbot.min.js';
            }

            const loadScript = (url) => {
                return new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = url;
                    script.async = true;
                    script.dataset.delbot = 'true';
                    script.onload = () => resolve(url);
                    script.onerror = () => reject(new Error(`Failed to load ${url}`));
                    document.body.appendChild(script);
                });
            };

            const loadTF = () => {
                if (window.tf) return Promise.resolve();
                return loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js');
            };

            try {
                await loadTF();
                await loadScript(scriptUrl);
                console.log('Delbot loaded from', scriptUrl);
                
                // Initialize Delbot Recorder if available (handles normalization)
                upgradeRecorder();
            } catch (err) {
                if (mounted) {
                    console.error("Failed to load dependencies", err);
                    setVerification(prev => ({ 
                        ...prev, 
                        status: 'error', 
                        message: 'Failed to load detection script.' 
                    }));
                }
            }
        };

        ensureDelbotLoaded();

        return () => {
            mounted = false;
        };
    }, [isOpen]);

    const handleMouseMove = (event) => {
        if (verification.status === 'human' || verification.status === 'bot') return;

        const rect = event.currentTarget.getBoundingClientRect();
        const x = Math.max(0, Math.round(event.clientX - rect.left));
        const y = Math.max(0, Math.round(event.clientY - rect.top));

        recorderRef.current.addRecord({
            x,
            y,
            time: Date.now(),
        });

        setMousePoint({ x, y });
        setDataPoints(recorderRef.current.getRecords().length);

        if (verification.status === 'idle' || verification.status === 'error') {
            setVerification(prev => ({
                ...prev,
                status: 'collecting',
                message: '<span class="text-blue-300 animate-pulse">Collecting movement data...</span>',
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

    const verifyMovements = async () => {
        if (!window.delbot?.Models?.rnn3?.predict) {
             setVerification({
                status: 'error',
                message: 'Delbot model not ready. Please wait or reload.',
                result: null,
            });
            return;
        }

        if (recorderRef.current.getRecords().length < 50) {
            setVerification({
                status: 'error',
                message: `<span class='text-yellow-400'>⚠️ Need more data. Please move your mouse more! (Currently ${recorderRef.current.getRecords().length}/50)</span>`,
                result: null,
            });
            return;
        }

        // Just-in-time check if we are using native recorder, otherwise upgrade
        // The library expects 'time' property, not 't'
        if (window.delbot && window.delbot.Recorder && !(recorderRef.current instanceof window.delbot.Recorder)) {
            try {
                const rec = new window.delbot.Recorder(window.screen.width, window.screen.height);
                recorderRef.current.getRecords().forEach(r => rec.addRecord({
                    time: r.time || r.t || Date.now(),
                    x: r.x, y: r.y, type: 'move'
                }));
                recorderRef.current = rec;
                console.log("JIT Upgraded recorder to native instance");
            } catch (e) {
                console.warn("JIT upgrade failed", e);
            }
        }

        setVerification({
            status: 'verifying',
            message: '<span class="text-blue-300 animate-pulse">Loading Neural Network and analyzing telemetry...</span>',
            result: null
        });

        try {
            const result = await window.delbot.Models.rnn3.predict(recorderRef.current);
            
            // The score is usually a float. Closer to 1 = Bot, Closer to 0 = Human. 
            // We use < 0.5 as the threshold for human. (Also handling array formats just in case).
            const isHuman = typeof result === 'number' ? result < 0.7 : (result[0] > result[1]);

            if (isHuman) {
                setVerification({
                    status: 'human',
                    message: '<span class="text-green-400 text-lg font-bold">✅ HUMAN DETECTED</span>',
                    result
                });
                setTimeout(() => {
                    onVerified(true, result);
                }, 1000);
            } else {
                setVerification({
                    status: 'bot',
                    message: '<span class="text-red-400 text-lg font-bold">🚨 BOT DETECTED</span>',
                    result
                });
                
                // Navigate to bot detected page after a short delay
                setTimeout(() => {
                    navigate('/bot-detected', { state: { result } });
                }, 1500);
            }

        } catch (err) {
            console.error(err);
            setVerification({
                status: 'error',
                message: `Verification Error: ${err.message}`,
                result: null
            });
        }
    };

    const handleInjectBotData = () => {
        // Reset recorder first
        if (window.delbot && window.delbot.Recorder) {
            recorderRef.current = new window.delbot.Recorder(window.screen.width, window.screen.height);
        } else {
            recorderRef.current.clear();
        }

        let time = Date.now();
        let x = 100;
        let y = 100;

        // Bots often move in perfectly straight mathematical lines with precise intervals
        for (let i = 0; i < 150; i++) {
            recorderRef.current.addRecord({
                time: time,
                x: x,
                y: y,
                type: "Move"
            });

            time += 16.6; // ~60fps mechanical exact precision
            x += 4;       // Linear x movement
            y += 2;       // Linear y movement
        }
        
        setDataPoints(recorderRef.current.getRecords().length);
        setVerification({
            status: 'idle',
            message: '🤖 Synthetically generated linear bot data loaded! Click \'Verify\'.',
            result: null
        });
    };

    if (!isOpen) return null;

    return (
        <div className="bot-modal-overlay">
            <div className="bot-modal-content">
                <div className="bot-modal-header">
                    <h2>Delbot-Mouse AI Detection</h2>
                    <p>Move your cursor naturally inside the box below to generate telemetry. The TensorFlow model will evaluate your movement to predict if you are a Human or a Bot.</p>
                </div>
                
                <div className="bot-modal-body">
                    <div className="telemetry-box" onMouseMove={handleMouseMove}>
                        <div className="telemetry-hint">
                            Hover and move your mouse around here
                        </div>
                        <div className="telemetry-coords">
                            X: {mousePoint.x} | Y: {mousePoint.y}
                        </div>
                    </div>

                    <div className="controls-row">
                        <div className="data-points-badge">
                            Data Points: <b>{dataPoints}</b>/50
                        </div>
                        <div style={{ flex: 1 }}></div>
                        <button className="inject-btn" onClick={handleInjectBotData}>
                            🤖 Inject Bot Data
                        </button>
                        <button className="clear-btn" onClick={clearTelemetry}>
                            Clear
                        </button>
                    </div>

                    <button 
                        className="verify-btn" 
                        onClick={verifyMovements}
                        disabled={verification.status === 'verifying'}
                    >
                        {verification.status === 'verifying' ? 'Verifying...' : 'Verify Movements with AI'}
                    </button>

                    <div className="analysis-result">
                        <div className="result-header">ANALYSIS RESULT</div>
                        <div className={`result-content ${verification.status}`}>
                            <div className="flex flex-col gap-2 w-full">
                                <span dangerouslySetInnerHTML={{ __html: verification.message }}></span>
                                {verification.result && (
                                    <>
                                        <span className="text-xs text-slate-400 mt-2">Raw Probability Score (Closer to 1 = Bot):</span>
                                        <pre style={{textAlign: 'left', fontSize: '10px'}}>{JSON.stringify(verification.result, null, 2)}</pre>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <button className="close-modal-btn" onClick={onClose}>Cancel</button>
            </div>
        </div>
    );
}

export default BotDetectionModal;
