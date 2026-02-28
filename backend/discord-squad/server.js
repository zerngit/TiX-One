/* eslint-disable no-console */

require('dotenv').config();

// Allow requiring TypeScript files directly from the frontend src folder
require('ts-node').register({ transpileOnly: true });

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const connectDB = require('./db');
const Squad = require('./models/Squad');
const Expense = require('./models/Expense');
const Attendee = require('./models/Attendee');
const MatchedSquad = require('./models/MatchedSquad');
const SquadMessage = require('./models/SquadMessage');
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
  // Try to find in database first
  const squad = await Squad.findOne({ concertId });
  if (squad) {
    try {
      const channel = await guild.channels.fetch(squad.channelId);
      if (channel) return channel;
    } catch (e) {
      console.log(`[db] Saved channel ${squad.channelId} not found in Discord, deleting record`);
      await Squad.deleteOne({ _id: squad._id });
    }
  }

  // Fallback to searching guild channels by topic (legacy/sync)
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

    // Save to MongoDB
    await Squad.create({
      concertId,
      concertName,
      channelId: channel.id,
      channelName: channel.name,
      inviteUrl: invite.url
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

// ─── SQUAD MATCHING (AI Matchmaking) ──────────────────────────────────────────

/**
 * POST /api/squad-matching/join
 * Body: { walletAddress, concertId, bio }
 * Registers an attendee for AI-based squad matching.
 */
app.post('/api/squad-matching/join', async (req, res) => {
  try {
    const { walletAddress, concertId, bio } = req.body || {};

    if (!walletAddress || !concertId || !bio) {
      return res.status(400).json({ error: 'Missing required fields: walletAddress, concertId, bio' });
    }
    if (bio.length > 200) {
      return res.status(400).json({ error: 'Bio must be 200 characters or fewer' });
    }

    // Upsert — let a user update their bio if they re-join
    const attendee = await Attendee.findOneAndUpdate(
      { walletAddress, concertId },
      { walletAddress, concertId, bio, isMatched: false, squadId: null },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return res.json({ ok: true, attendee });
  } catch (err) {
    console.error('[api] /api/squad-matching/join failed', err);
    return res.status(500).json({ error: 'Failed to join squad matching' });
  }
});

/**
 * POST /api/squad-matching/run
 * Body: { concertId }
 * Triggers Gemini-based matchmaking for all unmatched attendees of a concert.
 */
app.post('/api/squad-matching/run', async (req, res) => {
  try {
    const { concertId } = req.body || {};
    if (!concertId) {
      return res.status(400).json({ error: 'Missing required field: concertId' });
    }
    if (!genAI) {
      return res.status(503).json({ error: 'Gemini API key not configured — AI matching unavailable' });
    }

    // 1. Fetch all unmatched attendees for this concert
    const unmatched = await Attendee.find({ concertId, isMatched: false });
    if (unmatched.length < 2) {
      return res.json({ ok: true, message: 'Not enough unmatched attendees to form squads', squadsCreated: 0 });
    }

    const attendeePayload = unmatched.map((a) => ({
      wallet: a.walletAddress,
      bio: a.bio,
    }));

    // 2. Build the AI prompt
    const concert = concerts.find((c) => c.id === concertId);
    const concertLabel = concert ? concert.title : concertId;

    const systemPrompt =
      'You are a matchmaking algorithm for a concert ticketing system. ' +
      'Your job is to read user bios and group them into squads of 3 to 5 people ' +
      'based on similar interests, concert goals, and "vibes". ' +
      'You must strictly output valid JSON. Do not include markdown formatting, ' +
      'backticks, or any conversational text. ' +
      'If a user does not fit well with others, leave them in an "unmatched" array.';

    const userPrompt =
      `Here is the list of attendees waiting for a squad for ${concertLabel}:\n` +
      JSON.stringify(attendeePayload, null, 2) +
      '\n\nGroup these users. Output this exact JSON format:\n' +
      '{\n' +
      '  "squads": [\n' +
      '    { "groupVibe": "Drinks & Chill", "members": ["0x123...", "0xABC..."] },\n' +
      '    { "groupVibe": "Front Row Fanatics", "members": ["0x456...", "0xDEF..."] }\n' +
      '  ],\n' +
      '  "unmatched": ["0x999..."]\n' +
      '}';

    // 3. Call Gemini
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: systemPrompt,
    });
    const result = await model.generateContent(userPrompt);
    let rawText = result.response.text().trim();

    // Strip markdown code fences if the model wraps them anyway
    rawText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      console.error('[ai] Failed to parse matchmaking JSON:', rawText);
      return res.status(500).json({ error: 'AI returned invalid JSON', raw: rawText });
    }

    const squadsData = parsed.squads || [];
    const unmatchedWallets = parsed.unmatched || [];

    // 4. Save squads to MongoDB and update attendees
    const createdSquads = [];
    for (const sq of squadsData) {
      if (!sq.members || sq.members.length === 0) continue;

      const matchedSquad = await MatchedSquad.create({
        concertId,
        members: sq.members,
        groupVibe: sq.groupVibe || 'Unnamed Squad',
      });

      await Attendee.updateMany(
        { walletAddress: { $in: sq.members }, concertId },
        { $set: { isMatched: true, squadId: matchedSquad._id } },
      );

      createdSquads.push({
        _id: matchedSquad._id,
        groupVibe: matchedSquad.groupVibe,
        members: matchedSquad.members,
      });
    }

    console.log(
      `[squad-matching] concertId=${concertId}: created ${createdSquads.length} squad(s), ` +
      `${unmatchedWallets.length} still unmatched`,
    );

    return res.json({
      ok: true,
      squadsCreated: createdSquads.length,
      squads: createdSquads,
      unmatched: unmatchedWallets,
    });
  } catch (err) {
    console.error('[api] /api/squad-matching/run failed', err);
    return res.status(500).json({ error: 'Squad matching failed' });
  }
});

/**
 * GET /api/squad-matching/my-squad?walletAddress=0x...&concertId=abc
 * Returns the caller's squad (or unmatched status).
 */
app.get('/api/squad-matching/my-squad', async (req, res) => {
  try {
    const { walletAddress, concertId } = req.query;
    if (!walletAddress || !concertId) {
      return res.status(400).json({ error: 'Missing query params: walletAddress, concertId' });
    }

    const attendee = await Attendee.findOne({ walletAddress, concertId });
    if (!attendee) {
      return res.status(404).json({ error: 'Attendee not found — join squad matching first' });
    }

    if (!attendee.isMatched || !attendee.squadId) {
      return res.json({ matched: false, message: 'You are still in the matching queue' });
    }

    const squad = await MatchedSquad.findById(attendee.squadId);
    if (!squad) {
      return res.json({ matched: false, message: 'Squad record missing — please re-join' });
    }

    return res.json({
      matched: true,
      squad: {
        _id: squad._id,
        groupVibe: squad.groupVibe,
        members: squad.members,
        createdAt: squad.createdAt,
      },
    });
  } catch (err) {
    console.error('[api] /api/squad-matching/my-squad failed', err);
    return res.status(500).json({ error: 'Failed to fetch squad status' });
  }
});

/**
 * POST /api/squad-matching/join-and-match
 * Body: { walletAddress, concertId, bio }
 * One-click: joins the queue, triggers AI matchmaking, returns the squad.
 */
app.post('/api/squad-matching/join-and-match', async (req, res) => {
  try {
    const { walletAddress, concertId, bio } = req.body || {};
    if (!walletAddress || !concertId || !bio) {
      return res.status(400).json({ error: 'Missing required fields: walletAddress, concertId, bio' });
    }
    if (!genAI) {
      return res.status(503).json({ error: 'Gemini API key not configured' });
    }

    // 1. Check if already matched
    const existing = await Attendee.findOne({ walletAddress, concertId, isMatched: true });
    if (existing?.squadId) {
      const existingSquad = await MatchedSquad.findById(existing.squadId);
      if (existingSquad) {
        return res.json({ ok: true, alreadyMatched: true, squad: existingSquad });
      }
    }

    // 2. Upsert attendee
    await Attendee.findOneAndUpdate(
      { walletAddress, concertId },
      { walletAddress, concertId, bio, isMatched: false, squadId: null },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    // 3. Fetch all unmatched for this concert
    const unmatched = await Attendee.find({ concertId, isMatched: false });
    if (unmatched.length < 2) {
      return res.json({ ok: true, matched: false, message: 'Waiting for more fans to join…', queueSize: unmatched.length });
    }

    const attendeePayload = unmatched.map((a) => ({ wallet: a.walletAddress, bio: a.bio }));
    const concert = concerts.find((c) => c.id === concertId);
    const concertLabel = concert ? concert.title : concertId;

    const systemPrompt =
      'You are a matchmaking algorithm for a concert ticketing system. ' +
      'Your job is to read user bios and group them into squads of 2 to 5 people ' +
      'based on similar interests, concert goals, and "vibes". ' +
      'You must strictly output valid JSON. Do not include markdown formatting, ' +
      'backticks, or any conversational text. ' +
      'If a user does not fit well with others, leave them in an "unmatched" array.';

    const userPrompt =
      `Here is the list of attendees waiting for a squad for ${concertLabel}:\n` +
      JSON.stringify(attendeePayload, null, 2) +
      '\n\nGroup these users. Output this exact JSON format:\n' +
      '{\n  "squads": [{ "groupVibe": "...", "members": ["wallet1", "wallet2"] }],\n  "unmatched": []\n}';

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', systemInstruction: systemPrompt });
    const result = await model.generateContent(userPrompt);
    let rawText = result.response.text().trim();
    rawText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      console.error('[ai] join-and-match parse error:', rawText);
      return res.status(500).json({ error: 'AI returned invalid JSON' });
    }

    // 4. Save squads
    let mySquad = null;
    for (const sq of (parsed.squads || [])) {
      if (!sq.members || sq.members.length === 0) continue;
      const matchedSquad = await MatchedSquad.create({
        concertId, members: sq.members, groupVibe: sq.groupVibe || 'Unnamed Squad',
      });
      await Attendee.updateMany(
        { walletAddress: { $in: sq.members }, concertId },
        { $set: { isMatched: true, squadId: matchedSquad._id } },
      );
      if (sq.members.includes(walletAddress)) {
        mySquad = matchedSquad;
      }
    }

    if (mySquad) {
      return res.json({ ok: true, matched: true, squad: mySquad });
    }
    return res.json({ ok: true, matched: false, message: 'AI could not find a good match yet. Try again soon!' });
  } catch (err) {
    console.error('[api] /api/squad-matching/join-and-match failed', err);
    return res.status(500).json({ error: 'Squad matching failed' });
  }
});

/**
 * GET /api/squad-matching/lobby?concertId=abc
 * Returns lobby overview: queue size, existing squads, concert info.
 */
app.get('/api/squad-matching/lobby', async (req, res) => {
  try {
    const { concertId } = req.query;
    if (!concertId) {
      return res.status(400).json({ error: 'Missing query param: concertId' });
    }

    const concert = concerts.find((c) => c.id === concertId);
    const queueCount = await Attendee.countDocuments({ concertId, isMatched: false });
    const matchedCount = await Attendee.countDocuments({ concertId, isMatched: true });
    const squads = await MatchedSquad.find({ concertId }).sort({ createdAt: -1 }).limit(20);

    return res.json({
      ok: true,
      concertId,
      concertTitle: concert ? concert.title : null,
      concertArtist: concert ? concert.artist : null,
      queueCount,
      matchedCount,
      totalAttendees: queueCount + matchedCount,
      squads: squads.map((s) => ({
        _id: s._id,
        groupVibe: s.groupVibe,
        memberCount: s.members.length,
        members: s.members,
        createdAt: s.createdAt,
      })),
    });
  } catch (err) {
    console.error('[api] /api/squad-matching/lobby failed', err);
    return res.status(500).json({ error: 'Failed to fetch lobby data' });
  }
});

/**
 * GET /api/squad-matching/available-squads?concertId=abc
 * Returns all squads for a concert that are open for joining (< 5 members).
 * If concertId is omitted, returns all available squads across all concerts.
 */
app.get('/api/squad-matching/available-squads', async (req, res) => {
  try {
    const { concertId } = req.query;

    // Find squads with fewer than 5 members (open for joining)
    // If concertId is provided, filter by concert; otherwise get all
    const query = concertId ? { concertId } : {};
    const squads = await MatchedSquad.find(query).sort({ createdAt: -1 });
    const availableSquads = squads.filter((s) => s.members.length < 5);

    // Get bios for members (need to handle multiple concerts)
    const wallets = availableSquads.flatMap((s) => s.members);
    const attendeeQuery = concertId
      ? { walletAddress: { $in: wallets }, concertId }
      : { walletAddress: { $in: wallets } };
    const attendees = await Attendee.find(attendeeQuery);
    // Map by wallet+concertId to handle multiple concerts
    const bioMap = Object.fromEntries(
      attendees.map((a) => [`${a.walletAddress}-${a.concertId}`, a.bio])
    );

    return res.json({
      ok: true,
      squads: availableSquads.map((s) => ({
        _id: s._id,
        concertId: s.concertId,
        groupVibe: s.groupVibe,
        memberCount: s.members.length,
        members: s.members,
        memberBios: s.members.map((w) => ({
          wallet: w,
          bio: bioMap[`${w}-${s.concertId}`] || '',
        })),
        createdAt: s.createdAt,
      })),
    });
  } catch (err) {
    console.error('[api] /api/squad-matching/available-squads failed', err);
    return res.status(500).json({ error: 'Failed to fetch available squads' });
  }
});

/**
 * POST /api/squad-matching/find-matching-squads
 * Body: { walletAddress, concertId, bio }
 * AI-powered: finds 2-3 squads that best match the user's vibe/bio.
 * If no existing squads match well, creates a new squad.
 */
app.post('/api/squad-matching/find-matching-squads', async (req, res) => {
  try {
    const { walletAddress, concertId, bio } = req.body || {};
    if (!walletAddress || !concertId || !bio) {
      return res.status(400).json({ error: 'Missing required fields: walletAddress, concertId, bio' });
    }
    if (!genAI) {
      return res.status(503).json({ error: 'Gemini API key not configured' });
    }

    // Check if already matched
    const existing = await Attendee.findOne({ walletAddress, concertId, isMatched: true });
    if (existing?.squadId) {
      const existingSquad = await MatchedSquad.findById(existing.squadId);
      if (existingSquad) {
        return res.json({ ok: true, alreadyMatched: true, currentSquad: existingSquad, suggestions: [] });
      }
    }

    // Upsert attendee (save their bio)
    await Attendee.findOneAndUpdate(
      { walletAddress, concertId },
      { walletAddress, concertId, bio, isMatched: false, squadId: null },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    // Find available squads (< 5 members)
    const squads = await MatchedSquad.find({ concertId });
    const availableSquads = squads.filter((s) => s.members.length < 5);

    if (availableSquads.length === 0) {
      // No squads exist yet — check if there are other unmatched users to form a new squad
      const unmatched = await Attendee.find({ concertId, isMatched: false });
      if (unmatched.length >= 2) {
        // Create a new squad with AI
        return await createNewSquadWithAI(res, walletAddress, concertId, bio, unmatched);
      }
      return res.json({
        ok: true,
        suggestions: [],
        message: 'No squads available yet. Waiting for more fans to join!',
        queueSize: unmatched.length,
      });
    }

    // Get bios for all squad members
    const allWallets = availableSquads.flatMap((s) => s.members);
    const attendees = await Attendee.find({ walletAddress: { $in: allWallets }, concertId });
    const bioMap = Object.fromEntries(attendees.map((a) => [a.walletAddress, a.bio]));

    // Build squad info for AI
    const squadInfo = availableSquads.map((s) => ({
      squadId: s._id.toString(),
      groupVibe: s.groupVibe,
      memberCount: s.members.length,
      memberBios: s.members.map((w) => bioMap[w] || 'No bio').join('; '),
    }));

    const concert = concerts.find((c) => c.id === concertId);
    const concertLabel = concert ? concert.title : concertId;

    // Ask AI to rank squads for this user
    const systemPrompt =
      'You are a squad matching assistant for a concert ticketing system. ' +
      'Your job is to analyze a user\'s bio and find the best matching squads from existing options. ' +
      'You must strictly output valid JSON. Do not include markdown formatting, backticks, or conversational text.';

    const userPrompt =
      `Concert: ${concertLabel}\n\n` +
      `User's bio: "${bio}"\n\n` +
      `Available squads:\n${JSON.stringify(squadInfo, null, 2)}\n\n` +
      `Rank the top 2-3 squads that best match this user's vibe and interests. ` +
      `If none of the squads are a good match (compatibility < 50%), return an empty array.\n\n` +
      `Output this exact JSON format:\n` +
      '{\n' +
      '  "suggestions": [\n' +
      '    { "squadId": "...", "matchScore": 85, "reason": "Why this squad is a good match" },\n' +
      '    { "squadId": "...", "matchScore": 72, "reason": "..." }\n' +
      '  ],\n' +
      '  "shouldCreateNew": false\n' +
      '}';

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', systemInstruction: systemPrompt });
    const result = await model.generateContent(userPrompt);
    let rawText = result.response.text().trim();
    rawText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      console.error('[ai] find-matching-squads parse error:', rawText);
      // Fallback: return all available squads without AI ranking
      return res.json({
        ok: true,
        suggestions: availableSquads.slice(0, 3).map((s) => ({
          squad: {
            _id: s._id,
            groupVibe: s.groupVibe,
            memberCount: s.members.length,
            members: s.members,
            memberBios: s.members.map((w) => ({ wallet: w, bio: bioMap[w] || '' })),
          },
          matchScore: 50,
          reason: 'AI ranking unavailable',
        })),
      });
    }

    // If AI suggests creating new squad
    if (parsed.shouldCreateNew || !parsed.suggestions || parsed.suggestions.length === 0) {
      const unmatched = await Attendee.find({ concertId, isMatched: false });
      if (unmatched.length >= 2) {
        return await createNewSquadWithAI(res, walletAddress, concertId, bio, unmatched);
      }
      return res.json({
        ok: true,
        suggestions: [],
        message: 'No good matches found. Waiting for more compatible fans!',
        queueSize: unmatched.length,
      });
    }

    // Build detailed suggestions
    const suggestions = [];
    for (const sug of parsed.suggestions.slice(0, 3)) {
      const squad = availableSquads.find((s) => s._id.toString() === sug.squadId);
      if (squad) {
        suggestions.push({
          squad: {
            _id: squad._id,
            groupVibe: squad.groupVibe,
            memberCount: squad.members.length,
            members: squad.members,
            memberBios: squad.members.map((w) => ({ wallet: w, bio: bioMap[w] || '' })),
          },
          matchScore: sug.matchScore || 50,
          reason: sug.reason || '',
        });
      }
    }

    return res.json({ ok: true, suggestions });
  } catch (err) {
    console.error('[api] /api/squad-matching/find-matching-squads failed', err);
    return res.status(500).json({ error: 'Failed to find matching squads' });
  }
});

// Helper function to create a new squad with AI
async function createNewSquadWithAI(res, walletAddress, concertId, bio, unmatched) {
  const attendeePayload = unmatched.map((a) => ({ wallet: a.walletAddress, bio: a.bio }));
  const concert = concerts.find((c) => c.id === concertId);
  const concertLabel = concert ? concert.title : concertId;

  const systemPrompt =
    'You are a matchmaking algorithm for a concert ticketing system. ' +
    'Your job is to read user bios and group them into squads of 2 to 5 people ' +
    'based on similar interests, concert goals, and "vibes". ' +
    'You must strictly output valid JSON. Do not include markdown formatting, backticks, or conversational text.';

  const userPrompt =
    `Here is the list of attendees waiting for a squad for ${concertLabel}:\n` +
    JSON.stringify(attendeePayload, null, 2) +
    '\n\nGroup these users. Output this exact JSON format:\n' +
    '{\n  "squads": [{ "groupVibe": "...", "members": ["wallet1", "wallet2"] }],\n  "unmatched": []\n}';

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', systemInstruction: systemPrompt });
  const result = await model.generateContent(userPrompt);
  let rawText = result.response.text().trim();
  rawText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    console.error('[ai] createNewSquadWithAI parse error:', rawText);
    return res.status(500).json({ error: 'AI returned invalid JSON' });
  }

  // Save squads and find the one containing our user
  let mySquad = null;
  for (const sq of (parsed.squads || [])) {
    if (!sq.members || sq.members.length === 0) continue;
    const matchedSquad = await MatchedSquad.create({
      concertId, members: sq.members, groupVibe: sq.groupVibe || 'Unnamed Squad',
    });
    await Attendee.updateMany(
      { walletAddress: { $in: sq.members }, concertId },
      { $set: { isMatched: true, squadId: matchedSquad._id } },
    );
    if (sq.members.includes(walletAddress)) {
      mySquad = matchedSquad;
    }
  }

  if (mySquad) {
    return res.json({
      ok: true,
      newSquadCreated: true,
      squad: mySquad,
      suggestions: [{
        squad: {
          _id: mySquad._id,
          groupVibe: mySquad.groupVibe,
          memberCount: mySquad.members.length,
          members: mySquad.members,
        },
        matchScore: 100,
        reason: 'AI created this squad based on your vibe!',
      }],
    });
  }

  return res.json({ ok: true, suggestions: [], message: 'AI could not find a good match yet.' });
}

/**
 * POST /api/squad-matching/join-squad
 * Body: { walletAddress, concertId, squadId }
 * Joins an existing squad.
 */
app.post('/api/squad-matching/join-squad', async (req, res) => {
  try {
    const { walletAddress, concertId, squadId } = req.body || {};
    if (!walletAddress || !concertId || !squadId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const squad = await MatchedSquad.findById(squadId);
    if (!squad) {
      return res.status(404).json({ error: 'Squad not found' });
    }
    if (squad.concertId !== concertId) {
      return res.status(400).json({ error: 'Squad does not belong to this concert' });
    }
    if (squad.members.length >= 5) {
      return res.status(400).json({ error: 'Squad is full' });
    }
    if (squad.members.includes(walletAddress)) {
      return res.json({ ok: true, message: 'Already in this squad', squad });
    }

    // Remove from current squad if any
    const attendee = await Attendee.findOne({ walletAddress, concertId });
    if (attendee?.squadId && attendee.squadId.toString() !== squadId) {
      await MatchedSquad.findByIdAndUpdate(attendee.squadId, {
        $pull: { members: walletAddress },
      });
    }

    // Add to new squad
    squad.members.push(walletAddress);
    await squad.save();

    // Update attendee
    await Attendee.findOneAndUpdate(
      { walletAddress, concertId },
      { isMatched: true, squadId: squad._id },
      { upsert: true },
    );

    return res.json({ ok: true, squad });
  } catch (err) {
    console.error('[api] /api/squad-matching/join-squad failed', err);
    return res.status(500).json({ error: 'Failed to join squad' });
  }
});

/**
 * POST /api/squad-matching/leave-squad
 * Body: { walletAddress, concertId }
 * Leaves current squad and goes back to unmatched.
 */
app.post('/api/squad-matching/leave-squad', async (req, res) => {
  try {
    const { walletAddress, concertId } = req.body || {};
    if (!walletAddress || !concertId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const attendee = await Attendee.findOne({ walletAddress, concertId });
    if (!attendee?.squadId) {
      return res.json({ ok: true, message: 'Not in any squad' });
    }

    // Remove from squad
    await MatchedSquad.findByIdAndUpdate(attendee.squadId, {
      $pull: { members: walletAddress },
    });

    // Update attendee
    attendee.isMatched = false;
    attendee.squadId = null;
    await attendee.save();

    return res.json({ ok: true, message: 'Left squad successfully' });
  } catch (err) {
    console.error('[api] /api/squad-matching/leave-squad failed', err);
    return res.status(500).json({ error: 'Failed to leave squad' });
  }
});

// ─── SQUAD CHAT ───────────────────────────────────────────────────────────────

/**
 * POST /api/squad-chat/send
 * Body: { squadId, walletAddress, text }
 */
app.post('/api/squad-chat/send', async (req, res) => {
  try {
    const { squadId, walletAddress, text } = req.body || {};
    if (!squadId || !walletAddress || !text) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const msg = await SquadMessage.create({ squadId, walletAddress, text: text.slice(0, 500) });
    return res.json({ ok: true, message: msg });
  } catch (err) {
    console.error('[api] /api/squad-chat/send failed', err);
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

/**
 * GET /api/squad-chat/messages?squadId=...&since=ISO
 * Returns up to 100 messages, optionally filtered by `since` timestamp.
 */
app.get('/api/squad-chat/messages', async (req, res) => {
  try {
    const { squadId, since } = req.query;
    if (!squadId) return res.status(400).json({ error: 'Missing squadId' });
    const filter = { squadId };
    if (since) filter.createdAt = { $gt: new Date(since) };
    const messages = await SquadMessage.find(filter).sort({ createdAt: 1 }).limit(100);
    return res.json({ ok: true, messages });
  } catch (err) {
    console.error('[api] /api/squad-chat/messages failed', err);
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

const server = app.listen(PORT, async () => {
  await connectDB();
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
  await Expense.create({ channelId, payer, amount, description });
  
  const ledger = await Expense.find({ channelId }).sort({ createdAt: 1 });
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
