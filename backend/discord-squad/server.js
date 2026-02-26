/* eslint-disable no-console */

require('dotenv').config();
require('ts-node').register({ transpileOnly: true });

const express = require('express');
const cors = require('cors');
const {
  Client,
  GatewayIntentBits,
  ChannelType,
} = require('discord.js');

const { GoogleGenerativeAI } = require('@google/generative-ai');

/* ============================================================
   ENV
============================================================ */

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = Number(process.env.PORT || 8787);

if (!DISCORD_TOKEN) throw new Error('Missing DISCORD_TOKEN');
if (!GUILD_ID) throw new Error('Missing GUILD_ID');

const genAI = GEMINI_API_KEY
  ? new GoogleGenerativeAI(GEMINI_API_KEY)
  : null;

if (!genAI) console.warn('[ai] GEMINI_API_KEY not set');

/* ============================================================
   EXPRESS
============================================================ */

const app = express();

app.use(cors({
  origin: "http://localhost:3000"
}));

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

/* ============================================================
   DISCORD CLIENT
============================================================ */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let isDiscordReady = false;

client.once('ready', () => {
  console.log(`[discord] logged in as ${client.user.tag}`);
  isDiscordReady = true;
});

client.on('error', (err) => {
  console.error('[discord] client error:', err);
});

client.login(DISCORD_TOKEN);

/* ============================================================
   CREATE SQUAD ENDPOINT
============================================================ */

app.post('/api/create-squad', async (req, res) => {
  try {
    const { ticketId, concertName, concertId } = req.body;

    if (!ticketId || !concertName) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    if (!isDiscordReady) {
      return res.status(503).json({ error: 'Discord not ready yet' });
    }

    const guild = await client.guilds.fetch(GUILD_ID);

    if (!guild) {
      return res.status(500).json({ error: 'Guild not found' });
    }

    const channelName = `squad-${concertId || 'general'}-${Date.now()}`;

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      topic: `ConcertID: ${concertId || 'none'} | TicketID: ${ticketId}`,
    });

    const invite = await channel.createInvite({
      maxAge: 0,
      maxUses: 0,
    });

    return res.json({
      inviteUrl: invite.url,
      channelId: channel.id,
    });

  } catch (err) {
    console.error('[create-squad error]', err);
    return res.status(500).json({
      error: 'Failed to create squad',
      message: err.message
    });
  }
});

/* ============================================================
   AI MESSAGE HANDLER
============================================================ */

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!genAI) return;

  try {
    await message.channel.sendTyping();

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
    });

    const result = await model.generateContent(
      `You are a friendly Discord AI assistant. User said: "${message.content}". Reply naturally and friendly.`
    );

    const reply = result.response.text().trim();

    if (reply) {
      await message.channel.send(reply);
    }

  } catch (err) {
    console.error('[ai] error', err);
  }
});

/* ============================================================
   START SERVER
============================================================ */

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
});