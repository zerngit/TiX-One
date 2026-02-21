import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import './App.css';
import Home from './components/Home';
import MyTicket from './components/MyTicket';
import Scanner from './components/Scanner';
import Marketplace from './components/Marketplace';
import Checkout from './components/Checkout';
import BotDetected from './components/BotDetected';

function App() {
    return (
        <Router>
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/my-ticket" element={<MyTicket />} />
                <Route path="/scanner" element={<Scanner />} />
                <Route path="/marketplace" element={<Marketplace />} />
                <Route path="/buy" element={<Checkout />} />
                <Route path="/bot-detected" element={<BotDetected />} />
            </Routes>
        </Router>
    );
}

export default App;