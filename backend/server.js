require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
} = process.env;

/* ===============================
   Event Configuration
=================================*/
const EVENTS = {
  "1": { name: "Jay Chou Concert", artist: "Jay Chou" },
  "2": { name: "Taylor Swift Tour", artist: "Taylor Swift" },
  "3": { name: "Coldplay Live", artist: "Coldplay" }
};

/* ===============================
   1️⃣ Generate Spotify Auth URL
=================================*/
app.get("/auth-url", (req, res) => {

  const eventId = req.query.eventId;

  if (!eventId || !EVENTS[eventId]) {
    return res.status(400).json({ error: "Invalid event ID" });
  }

  const scopes =
    "user-top-read user-read-recently-played user-library-read";

  const authUrl =
    `https://accounts.spotify.com/authorize` +
    `?client_id=${CLIENT_ID}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&state=${eventId}`;

  res.json({ url: authUrl });
});

/* ===============================
   2️⃣ Handle Callback & Score
=================================*/
app.get("/callback", async (req, res) => {

  const code = req.query.code;
  const eventId = req.query.state;

  console.log("CALLBACK QUERY:", req.query);

  if (!code) {
    return res.status(400).send("No authorization code received");
  }

  if (!eventId || !EVENTS[eventId]) {
    return res.status(400).send("Invalid event");
  }

  const TARGET_ARTIST = EVENTS[eventId].artist;

  try {

    /* 🔹 Exchange code for token */
    const tokenResponse = await axios.post(
      "https://accounts.spotify.com/api/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const accessToken = tokenResponse.data.access_token;

    let score = 0;
    let rankingPosition = -1;
    let recentCount = 0;
    let hasSavedAlbum = false;

    /* 🔹 1. Top Artists */
    const topArtistsResponse = await axios.get(
      "https://api.spotify.com/v1/me/top/artists?limit=10&time_range=long_term",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const topArtists = topArtistsResponse.data.items;

    topArtists.forEach((artist, index) => {
      if (
        artist.name.toLowerCase() === TARGET_ARTIST.toLowerCase()
      ) {
        rankingPosition = index;
      }
    });

    if (rankingPosition >= 0 && rankingPosition <= 2) {
      score += 50;
    } else if (rankingPosition >= 3 && rankingPosition <= 9) {
      score += 25;
    }

    /* 🔹 2. Recently Played */
    const recentResponse = await axios.get(
      "https://api.spotify.com/v1/me/player/recently-played?limit=50",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const recentTracks = recentResponse.data.items;

    recentTracks.forEach(item => {
      if (
        item.track.artists.some(
          artist =>
            artist.name.toLowerCase() === TARGET_ARTIST.toLowerCase()
        )
      ) {
        recentCount++;
      }
    });

    if (recentCount >= 3) {
      score += 20;
    }

    /* 🔹 3. Saved Albums */
    const savedAlbumsResponse = await axios.get(
      "https://api.spotify.com/v1/me/albums?limit=50",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const savedAlbums = savedAlbumsResponse.data.items;

    hasSavedAlbum = savedAlbums.some(item =>
      item.album.artists.some(
        artist =>
          artist.name.toLowerCase() === TARGET_ARTIST.toLowerCase()
      )
    );

    if (hasSavedAlbum) {
      score += 30;
    }

    console.log("EVENT ID:", eventId);
    console.log("FINAL SCORE:", score);

    /* 🎯 Redirect Back To Frontend */
    res.redirect(
      `http://localhost:3000/concert/${eventId}?score=${score}`
    );

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).send("Error during verification");
  }
});

/* ===============================
   Start Server
=================================*/
app.listen(4000, () => {
  console.log("Backend running on http://localhost:4000");
});