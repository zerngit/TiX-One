require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Connect to your Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function createLiveSquad(concertId, concertName, squadName, vibe) {
  console.log(`\n⏳ Creating: ${squadName}...`);

  // 1. Insert into Supabase
  const { data: squad, error } = await supabase
    .from('squads')
    .insert({ concert_id: concertId, name: squadName, vibe, max_members: 5 })
    .select()
    .single();

  if (error) return console.error("❌ Supabase Error:", error.message);
  console.log(`✅ DB Record Created (Squad ID: ${squad.id})`);

  // 2. Ping your local backend to generate the Discord Channel
  try {
    const response = await fetch('http://localhost:8787/api/create-squad', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        squadId: squad.id,
        concertId: concertId,
        concertName: concertName
      })
    });

    const result = await response.json();
    if (result.channelId) {
       console.log(`✅ Discord Channel Created! Invite: ${result.inviteUrl}`);
    } else {
       console.log(`⚠️ Discord Error:`, result);
    }
  } catch (err) {
    console.error("❌ Backend Error: Is your server.js running?", err.message);
  }
}

async function run() {
  console.log("🚀 Starting Demo Seeder...");

  // --- ADD YOUR SQUADS HERE ---
  // Format: (concertId, concertName, squadName, vibe)
  
  // Martin Garrix Squads
  await createLiveSquad("2", "Taylor Swift", "Front Row Fanatics", "High Energy! We want to be at the rail, jumping to every bass drop.");
  await createLiveSquad("2", "Taylor Swift", "Chill Observers", "Chill vibe. We just want to stand in the back and enjoy the visuals.");

  console.log("\n🎉 All done! Check your Discord server and the frontend lobby.");
}

run();