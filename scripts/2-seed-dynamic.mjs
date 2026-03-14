#!/usr/bin/env node
// Reads all concerts from Supabase, creates Concert + Waitlist on-chain,
// then writes the new object IDs back to Supabase.
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { spawnSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const ENV_PATH = join(ROOT, '.env.local')
const DEPLOY_IDS_PATH = join(__dirname, '.deployed-ids.env')

function parseEnvFile(filePath) {
  return Object.fromEntries(
    readFileSync(filePath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const idx = line.indexOf('=')
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()]
      })
  )
}

function fail(message) {
  console.error(`❌  ${message}`)
  process.exit(1)
}

function normalizeDateString(dateValue) {
  const raw = String(dateValue ?? '').trim()
  if (!raw) return ''

  const isoLike = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoLike) {
    const [, year, month, day] = isoLike
    return `${year}-${month}-${day}`
  }

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function normalizeTimeString(timeValue) {
  const raw = String(timeValue ?? '').trim()
  if (!raw) return ''

  const already24h = raw.match(/^\d{2}:\d{2}(:\d{2})?$/)
  if (already24h) return raw.slice(0, 5)

  const parsed = new Date(`1970-01-01 ${raw}`)
  if (Number.isNaN(parsed.getTime())) return raw
  const hours = String(parsed.getHours()).padStart(2, '0')
  const minutes = String(parsed.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function computeExpiresAt(dateValue, timeValue) {
  const normalizedDate = normalizeDateString(dateValue)
  const normalizedTime = normalizeTimeString(timeValue)
  const combined = normalizedDate && normalizedTime
    ? `${normalizedDate}T${normalizedTime}:00`
    : normalizedDate || normalizedTime
  const parsed = combined ? new Date(combined) : new Date(NaN)

  if (!Number.isNaN(parsed.getTime())) {
    return BigInt(parsed.getTime())
  }

  console.warn(`    ⚠️  Could not parse date/time: "${dateValue}" / "${timeValue}". Using +180 days.`)
  return BigInt(Date.now() + 180 * 24 * 60 * 60 * 1000)
}

function parsePriceMist(priceValue) {
  const raw = String(priceValue ?? '').trim()
  const match = raw.match(/(\d+(?:\.\d+)?)/)
  if (!match) return 50_000_000n

  const [wholePart, fractionalPart = ''] = match[1].split('.')
  const paddedFractional = fractionalPart.padEnd(9, '0').slice(0, 9)
  return BigInt(wholePart) * 1_000_000_000n + BigInt(paddedFractional)
}

function callContract(packageId, functionName, args) {
  const result = spawnSync(
    'one',
    [
      'client',
      'call',
      '--package',
      packageId,
      '--module',
      'ticket',
      '--function',
      functionName,
      '--args',
      ...args,
      '--gas-budget',
      '10000000',
      '--json',
    ],
    { encoding: 'utf8' }
  )

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || 'Unknown CLI error').trim()
    throw new Error(details)
  }

  const raw = (result.stdout || '').trim()
  const jsonStart = raw.indexOf('{')
  const payload = jsonStart >= 0 ? raw.slice(jsonStart) : raw
  return JSON.parse(payload)
}

function extractCreatedObjectId(txResult, typeSubstring) {
  for (const change of txResult.objectChanges ?? []) {
    if (change.type === 'created' && String(change.objectType || '').includes(typeSubstring)) {
      return change.objectId
    }
  }
  return null
}

if (!existsSync(ENV_PATH)) {
  fail(`.env.local not found at ${ENV_PATH}`)
}

if (!existsSync(DEPLOY_IDS_PATH)) {
  fail('.deployed-ids.env not found. Run scripts/1-deploy.sh first.')
}

const env = parseEnvFile(ENV_PATH)
const deployedIds = parseEnvFile(DEPLOY_IDS_PATH)
const SUPABASE_URL = env.VITE_SUPABASE_URL
const SUPABASE_KEY = env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY
const PACKAGE_ID = deployedIds.PACKAGE_ID

if (!SUPABASE_URL || !SUPABASE_KEY) {
  fail('Missing VITE_SUPABASE_URL or a usable Supabase key in .env.local')
}

if (!PACKAGE_ID) {
  fail('PACKAGE_ID missing from scripts/.deployed-ids.env')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

console.log('')
console.log('🎵  TiX-One Dynamic Seed')
console.log('════════════════════════════════════════')
console.log(`📦  Package  : ${PACKAGE_ID}`)
console.log(`📡  Supabase : ${SUPABASE_URL}`)
console.log('')

const { data: concerts, error: fetchError } = await supabase
  .from('concerts')
  .select('*')
  .order('id', { ascending: true })

if (fetchError) {
  fail(`Supabase fetch failed: ${fetchError.message}`)
}

if (!concerts?.length) {
  fail('No concerts found in Supabase.')
}

console.log(`📋  ${concerts.length} concerts found in Supabase`)
console.log('')

let successCount = 0
let failCount = 0

for (const concert of concerts) {
  const rowId = String(concert.id)
  const artist = String(concert.artist ?? '').trim()
  const title = String(concert.title ?? concert.event_name ?? '').trim()
  const eventName = title || artist || `Concert ${rowId}`
  const maxSupply = Number(concert.availableTickets ?? concert.available_tickets ?? 2)

  console.log(`  [${rowId}] ${eventName} — ${artist || 'Unknown Artist'}`)

  let concertObjectId = null
  let waitlistObjectId = null

  try {
    process.stdout.write('       concert   ... ')
    const concertTx = callContract(PACKAGE_ID, 'create_concert', [
      artist,
      eventName,
      String(Number.isFinite(maxSupply) && maxSupply > 0 ? maxSupply : 2),
    ])
    concertObjectId = extractCreatedObjectId(concertTx, '::ticket::Concert')
    if (!concertObjectId) {
      throw new Error('Concert object ID not found in transaction output')
    }
    console.log(`✅  ${concertObjectId}`)

    process.stdout.write('       waitlist  ... ')
    const waitlistTx = callContract(PACKAGE_ID, 'create_waitlist', [
      concertObjectId,
      parsePriceMist(concert.price).toString(),
      computeExpiresAt(concert.date, concert.time).toString(),
    ])
    waitlistObjectId = extractCreatedObjectId(waitlistTx, '::ticket::Waitlist')
    if (!waitlistObjectId) {
      throw new Error('Waitlist object ID not found in transaction output')
    }
    console.log(`✅  ${waitlistObjectId}`)

    const { error: updateError } = await supabase
      .from('concerts')
      .update({
        concert_object_id: concertObjectId,
        waitlist_object_id: waitlistObjectId,
      })
      .eq('id', concert.id)

    if (updateError) {
      throw new Error(`Supabase update failed: ${updateError.message}`)
    }

    successCount += 1
    console.log('       sync      ... ✅')
  } catch (error) {
    failCount += 1
    console.log(`❌  ${(error && error.message) || String(error)}`)
  }

  console.log('')
}

console.log('═'.repeat(42))
if (failCount === 0) {
  console.log(`🎉  All ${successCount} concerts seeded and synced to Supabase!`)
} else {
  console.log(`⚠️  ${successCount} succeeded, ${failCount} failed.`)
  process.exitCode = 1
}
console.log('')