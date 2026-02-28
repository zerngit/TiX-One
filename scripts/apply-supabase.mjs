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
  ['1',  '0x4c6c087a3b23343cf8e27a76c078ad21e33de51fd1eef0b6dbfc6794cbfeee3f', '0x394dc22f622dc04b4866de90d934c7780c8aea862983e3e95ed4ad8ce18b17a0', 'Martin Garrix',  'Neon Dreams Tour',             2, '0.05 OCT'],
  ['2',  '0x05fada3d2ab8c434d056a307b78eca92f79c3d4d3dcec29b047e626e98fb80fe', '0x6c78871c90f72ab631febeb6fb230a8e3d4f5c1f90f7e3657f4e46f1d9c999b3', 'Taylor Swift',   'Celestial Sound Experience',   2, '0.08 OCT'],
  ['3',  '0x1fa756819407c0467fa6cd8208998ad233611d5f3b56f5718da9feb0c463453a', '0x2e6d107f30870e7b2cf09b4ba9996bb79892f060eab4cec89cce80eda0b2f060', 'Calvin Harris',  'Blockchain Beats Festival',    2, '0.12 OCT'],
  ['4',  '0x422c0194ee907d0af7330bed774f6b24dc5d84a51ed16e09ba9dbc278b564193', '0x22891b1bc7ef4102e66e4fe3e9d7ffdfd4e0da0df587a952ac69c759e954fd30', 'Ed Sheeran',     'Unplugged & Unchained',        2, '0.04 OCT'],
  ['5',  '0x23423f1eafa0a5cb1be3e83a32dea4e224470999dd8911a9e01c65fc28403b1c', '0xaccf3a85a0128a6d04ace3e465d022eb14069b3b0efe32495e89341a71db956e', 'Drake',          'Decentralized Sound Tour',     2, '0.07 OCT'],
  ['6',  '0x273f3709d8348b15faf9019cac093261d7ff9e3e094b49494c839c3efe9eb1dc', '0x4a53d30db528542f6a62d1c2e6780fb3d509445b139cddc6ecde05197a7d8c7a', 'Billie Eilish',  'Galaxy Tour 2026',             2, '0.06 OCT'],
  ['7',  '0x682f32a46312302dcea94009c94452788f3e037e179052a105a9b91f097e5084', '0xb4c8016dc40b5fc3a3ddbd02a2cdc1a2dd9ab73a2897c0fc05c3f0a3d5f53b41', 'Bruno Mars',     'Smooth Grooves Night',         2, '0.03 OCT'],
  ['8',  '0x480eabbd31286193b637b375f5b5d742702d36a9b1bf1b276182710d54071807', '0x27ffa4c01acbcb8cac13b05d4e55fe83201632c8652ca350edc55b00642654df', 'The Weeknd',     'Rock Revolution Tour',         2, '0.09 OCT'],
  ['9',  '0xeb91f46852f42806a5b938b1cf360c132c211b902617eb87af538c188b12e264', '0x60a5df2cd261122eda6dd076f662f92ca45b8c26d098bb2209fd58624483c621', 'Coldplay',       'Blockchain Classics',          2, '0.10 OCT'],
  ['10', '0x93519951a75a73a2587fb374a8640e24bea1d36b5385b038a30c3a25d80cbb75', '0xaaf182f4f8a982379d974c8b507099a1546f60da6f54799c3a6591f20ba744c3', 'Post Malone',    'Country Roads Festival',       2, '0.045 OCT'],
  ['11', '0xe338dd7a026a525c945d1bf73246f4f93b368198f394d5beccb253b7729ee1d1', '0x42f03d71fdd527385b0c029462ef21d45f6fb69bbeb6fb976ec27dd1c22ec122', 'Linkin Park',    'Metal Mayhem World Tour',      2, '0.07 OCT'],
  ['12', '0x942d95e6a3d9950a8cf32ae20a6d67366889c3c9abdcd767bd210fc5290207b2', '0xd1de95918d8c3e356aeb2bce1d3964a1fbfa15510e1f5663c8d55a0fd1ea104d', 'Rihanna',        'Island Rhythms Festival',      2, '0.035 OCT'],
  ['13', '0x7ed4bd1bfd47d4d9d3088224364c5c8d7e0005150ca2b0fcaeeb2be2e8182850', '0x025eb43f2c99d2871a3fa69ba94608d4ec3911748cd89cce950837646187c366', 'Shakira',        'Salsa Heat Night',             2, '0.055 OCT'],
  ['14', '0xa1e972a4001205dae59eb983504c583012379284f5a4eeb88961f7f9cd5093e0', '0x434e635a6766c95001e7397b18e4e05d59117a9291235ca6c8326bbd515c338c', 'Dua Lipa',       'Techno Underground',           2, '0.065 OCT'],
  ['15', '0xbce8cffd0f0bd3a7e5725143d34d8dd8ae94cda9cb10ab2ad320ab702d588df9', '0xd64df3a7f50da0fc8d41e29983f56f058f15a43c97fcb50f59b664c576a3966b', 'Adele',          'Blues Heritage Tour',          2, '0.05 OCT'],
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
