#!/usr/bin/env node
// scripts/apply-supabase.mjs
// Applies concert_object_id + waitlist_object_id updates to Supabase.
// Run: node scripts/apply-supabase.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Load .env.local
const envRaw = readFileSync(join(ROOT, '.env.local'), 'utf8')
const env = Object.fromEntries(
  envRaw.split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)

const SUPABASE_URL = env['VITE_SUPABASE_URL']
const SUPABASE_KEY = env['VITE_SUPABASE_ANON_KEY']

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌  Could not find VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local')
  process.exit(1)
}

// Concert data: [supabase_id, concert_object_id, waitlist_object_id, artist, event_name, available, price]
const CONCERTS = [
  ['1',  '0xa44532d726037600dd0794a51a840f6a425da3461f20ded52cc26f687a8c1fb3', '0x1ab48e031118dd2c328ef830d4c95c0871697b8047f32045766fc530908485af', 'Martin Garrix',  'Neon Dreams Tour',             2, '0.05 OCT'],
  ['2',  '0x3bb456f38018f41e215148220a90da3560154f9c4f4a6e67c00415701d31e238', '0x5ce6e4f35c130702569d70d4aadc7ecead5671b8250f84769df032bf2dea6500', 'Taylor Swift',   'Celestial Sound Experience',   2, '0.08 OCT'],
  ['3',  '0xf350fb915de742726dea2b82784cad418465094842a60328ef83f9d7cdeaf603', '0x8190a1b899990cb3f12363d6e3ed924f21c9172149acadcf4f914d772c160895', 'Calvin Harris',  'Blockchain Beats Festival',    2, '0.12 OCT'],
  ['4',  '0x3e82f058241e23c8721b3ba86b9955abe91511bd6ba6fd87d7f17fb1a6f82f39', '0x0b3254f00dc10653f0e0ae1d5be0b1e69de574377bc352cd1842f01fd73c976c', 'Ed Sheeran',     'Unplugged & Unchained',        2, '0.04 OCT'],
  ['5',  '0x2aae1bfa9195ffafec7725d65e9526789a6623c5892c415a5d62728c81124a31', '0x1c89c1f4de762f4430ca89903c3ab371794116a82407314d547ba0d632166a35', 'Drake',          'Decentralized Sound Tour',     2, '0.07 OCT'],
  ['6',  '0xb5c7361ab5e9dd8f562da45941708186c71032609bcbab9cad27a623b0a435a1', '0x2ad453a5c12ad2b804a419b6d440abbb5f61b6e4a037469c96b588faecd34657', 'Billie Eilish',  'Galaxy Tour 2026',             2, '0.06 OCT'],
  ['7',  '0xd9b7c4d17cbed32bdeae66517f1c74e5b280ef201c3efdb09720a20ce8b4f8a7', '0x1981929c38d9d9cf75b3da4db69ea7e29e667a32832c0feebad77bd00edcf4b5', 'Bruno Mars',     'Smooth Grooves Night',         2, '0.03 OCT'],
  ['8',  '0x2821fafeb2a82c71f438fa198493ca22fc51911e133ac1c2aceb97c9f0425553', '0x3166fc4fd1610db21ff470f27f20db14942160b2ae52366604eb2ba8f641fcef', 'The Weeknd',     'Rock Revolution Tour',         2, '0.09 OCT'],
  ['9',  '0x560067d22b83da8ec09a846ee84b5dd3b9482bb5bbb1798d370d144782754635', '0xcfabc65d5f9a093227beb1477c0a69da4841697981c5fa5bc9306bb96862b0fe', 'Coldplay',       'Blockchain Classics',          2, '0.10 OCT'],
  ['10', '0x21b9bf9b44625881b08079fe283ee8241c2ff238ae8928b6a16610e2131cb7b4', '0xa448b93893576ca1a5ffb5d57a72420601c5ddb653838d86618d55b367e1f79f', 'Post Malone',    'Country Roads Festival',       2, '0.045 OCT'],
  ['11', '0x7a9b0fd2eb781618fc6ea1148ea3268ea8210370502b3d84e1c379a261abc5ef', '0x2982e67f5738a3557669087efdda461068236ff8dcfb9a90aceffe2d62123a20', 'Linkin Park',    'Metal Mayhem World Tour',      2, '0.07 OCT'],
  ['12', '0xcc083ea621785389f6946458c22ee30234c059dc37769397ebdd3f2dff154868', '0x51c5dfeb87777749794322c732d1fe83be4e42d368008b1f67cbdf8b3dccd17f', 'Rihanna',        'Island Rhythms Festival',      2, '0.035 OCT'],
  ['13', '0x0f8a5e41063bb429774befc0534ccd05394cb329176cf5514547665464cf6cd0', '0xc275ba563e8211563e4bbab02fb7ab3ea8d6b5274172706d92468a95239372e7', 'Shakira',        'Salsa Heat Night',             2, '0.055 OCT'],
  ['14', '0x4b27339985045ea4f9a72349269abb87fe31a63af4a1f6b5e70e426357317aa8', '0xc174d4ec2b1b9d2a36f84bbccff4e030064506f98eb8dbbedabe9d530244eb54', 'Dua Lipa',       'Techno Underground',           2, '0.065 OCT'],
  ['15', '0x2a4483c9e2e77bedd4bfaf29bfac5e2bb2dd528def318dedeebed27a70fb1f86', '0xe9fcbcbf0c720ed95fba3054833db67c9d5bb7fdfa5e4b11338c35c9558999d5', 'Adele',          'Blues Heritage Tour',          2, '0.05 OCT'],
]

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// Step 1: Add the column if it doesn't exist (via DDL through REST — may need service role)
// We'll skip DDL here and attempt the UPDATEs directly.
// If waitlist_object_id column doesn't exist, we'll catch the error and print instructions.

console.log('\n📡  Connecting to Supabase:', SUPABASE_URL)
console.log('🔄  Applying', CONCERTS.length, 'concert updates...\n')

// Phase 1: update concert_object_id (always exists)
let successCount = 0
let failCount = 0

for (const [id, concertObjectId, waitlistObjectId, artist, eventName, available, price] of CONCERTS) {
  const { error } = await supabase
    .from('concerts')
    .update({
      concert_object_id: concertObjectId,
      artist,
      availableTickets: available,
      price,
    })
    .eq('id', id)

  if (error) {
    console.log(`  [${id}] ❌  ${eventName} — ${error.message}`)
    failCount++
  } else {
    console.log(`  [${id}] ✅  ${eventName}`)
    successCount++
  }
}

console.log(`\n${successCount}/${CONCERTS.length} concert_object_id updates done.\n`)

// Phase 2: try waitlist_object_id updates (column may not exist yet)
console.log('🔄  Applying waitlist_object_id updates...\n')
let waitlistSuccess = 0
let waitlistFail = 0
let needsColumn = false

for (const [id, , waitlistObjectId, , eventName] of CONCERTS) {
  const { error } = await supabase
    .from('concerts')
    .update({ waitlist_object_id: waitlistObjectId })
    .eq('id', id)

  if (error) {
    if (error.message.includes('waitlist_object_id')) needsColumn = true
    waitlistFail++
  } else {
    console.log(`  [${id}] ✅  ${eventName}`)
    waitlistSuccess++
  }
}

console.log(`\n${'─'.repeat(55)}`)
if (waitlistFail === 0) {
  console.log(`🎉  All updates complete — ${successCount} concerts fully synced!`)
} else {
  console.log(`✅  concert_object_id: ${successCount}/${CONCERTS.length} updated`)
  if (needsColumn) {
    console.log(`\n⚠️  waitlist_object_id column is missing from Supabase.`)
    console.log(`\n  To fix, run this in Supabase → SQL Editor:`)
    console.log(`\n  ALTER TABLE concerts ADD COLUMN waitlist_object_id TEXT;\n`)
    console.log(`  Then re-run:  node scripts/apply-supabase.mjs`)
  }
}
console.log('')
