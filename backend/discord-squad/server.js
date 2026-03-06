/* eslint-disable no-console */

require('dotenv').config();

// Allow requiring TypeScript files directly from the frontend src folder
require('ts-node').register({ transpileOnly: true });

const categoryId=process.env.DISCORD_CATEGORY_ID;
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);
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

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/create-squad', async (req, res) => {
  try {
    const { squadId, concertId, concertName } = req.body || {};

    if (!squadId || !concertId || !concertName) {
      return res.status(400).json({
        error: 'Missing required fields: squadId, concertId, concertName',
      });
    }

    const guild = await getGuildOrThrow();

    // Every squad gets its own unique private channel — no reuse.
    const squadSlug = slugifyChannelPart(squadId).slice(0, 8);
    let baseName = `squad-${squadSlug}`;
    if (baseName.length > 90) baseName = baseName.slice(0, 90);

    const topic = `TiX-One VIP Squad Room | SquadID: ${squadId} | ConcertID: ${concertId}`;

    // Create the channel.
    const channel = await guild.channels.create({
      name: baseName,
      type: ChannelType.GuildText,
      parent:categoryId,
      topic,
      reason: `TiX-One create-squad for squadId=${squadId}`,
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

          const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
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

    // Write the Discord channel ID back to the squads row in Supabase
    await supabase
      .from('squads')
      .update({ discord_channel_id: channel.id, invite_url: invite.url })
      .eq('id', squadId);

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

// ─── AI Squad Matching ────────────────────────────────────────────────────────
app.post('/api/analyze-squads', async (req, res) => {
  if (!genAI) {
    return res.status(503).json({ error: 'AI service not available — GEMINI_API_KEY not set' });
  }

  const { vibeText, squads } = req.body;
  if (!vibeText || !Array.isArray(squads)) {
    return res.status(400).json({ error: 'vibeText (string) and squads (array) are required' });
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

    const squadSummaries = squads
      .map((sq) => `id:${sq.id} | name:${sq.name} | vibe:${sq.vibe}`)
      .join('\n');

    const prompt = `You are a concert squad matching assistant.\n\nUser's vibe: "${vibeText}"\n\nAvailable squads:\n${squadSummaries}\n\nAnalyze the user's vibe against every squad listed above. \nReturn a JSON array of ALL squads with the following fields:\n- id (string)\n- matchScore (integer 1-99)\n- reason (1 short sentence explaining the match, max 15 words)\n\nIMPORTANT: Return ONLY the JSON array. If you use quotes inside the "reason", you MUST escape them with a backslash (e.g. \\").`;

    const result = await model.generateContent(prompt);
    const rawText = result.response.text().trim();

    const startBracket = rawText.indexOf('[');
    const endBracket = rawText.lastIndexOf(']');
    if (startBracket === -1 || endBracket === -1) {
      throw new Error('AI did not return a valid JSON array');
    }

    const parsed = JSON.parse(rawText.substring(startBracket, endBracket + 1));
    return res.json(parsed);
  } catch (err) {
    console.error('[ai] analyze-squads error:', err);
    return res.status(500).json({ error: 'AI analysis failed', details: err.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
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
 * squad expense tracker — persisted in MongoDB.
 */
async function logExpense({ payer, amount, description }, channelId) {
  await supabase.from('expenses').insert({ channel_id: channelId, payer, amount, description });

  const { data: ledger = [] } = await supabase
    .from('expenses')
    .select('payer, amount, description')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: true });
  const rows     = ledger || [];
  const total     = rows.reduce((s, e) => s + Number(e.amount), 0);
  const breakdown = rows.map((e) => `  • ${e.payer}: $${e.amount} — ${e.description}`).join('\n');
  return (
    `✅ Logged! **${payer}** paid **$${amount}** for ${description}.\n\n` +
    `**Squad tab (${rows.length} item${rows.length !== 1 ? 's' : ''}, total $${total.toFixed(2)}):**\n` +
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
