/**
 * seed-attendees.js
 * Inserts sample attendees into MongoDB so squad matching has people to group.
 * Run once:  node seed-attendees.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Attendee = require('./models/Attendee');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/tix_one_squads';

const SAMPLE_ATTENDEES = [
  // ── Concert 1: The Midnight Echoes — Neon Dreams Tour ──
  {
    walletAddress: '0xAA11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11',
    concertId: '1',
    bio: 'Front row or nothing! I scream every lyric. Looking for high-energy squad mates who love dancing nonstop.',
  },
  {
    walletAddress: '0xBB22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22',
    concertId: '1',
    bio: 'Chill vibes only. Want to grab drinks before the show and stand near the back with good company.',
  },
  {
    walletAddress: '0xCC33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33',
    concertId: '1',
    bio: 'Mosh pit crew! Going solo from Penang, want to meet people who love crowd surfing and headbanging.',
  },
  {
    walletAddress: '0xDD44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44',
    concertId: '1',
    bio: 'First concert ever! Super excited, want to meet friendly people to vibe with. Love synthwave!',
  },
  {
    walletAddress: '0xEE55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55',
    concertId: '1',
    bio: 'Photography enthusiast going to capture the lights. Looking for people who want drinks before the show.',
  },

  // ── Concert 2 ──
  {
    walletAddress: '0xFF66ff66ff66ff66ff66ff66ff66ff66ff66ff66ff66ff66ff66ff66ff66ff66',
    concertId: '2',
    bio: 'Huge rock fan. Want to find people to split a hotel room near the venue!',
  },
  {
    walletAddress: '0xAA77aa77aa77aa77aa77aa77aa77aa77aa77aa77aa77aa77aa77aa77aa77aa77',
    concertId: '2',
    bio: 'Traveling from KL. Looking for carpool buddies or people to meet up for dinner before the gig.',
  },
  {
    walletAddress: '0xBB88bb88bb88bb88bb88bb88bb88bb88bb88bb88bb88bb88bb88bb88bb88bb88',
    concertId: '2',
    bio: 'VIP section hype! Let\'s get front row seats and go wild.',
  },

  // ── Concert 3 ──
  {
    walletAddress: '0xCC99cc99cc99cc99cc99cc99cc99cc99cc99cc99cc99cc99cc99cc99cc99cc99',
    concertId: '3',
    bio: 'Super into jazz fusion. Want a squad to geek out about the music theory with.',
  },
  {
    walletAddress: '0xDDAAddaaddaaddaaddaaddaaddaaddaaddaaddaaddaaddaaddaaddaaddaaddaa',
    concertId: '3',
    bio: 'Casual listener, love the atmosphere. Looking for relaxed people to enjoy the evening with.',
  },
  {
    walletAddress: '0xEEBBeebbeebbeebbeebbeebbeebbeebbeebbeebbeebbeebbeebbeebbeebbeebb',
    concertId: '3',
    bio: 'First time seeing this artist live. Flying in from Singapore, need local food recommendations!',
  },
];

async function seed() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('[seed] Connected to MongoDB');

    let inserted = 0;
    for (const att of SAMPLE_ATTENDEES) {
      try {
        await Attendee.findOneAndUpdate(
          { walletAddress: att.walletAddress, concertId: att.concertId },
          { ...att, isMatched: false, squadId: null },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        inserted++;
      } catch (e) {
        console.warn(`[seed] Skipped ${att.walletAddress.slice(0, 10)}… (${e.message})`);
      }
    }

    console.log(`[seed] ✅ Inserted/updated ${inserted} sample attendees across concerts 1, 2, 3`);
  } catch (err) {
    console.error('[seed] Failed:', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('[seed] Done');
  }
}

seed();
