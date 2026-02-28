/* eslint-disable no-console */

require('dotenv').config();

// Allow requiring TypeScript files directly from the frontend src folder
require('ts-node').register({ transpileOnly: true });

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { createHmac, createPrivateKey, sign: cryptoSign } = require('crypto');
const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionsBitField,
} = require('discord.js');
const axios = require('axios');
const { Duffel } = require('@duffel/api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { concerts } = require('../../src/data/concerts');

// Duffel client — initialised once; safe to call before .env is validated.
const duffel = new Duffel({ token: process.env.DUFFEL_ACCESS_TOKEN || '' });

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const PORT = Number(process.env.PORT || 8787);

if (!DISCORD_TOKEN) {
  throw new Error('Missing env var: DISCORD_TOKEN');
}
if (!GUILD_ID) {
  throw new Error('Missing env var: GUILD_ID');
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
  console.warn('[ai] GEMINI_API_KEY not set — AI concierge will be disabled');
}
const genAI = GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here'
  ? new GoogleGenerativeAI(GEMINI_API_KEY)
  : null;

// ── Additional tool API keys ──────────────────────────────────────────────────
function keyOk(val, placeholder) {
  return val && val !== placeholder;
}
if (!keyOk(process.env.GEOAPIFY_API_KEY,            'your_geoapify_api_key_here'))            console.warn('[ai] GEOAPIFY_API_KEY not set');
if (!keyOk(process.env.OPENWEATHER_API_KEY,          'your_openweather_api_key_here'))          console.warn('[ai] OPENWEATHER_API_KEY not set');
if (!keyOk(process.env.DUFFEL_ACCESS_TOKEN,          'duffel_test_your_token_here'))            console.warn('[ai] DUFFEL_ACCESS_TOKEN not set');
if (!keyOk(process.env.SETLISTFM_API_KEY,            'your_setlistfm_api_key_here'))            console.warn('[ai] SETLISTFM_API_KEY not set');
// Transit (calculate_transit) reuses GEOAPIFY_API_KEY — no extra key needed.

const app = express();

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN;
const isProd = process.env.NODE_ENV === 'production';

if (!isProd) {
  app.use((req, _res, next) => {
    const origin = req.headers.origin ? String(req.headers.origin) : '';
    console.log(`[api] ${req.method} ${req.path} origin=${origin}`);
    next();
  });
}

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser tools (curl/postman) with no Origin.
      if (!origin) return callback(null, true);

      // In production, lock down to explicit origin if provided.
      if (isProd) {
        if (FRONTEND_ORIGIN && origin === FRONTEND_ORIGIN) return callback(null, true);
        if (!FRONTEND_ORIGIN && origin === 'http://localhost:5173') return callback(null, true);
        return callback(new Error(`CORS blocked for origin: ${origin}`));
      }

      // In local dev, allow any origin to simplify hackathon/dev setups.
      return callback(null, true);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(express.json({ limit: '256kb' }));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let readyResolve;
let readyReject;
const readyPromise = new Promise((resolve, reject) => {
  readyResolve = resolve;
  readyReject = reject;
});

client.once('ready', () => {
  console.log(`[discord] logged in as ${client.user.tag}`);
  readyResolve();
});

client.on('error', (err) => {
  console.error('[discord] client error', err);
});

client
  .login(DISCORD_TOKEN)
  .catch((err) => {
    console.error('[discord] login failed', err);
    readyReject(err);
  });

function slugifyChannelPart(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function shortTicketId(ticketId) {
  const compact = String(ticketId || '').replace(/[^a-zA-Z0-9]/g, '');
  if (compact.length <= 8) return compact;
  return compact.slice(-8);
}

async function getGuildOrThrow() {
  await readyPromise;

  const guild = await client.guilds.fetch(GUILD_ID);
  if (!guild) throw new Error('Guild not found');
  return guild;
}

async function findExistingSquadChannel(guild, concertId) {
  const channels = await guild.channels.fetch();
  const needle = `ConcertID: ${concertId}`;

  for (const channel of channels.values()) {
    if (!channel) continue;
    if (channel.type !== ChannelType.GuildText) continue;
    if (typeof channel.topic !== 'string') continue;
    if (channel.topic.includes(needle)) return channel;
  }

  return null;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/create-squad', async (req, res) => {
  try {
    const { ticketId, concertName, concertId } = req.body || {};

    if (!ticketId || !concertName) {
      return res.status(400).json({
        error: 'Missing required fields: ticketId, concertName',
      });
    }

    const guild = await getGuildOrThrow();

    // Reuse existing squad channel for the same concert if it already exists.
    const existing = concertId ? await findExistingSquadChannel(guild, concertId) : null;
    if (existing) {
      const invite = await existing.createInvite({
        maxAge: 0,
        maxUses: 0,
        unique: true,
        reason: 'TiX-One squad invite (reuse existing channel)',
      });

      return res.json({ inviteUrl: invite.url, channelId: existing.id });
    }

    const concertSlug = slugifyChannelPart(concertName);
    const concertIdSlug = slugifyChannelPart(concertId || 'x');

    let baseName = `squad-${concertIdSlug}-${concertSlug || 'concert'}`;
    if (baseName.length > 90) baseName = baseName.slice(0, 90);

    const topic = `TiX-One Squad Room — Concert: ${concertName} | ConcertID: ${concertId || ''} | TiX-One Ticket ID: ${ticketId}`;

    // Create the channel.
    const channel = await guild.channels.create({
      name: baseName,
      type: ChannelType.GuildText,
      topic,
      reason: `TiX-One create-squad for ticketId=${ticketId}`,
    });

    // Optional: ensure the bot can create invites and send messages.
    // (If it can't, we'll fail on invite creation or send below.)
    const me = guild.members.me;
    if (me) {
      const perms = channel.permissionsFor(me);
      if (
        !perms?.has(PermissionsBitField.Flags.CreateInstantInvite) ||
        !perms?.has(PermissionsBitField.Flags.SendMessages)
      ) {
        console.warn(
          '[discord] bot may be missing permissions CreateInstantInvite and/or SendMessages in channel',
          channel.id,
        );
      }
    }

    // 💥 Generate the very first AI Icebreaker dynamically!
    if (genAI && concertId) {
      try {
        const concert = concerts.find((c) => c.id === concertId);
        if (concert) {
          const rawPrompt = fs.readFileSync(path.join(__dirname, 'prompt.md'), 'utf8');
          const systemInstruction = rawPrompt
            .replace('{{TITLE}}', concert.title)
            .replace('{{ARTIST}}', concert.artist)
            .replace('{{GENRE}}', concert.genre)
            .replace('{{VENUE}}', concert.venue)
            .replace('{{LOCATION}}', concert.location)
            .replace('{{REGION}}', concert.region)
            .replace('{{DATE}}', concert.date)
            .replace('{{TIME}}', concert.time)
            .replace('{{PRICE}}', concert.price)
            .replace('{{DESCRIPTION}}', concert.description);

          // The "Invisible Trigger" telling the AI to speak first
          const initialPrompt = `${systemInstruction}\n\n=== CHAT HISTORY ===\nSystem: A new squad room was just created. The first human ticket holder has entered the room, but hasn't spoken yet. You are the AI Concierge. Speak first! Welcome them to the ${concert.title} squad, hype them up, and ask a fun icebreaker question to find out their concert vibe.\n\nConcierge (You):`;

          const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
          const result = await model.generateContent(initialPrompt);
          const reply = result.response.text().trim();

          // Send the AI's custom icebreaker!
          if (!reply.includes('[SILENCE]')) {
            await channel.send(reply);
          } else {
             // Failsafe just in case the AI bugs out
             await channel.send(`Welcome to the TiX-One Squad for ${concertName}! Your AI Concierge is here. Say hi!`);
          }
        }
      } catch (err) {
        console.error('[ai] Failed to generate first greeting:', err);
        await channel.send(`Welcome to the TiX-One Squad for ${concertName}! Say hi to start the chat!`);
      }
    } else {
       // Failsafe if API key is missing
       await channel.send(`Welcome to the TiX-One Squad for ${concertName}!`);
    }

    // Create a never-expiring, unlimited-use invite.
    const invite = await channel.createInvite({
      maxAge: 0,
      maxUses: 0,
      unique: true,
      reason: 'TiX-One squad invite',
    });

    return res.json({ inviteUrl: invite.url, channelId: channel.id });
  } catch (err) {
    console.error('[api] /api/create-squad failed', err);
    const isProd = process.env.NODE_ENV === 'production';
    const details = !isProd
      ? {
          message: err?.message,
          code: err?.code,
          status: err?.status,
        }
      : undefined;

    return res.status(500).json({
      error: 'Failed to create squad room',
      ...(details ? { details } : {}),
    });
  }
});

// ─── SPOTIFY OAUTH & FAN SCORING ────────────────────────────────────────────
// 50/40/10 scoring: long-term top artists (50) + track variety (40) + recent plays (10)
// Resistant to Sybil attacks — all signals require multi-year genuine listening history.

const SPOTIFY_CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI  = process.env.SPOTIFY_REDIRECT_URI;
const FRONTEND_URL          = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';

const SPOTIFY_SCOPES = 'user-top-read user-read-recently-played';

// ── Ed25519 fan-purchase signing ─────────────────────────────────────────────
const BACKEND_ED25519_PRIVATE_KEY = process.env.BACKEND_ED25519_PRIVATE_KEY;
const BACKEND_ED25519_PUBLIC_KEY  = process.env.BACKEND_ED25519_PUBLIC_KEY;
const FAN_TOKEN_HMAC_SECRET = process.env.FAN_TOKEN_HMAC_SECRET || 'dev-hmac-secret-change-me';

if (!BACKEND_ED25519_PRIVATE_KEY || !BACKEND_ED25519_PUBLIC_KEY) {
  console.warn('[crypto] BACKEND_ED25519_PRIVATE_KEY / PUBLIC_KEY not set — run scripts/3-init-verifier.sh');
}
if (FAN_TOKEN_HMAC_SECRET === 'dev-hmac-secret-change-me') {
  console.warn('[crypto] FAN_TOKEN_HMAC_SECRET is using default — run scripts/3-init-verifier.sh');
}

/** Load the Ed25519 private key from raw seed hex stored in .env */
function getEd25519PrivateKey() {
  if (!BACKEND_ED25519_PRIVATE_KEY || !BACKEND_ED25519_PUBLIC_KEY) return null;
  return createPrivateKey({
    key: {
      kty: 'OKP',
      crv: 'Ed25519',
      d: Buffer.from(BACKEND_ED25519_PRIVATE_KEY, 'hex').toString('base64url'),
      x: Buffer.from(BACKEND_ED25519_PUBLIC_KEY,  'hex').toString('base64url'),
    },
    format: 'jwk',
  });
}

/**
 * Sign a fan-purchase message: wallet_bytes (32) || concert_object_id_bytes (32)
 * Returns a 64-byte Buffer (Ed25519 signature).
 */
function signFanPurchase(walletAddress, concertObjectId) {
  const key = getEd25519PrivateKey();
  if (!key) throw new Error('Ed25519 signing key not configured. Run scripts/3-init-verifier.sh.');
  const walletBytes  = Buffer.from(walletAddress.replace(/^0x/, ''), 'hex');
  const concertBytes = Buffer.from(concertObjectId.replace(/^0x/, ''), 'hex');
  const msg = Buffer.concat([walletBytes, concertBytes]);
  return cryptoSign(null, msg, key); // 64-byte Ed25519 signature
}

/**
 * Create a short-lived HMAC fan-approval token.
 * Payload: "eventId:score:expiresAtMs"
 * Token:   base64url(payload + "." + hmac(payload))
 */
function createFanToken(eventId, score) {
  const exp     = Date.now() + 10 * 60 * 1000; // 10 minutes
  const payload = `${eventId}:${score}:${exp}`;
  const hmac    = createHmac('sha256', FAN_TOKEN_HMAC_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}.${hmac}`).toString('base64url');
}

/**
 * Verify a fan-approval token. Returns { eventId, score } or null if invalid/expired.
 */
function verifyFanToken(token) {
  try {
    const decoded        = Buffer.from(String(token), 'base64url').toString('utf8');
    const lastDot        = decoded.lastIndexOf('.');
    const payload        = decoded.slice(0, lastDot);
    const receivedHmac   = decoded.slice(lastDot + 1);
    const expectedHmac   = createHmac('sha256', FAN_TOKEN_HMAC_SECRET).update(payload).digest('hex');
    if (receivedHmac !== expectedHmac) return null;
    const [eventId, scoreStr, expStr] = payload.split(':');
    if (Date.now() > parseInt(expStr, 10)) return null;
    return { eventId, score: parseInt(scoreStr, 10) };
  } catch {
    return null;
  }
}

// ── Dynamic concert list — fetched from Supabase, cached for 5 minutes ───────
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Static fallback (used when Supabase is unreachable)
const CONCERTS_FALLBACK = concerts.map((c) => ({ id: c.id, artist: c.artist }));

let _concertsCache     = null;
let _concertsCacheTime = 0;
const CACHE_TTL_MS     = 5 * 60 * 1000; // 5 minutes

async function getConcerts() {
  if (_concertsCache && Date.now() - _concertsCacheTime < CACHE_TTL_MS) {
    return _concertsCache;
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('[concerts] SUPABASE_URL/SUPABASE_ANON_KEY not set — using static fallback');
    return CONCERTS_FALLBACK;
  }
  try {
    const res = await axios.get(`${SUPABASE_URL}/rest/v1/concerts`, {
      params: { select: 'id,artist', order: 'id.asc' },
      headers: {
        apikey:        SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    const data = res.data;
    if (!Array.isArray(data) || data.length === 0) throw new Error('empty response');
    _concertsCache     = data.map((c) => ({ id: String(c.id), artist: c.artist }));
    _concertsCacheTime = Date.now();
    console.log(`[concerts] loaded ${_concertsCache.length} concerts from Supabase`);
    return _concertsCache;
  } catch (err) {
    console.warn('[concerts] Supabase fetch failed, using static fallback:', err?.message);
    return CONCERTS_FALLBACK;
  }
}

/**
 * GET /auth-url?eventId=1&artistName=Jay+Chou
 * Returns the Spotify OAuth URL. State encodes eventId|artistName.
 */
app.get('/auth-url', (req, res) => {
  const { eventId, artistName } = req.query;
  if (!eventId || !artistName) {
    return res.status(400).json({ error: 'Missing eventId or artistName' });
  }
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_REDIRECT_URI) {
    return res.status(500).json({ error: 'Spotify credentials not configured' });
  }
  const state = `${eventId}|${encodeURIComponent(artistName)}`;
  const url =
    `https://accounts.spotify.com/authorize` +
    `?client_id=${SPOTIFY_CLIENT_ID}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(SPOTIFY_REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SPOTIFY_SCOPES)}` +
    `&state=${encodeURIComponent(state)}`;
  res.json({ url });
});

/**
 * GET /auth-url-global
 * Returns Spotify OAuth URL for global fan-check (all concerts at once).
 */
app.get('/auth-url-global', (req, res) => {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_REDIRECT_URI) {
    return res.status(500).json({ error: 'Spotify credentials not configured' });
  }
  const url =
    `https://accounts.spotify.com/authorize` +
    `?client_id=${SPOTIFY_CLIENT_ID}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(SPOTIFY_REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SPOTIFY_SCOPES)}` +
    `&state=global`;
  res.json({ url });
});

/**
 * GET /sign-fan-purchase?wallet=0x...&concertObjectId=0x...&fanToken=...
 * Verifies the HMAC fan token, then returns an Ed25519 signature
 * over (wallet_bytes || concert_object_id_bytes) for use in buy_verified_fan_ticket.
 */
app.get('/sign-fan-purchase', (req, res) => {
  const { wallet, concertObjectId, fanToken } = req.query;

  if (!wallet || !concertObjectId || !fanToken) {
    return res.status(400).json({ error: 'Missing wallet, concertObjectId, or fanToken' });
  }

  const tokenData = verifyFanToken(fanToken);
  if (!tokenData) {
    return res.status(403).json({ error: 'Fan token is invalid or expired. Please re-verify via Spotify.' });
  }
  if (tokenData.score < 60) {
    return res.status(403).json({ error: `Fan score ${tokenData.score}/100 is below the 60-point threshold.` });
  }

  try {
    const signature = signFanPurchase(String(wallet), String(concertObjectId));
    console.log(`[sign-fan-purchase] wallet=${wallet} concert=${concertObjectId} score=${tokenData.score} → signed ✅`);
    return res.json({ signature: signature.toString('hex') });
  } catch (err) {
    console.error('[sign-fan-purchase] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /callback?code=X&state=eventId|artistName
 * Exchanges code, scores the user, redirects to frontend with ?score=N.
 */
app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error('[spotify] user denied access:', error);
    return res.redirect(`${FRONTEND_URL}?spotify_error=denied`);
  }
  if (!code || !state) {
    return res.status(400).send('Missing code or state');
  }

  const decoded  = decodeURIComponent(String(state));
  const isGlobal = decoded === 'global';

  let eventId, artistName;
  if (!isGlobal) {
    try {
      const pipeIdx = decoded.indexOf('|');
      eventId    = decoded.slice(0, pipeIdx);
      artistName = decodeURIComponent(decoded.slice(pipeIdx + 1));
    } catch {
      return res.status(400).send('Malformed state parameter');
    }
    if (!eventId || !artistName) {
      return res.status(400).send('Missing eventId or artistName in state');
    }
  }

  try {
    // Exchange authorization code for access token.
    const tokenRes = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type:    'authorization_code',
        code:          String(code),
        redirect_uri:  SPOTIFY_REDIRECT_URI,
        client_id:     SPOTIFY_CLIENT_ID,
        client_secret: SPOTIFY_CLIENT_SECRET,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    const accessToken = tokenRes.data.access_token;
    const spotifyGet  = (url) =>
      axios.get(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10_000, // 10 s — don't hang forever
      });

    // Use allSettled so a timeout on one signal doesn't crash the whole callback.
    const [topArtistsResult, topTracksResult, recentResult] = await Promise.allSettled([
      spotifyGet('https://api.spotify.com/v1/me/top/artists?time_range=long_term&limit=50'),
      spotifyGet('https://api.spotify.com/v1/me/top/tracks?time_range=long_term&limit=50'),
      spotifyGet('https://api.spotify.com/v1/me/player/recently-played?limit=50'),
    ]);

    if (topArtistsResult.status === 'rejected') console.warn('[spotify] top-artists failed:', topArtistsResult.reason?.message);
    if (topTracksResult.status  === 'rejected') console.warn('[spotify] top-tracks failed:',  topTracksResult.reason?.message);
    if (recentResult.status     === 'rejected') console.warn('[spotify] recently-played failed (non-fatal):', recentResult.reason?.message);

    const topArtists  = topArtistsResult.status === 'fulfilled' ? (topArtistsResult.value.data.items || []) : [];
    const topTracks   = topTracksResult.status  === 'fulfilled' ? (topTracksResult.value.data.items  || []) : [];
    const recentItems = recentResult.status      === 'fulfilled' ? (recentResult.value.data.items     || []) : [];

    console.log(`[spotify] top-artists (${topArtists.length}):`, topArtists.slice(0, 5).map(a => a.name));

    /** 50/40/10 score for a single artist name */
    const scoreFor = (name) => {
      const t = name.toLowerCase();
      let s = 0;
      const rank = topArtists.findIndex(a => a.name.toLowerCase() === t);
      if (rank >= 0 && rank < 5)        s += 50;
      else if (rank >= 5 && rank < 20)  s += 35;
      else if (rank >= 20 && rank < 50) s += 20;
      s += Math.min(topTracks.filter(tr => tr.artists.some(a => a.name.toLowerCase() === t)).length * 8, 40);
      s += Math.min(recentItems.filter(i => i.track.artists.some(a => a.name.toLowerCase() === t)).length * 2, 10);
      return s;
    };

    if (isGlobal) {
      // Check every concert and bundle all scores into a single redirect.
      const concertList = await getConcerts();
      const scores = {};
      for (const c of concertList) {
        scores[c.id] = scoreFor(c.artist);
        console.log(`[spotify-global] "${c.artist}" (id=${c.id}) score=${scores[c.id]}`);
      }
      const fanScoresStr = Object.entries(scores).map(([id, s]) => `${id}:${s}`).join(',');
      return res.redirect(`${FRONTEND_URL}/?fan_scores=${encodeURIComponent(fanScoresStr)}`);
    } else {
      const score = scoreFor(artistName);
      console.log(`[spotify] FINAL eventId=${eventId} artist="${artistName}" score=${score}/100`);
      const fanTokenParam = score >= 60 ? `&fanToken=${encodeURIComponent(createFanToken(eventId, score))}` : '';
      return res.redirect(`${FRONTEND_URL}/concert/${eventId}?score=${score}${fanTokenParam}`);
    }

  } catch (err) {
    console.error('[spotify] callback error', err?.response?.data || err?.message || err);
    const fallback = isGlobal
      ? `${FRONTEND_URL}/?spotify_error=1`
      : `${FRONTEND_URL}/concert/${eventId}?score=0&spotify_error=1`;
    return res.redirect(fallback);
  }
});

// ─────────────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[api] listening on http://127.0.0.1:${PORT}`);
});

server.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(
      `[api] Port ${PORT} is already in use. Another backend instance is probably running. ` +
        `Stop it or set a different PORT in .env (e.g. PORT=8788).`,
    );
    process.exit(1);
  }
  console.error('[api] server error', err);
  process.exit(1);
});

// ─── AI CONCIERGE ────────────────────────────────────────────────────────────
// Multi-tool AI concierge. Gemini decides which tools to call; the server
// executes real API requests and feeds the results back in a chat loop.

const PROMPT_PATH = path.join(__dirname, 'prompt.md');

// Per-channel expense ledger (in-memory; resets on server restart).
const expenseLedger = new Map(); // channelId → [{payer, amount, description}]

// ── Tool API implementations ──────────────────────────────────────────────────

/**
 * Geoapify Places API — real cafes, hotels, bars within 2 km of venue coords.
 */
async function findNearbyPlaces({ category, lat, lon }) {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key || key === 'your_geoapify_api_key_here') return 'Geoapify API key not configured.';

  const url =
    `https://api.geoapify.com/v2/places` +
    `?categories=${encodeURIComponent(category)}` +
    `&filter=circle:${lon},${lat},2000&limit=5&apiKey=${key}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geoapify HTTP ${res.status}`);
  const data = await res.json();

  if (!data.features || data.features.length === 0) return 'No places found nearby.';
  return data.features
    .map((f, i) => {
      const p = f.properties;
      const dist = p.distance ? ` (${Math.round(p.distance)}m away)` : '';
      return `${i + 1}. **${p.name || 'Unnamed'}**${dist} — ${p.formatted || p.address_line1 || ''}`;
    })
    .join('\n');
}

/**
 * OpenWeatherMap 5-day/3-hour forecast — weather on concert day.
 */
async function getWeatherForecast({ city, date }) {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key || key === 'your_openweather_api_key_here') return 'OpenWeather API key not configured.';

  const url =
    `https://api.openweathermap.org/data/2.5/forecast` +
    `?q=${encodeURIComponent(city)}&appid=${key}&units=metric&cnt=8`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenWeather HTTP ${res.status}`);
  const data = await res.json();

  const list = data.list || [];
  if (list.length === 0) return 'No weather data available.';
  // Prefer the 18:00 slot (show time); fall back to first entry.
  const entry = list.find((e) => e.dt_txt && e.dt_txt.includes('18:00')) || list[0];
  const desc  = entry.weather?.[0]?.description || 'unknown';
  const temp  = Math.round(entry.main?.temp ?? 0);
  const feels = Math.round(entry.main?.feels_like ?? 0);
  const wind  = Math.round((entry.wind?.speed ?? 0) * 3.6); // m/s → km/h
  return `${city} on ${date}: ${desc}, ${temp}°C (feels like ${feels}°C), wind ${wind} km/h.`;
}

/**
 * Duffel Flight Search — real-time prices, baggage info, and carbon data.
 */
async function searchTravelOptions({ origin, destination, date }) {
  const token = process.env.DUFFEL_ACCESS_TOKEN;
  if (!token || token === 'duffel_test_your_token_here') return 'Duffel API token not configured.';

  try {
    const isoDate = new Date(date).toISOString().slice(0, 10);

    const offerRequest = await duffel.offerRequests.create({
      return_offers: true,
      slices: [{ origin, destination, departure_date: isoDate }],
      passengers: [{ type: 'adult' }],
      cabin_class: 'economy',
    });

    const offers = offerRequest.data.offers || [];
    if (offers.length === 0) return 'No flights found for that route/date.';

    return offers.slice(0, 3).map((o, i) => {
      const price    = o.total_amount;
      const currency = o.total_currency;
      const airline  = o.owner.name;
      const seg      = o.slices[0].segments[0];
      const depart   = seg.departing_at.slice(11, 16);
      const arrive   = seg.arriving_at.slice(11, 16);
      const baggage  = seg.passengers?.[0]?.baggages?.[0]
        ? `${seg.passengers[0].baggages[0].quantity}x ${seg.passengers[0].baggages[0].type}`
        : 'check airline';
      return `${i + 1}. ${airline}: ${depart} ✈️ ${arrive} — ${price} ${currency} (baggage: ${baggage})`;
    }).join('\n');

  } catch (err) {
    console.error('[ai] Duffel error:', err?.message || err);
    return `Flight search unavailable: ${err?.message || 'unknown error'}`;
  }
}

/**
 * Setlist.fm — most recent tour setlist for the artist.
 */
async function getArtistSetlist({ artist }) {
  const key = process.env.SETLISTFM_API_KEY;
  if (!key || key === 'your_setlistfm_api_key_here') return 'Setlist.fm API key not configured.';

  const url = `https://api.setlist.fm/rest/1.0/search/setlists?artistName=${encodeURIComponent(artist)}&p=1`;
  const res = await fetch(url, { headers: { 'x-api-key': key, Accept: 'application/json' } });
  if (!res.ok) return `Setlist.fm search failed (HTTP ${res.status}).`;
  const data = await res.json();

  const setlist = data.setlist?.[0];
  if (!setlist) return `No recent setlists found for ${artist}.`;

  const songs = setlist.sets?.set
    ?.flatMap((s) => s.song || [])
    ?.map((s) => s.name)
    ?.filter(Boolean) || [];
  if (songs.length === 0) return 'Found a recent setlist but no song names were listed.';

  const eventDate = setlist.eventDate || 'unknown date';
  const venue     = setlist.venue?.name || 'unknown venue';
  return (
    `**${artist}** most recent setlist (${eventDate} at ${venue}):\n` +
    songs.map((s, i) => `${i + 1}. ${s}`).join('\n')
  );
}

/**
 * Geoapify Geocode — converts a free-text address into {lat, lon}.
 */
async function geocodeAddress(address, apiKey) {
  const url =
    `https://api.geoapify.com/v1/geocode/search` +
    `?text=${encodeURIComponent(address)}&limit=1&apiKey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geoapify geocode HTTP ${res.status}`);
  const data = await res.json();
  const feat = data.features?.[0];
  if (!feat) throw new Error(`No geocode result for "${address}"`);
  const [lon, lat] = feat.geometry.coordinates;
  return { lat, lon, label: feat.properties.formatted || address };
}

/**
 * Geoapify Routing API — travel time and distance between two addresses.
 * Uses the same GEOAPIFY_API_KEY as find_nearby_places (no extra key needed).
 */
async function calculateTransit({ from, to }) {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key || key === 'your_geoapify_api_key_here') return 'Geoapify API key not configured.';

  // 1. Geocode both endpoints.
  const [origin, dest] = await Promise.all([
    geocodeAddress(from, key),
    geocodeAddress(to, key),
  ]);

  // 2. Request a route. Try "transit" first; fall back to "drive" if unsupported.
  async function fetchRoute(mode) {
    const url =
      `https://api.geoapify.com/v1/routing` +
      `?waypoints=${origin.lat},${origin.lon}|${dest.lat},${dest.lon}` +
      `&mode=${mode}&apiKey=${key}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Geoapify routing HTTP ${res.status}`);
    return res.json();
  }

  let data;
  let mode = 'transit';
  try {
    data = await fetchRoute('transit');
    if (!data.features?.length) throw new Error('no transit route');
  } catch {
    mode = 'drive';
    data = await fetchRoute('drive');
  }

  const leg = data.features?.[0]?.properties;
  if (!leg) return `Could not calculate route from "${from}" to "${to}".`;

  const distKm  = ((leg.distance || 0) / 1000).toFixed(1);
  const mins    = Math.round((leg.time || 0) / 60);
  const modeTag = mode === 'transit' ? 'public transit' : 'by car';
  return (
    `**${origin.label}** → **${dest.label}**\n` +
    `${modeTag}: **${mins} min** (${distKm} km)`
  );
}

/**
 * In-memory squad expense tracker — persists for server lifetime.
 */
function logExpense({ payer, amount, description }, channelId) {
  if (!expenseLedger.has(channelId)) expenseLedger.set(channelId, []);
  const ledger = expenseLedger.get(channelId);
  ledger.push({ payer, amount, description });
  const total     = ledger.reduce((s, e) => s + e.amount, 0);
  const breakdown = ledger.map((e) => `  • ${e.payer}: $${e.amount} — ${e.description}`).join('\n');
  return (
    `✅ Logged! **${payer}** paid **$${amount}** for ${description}.\n\n` +
    `**Squad tab (${ledger.length} item${ledger.length !== 1 ? 's' : ''}, total $${total.toFixed(2)}):**\n` +
    breakdown
  );
}

/**
 * Dispatcher — routes a Gemini function-call to the correct implementation.
 */
async function dispatchTool(name, args, concert, channelId) {
  console.log(`[ai] tool call: ${name}`, JSON.stringify(args));
  switch (name) {
    case 'find_nearby_places':
      return findNearbyPlaces({
        category: args.category,
        lat: args.lat ?? concert.lat,
        lon: args.lon ?? concert.lon,
      });
    case 'get_weather_forecast':
      return getWeatherForecast({ city: args.city, date: args.date });
    case 'search_travel_options':
      return searchTravelOptions({ origin: args.origin, destination: args.destination, date: args.date });
    case 'get_artist_setlist':
      return getArtistSetlist({ artist: args.artist });
    case 'calculate_transit':
      return calculateTransit({ from: args.from, to: args.to });
    case 'log_expense':
      return logExpense({ payer: args.payer, amount: args.amount, description: args.description }, channelId);
    default:
      return `Unknown tool: ${name}`;
  }
}

// ── Tool registry passed to every Gemini model instance ──────────────────────
const SQUAD_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'find_nearby_places',
        description:
          'Finds cafes, hotels, bars, or restaurants near the concert venue using Geoapify. ' +
          'Use when fans ask about meet-up spots, pre-concert food, drinks, or accommodation.',
        parameters: {
          type: 'OBJECT',
          properties: {
            category: {
              type: 'STRING',
              description:
                "Geoapify place category, e.g. 'catering.cafe', 'catering.bar', " +
                "'catering.restaurant', or 'accommodation.hotel'",
            },
            lat: { type: 'NUMBER', description: 'Venue latitude (omit to use concert venue lat)' },
            lon: { type: 'NUMBER', description: 'Venue longitude (omit to use concert venue lon)' },
          },
          required: ['category'],
        },
      },
      {
        name: 'get_weather_forecast',
        description:
          'Gets real-time weather for the concert city on show day. ' +
          'Use when fans ask about weather, outdoor conditions, or what to wear.',
        parameters: {
          type: 'OBJECT',
          properties: {
            city: { type: 'STRING', description: 'City name, e.g. "Los Angeles"' },
            date: { type: 'STRING', description: 'Concert date, e.g. "March 27, 2026"' },
          },
          required: ['city', 'date'],
        },
      },
      {
        name: 'search_travel_options',
        description:
          'Fetches real flight prices, baggage info, and schedules via Duffel. ' +
          'Use when fans ask about flying in, travel costs, or trip planning.',
        parameters: {
          type: 'OBJECT',
          properties: {
            origin:      { type: 'STRING', description: 'Departure IATA airport code, e.g. "KUL"' },
            destination: { type: 'STRING', description: 'Destination IATA airport code, e.g. "LAX"' },
            date:        { type: 'STRING', description: 'Departure date, e.g. "March 26, 2026"' },
          },
          required: ['origin', 'destination', 'date'],
        },
      },
      {
        name: 'get_artist_setlist',
        description:
          "Retrieves songs from the artist's most recent tour setlist. " +
          "Use to hype fans up, answer 'what songs will they play?', or start sing-along threads.",
        parameters: {
          type: 'OBJECT',
          properties: {
            artist: { type: 'STRING', description: 'Artist or band name' },
          },
          required: ['artist'],
        },
      },
      {
        name: 'calculate_transit',
        description:
          'Estimates public-transit travel time and distance from a hotel or meeting point to the concert venue. ' +
          "Use when fans ask 'how far is it?' or 'how do we get there?'.",
        parameters: {
          type: 'OBJECT',
          properties: {
            from: { type: 'STRING', description: 'Origin address or place name' },
            to:   { type: 'STRING', description: 'Destination address (usually the concert venue)' },
          },
          required: ['from', 'to'],
        },
      },
      {
        name: 'log_expense',
        description:
          'Logs who paid for what in the squad (hotel splits, ride shares, food). ' +
          'Use when a user mentions a payment or asks to track group costs.',
        parameters: {
          type: 'OBJECT',
          properties: {
            payer:       { type: 'STRING', description: 'Name or username of who paid' },
            amount:      { type: 'NUMBER', description: 'Amount in USD' },
            description: { type: 'STRING', description: 'What the expense was for' },
          },
          required: ['payer', 'amount', 'description'],
        },
      },
    ],
  },
];

// ── messageCreate handler ─────────────────────────────────────────────────────

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.channel.name.startsWith('squad-')) return;
  if (!genAI) return;

  try {
    // Extract ConcertID from the channel topic.
    const topic    = message.channel.topic || '';
    const idMatch  = topic.match(/ConcertID:\s*(\S+)/);
    const concertId = idMatch ? idMatch[1] : null;
    const concert   = concertId ? concerts.find((c) => c.id === concertId) : null;

    if (!concert) {
      console.warn(`[ai] No concert found for ConcertID=${concertId} in #${message.channel.name}`);
      return;
    }

    // Build system prompt from prompt.md + concert details.
    const rawPrompt        = fs.readFileSync(PROMPT_PATH, 'utf8');
    const systemInstruction = rawPrompt
      .replace('{{TITLE}}',       concert.title)
      .replace('{{ARTIST}}',      concert.artist)
      .replace('{{GENRE}}',       concert.genre)
      .replace('{{VENUE}}',       concert.venue)
      .replace('{{LOCATION}}',    concert.location)
      .replace('{{REGION}}',      concert.region)
      .replace('{{DATE}}',        concert.date)
      .replace('{{TIME}}',        concert.time)
      .replace('{{PRICE}}',       concert.price)
      .replace('{{DESCRIPTION}}', concert.description);

    // Fetch last 50 messages as plain-text chat history.
    const fetched = await message.channel.messages.fetch({ limit: 50 });
    const history = Array.from(fetched.values())
      .reverse()
      .map((msg) => {
        const sender = msg.author.id === client.user.id ? 'Concierge (You)' : msg.author.username;
        return `${sender}: ${msg.content}`;
      })
      .join('\n');

    const finalPrompt = `${systemInstruction}\n\n=== CHAT HISTORY ===\n${history}\n\nConcierge (You):`;

    await message.channel.sendTyping();

    // Initialise a chat session with the full toolbox.
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', tools: SQUAD_TOOLS });
    const chat  = model.startChat();

    let result   = await chat.sendMessage(finalPrompt);
    let response = result.response;

    // ── Multi-turn function-calling loop (max 4 rounds) ───────────────────
    let rounds = 0;
    while (rounds < 4) {
      const calls = response.functionCalls ? response.functionCalls() : [];
      if (!calls || calls.length === 0) break;

      rounds++;
      await message.channel.sendTyping();

      // Execute all requested tools in parallel.
      const functionResponses = await Promise.all(
        calls.map(async (call) => {
          let toolResult;
          try {
            toolResult = await dispatchTool(call.name, call.args, concert, message.channel.id);
          } catch (toolErr) {
            console.error(`[ai] Tool ${call.name} failed:`, toolErr);
            toolResult = `Tool error: ${toolErr.message}`;
          }
          return { functionResponse: { name: call.name, response: { result: toolResult } } };
        }),
      );

      // Send tool results back to Gemini for synthesis.
      result   = await chat.sendMessage(functionResponses);
      response = result.response;
    }
    // ── End function-calling loop ─────────────────────────────────────────

    const reply = response.text().trim();
    if (!reply || reply.includes('[SILENCE]')) return;

    // Discord enforces a 2 000-character message limit — split if needed.
    if (reply.length <= 2000) {
      await message.channel.send(reply);
    } else {
      for (let i = 0; i < reply.length; i += 1990) {
        await message.channel.send(reply.slice(i, i + 1990));
      }
    }
  } catch (err) {
    console.error('[ai] messageCreate error', err);
  }
});
