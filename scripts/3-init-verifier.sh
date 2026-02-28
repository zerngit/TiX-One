#!/usr/bin/env bash
# ============================================================
# scripts/3-init-verifier.sh
# Generates an Ed25519 keypair, initialises the BackendVerifier
# shared object on-chain, and wires the keys into server.js .env
# and src/onechain/config.ts automatically.
#
# Prerequisites:
#   1-deploy.sh already ran   →  PACKAGE_ID / ADMIN_CAP_ID known
#   node is available on PATH
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
CONFIG_FILE="$ROOT/src/onechain/config.ts"
BACKEND_ENV="$ROOT/backend/discord-squad/.env"
DEPLOY_IDS="$SCRIPT_DIR/.deployed-ids.env"

# ── Load deployed IDs ──────────────────────────────────────
if [ ! -f "$DEPLOY_IDS" ]; then
  echo "❌  $DEPLOY_IDS not found — run 1-deploy.sh first."
  exit 1
fi
source "$DEPLOY_IDS"

echo ""
echo "🔑  Generating Ed25519 keypair with Node.js..."

# Generate raw 32-byte seed (private) and 32-byte public key
KEY_OUTPUT=$(node -e "
const { generateKeyPairSync } = require('crypto');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');

// PKCS8 DER for Ed25519: 48 bytes total, last 32 = seed
const privDer = privateKey.export({ type: 'pkcs8', format: 'der' });
const privSeed = privDer.slice(privDer.length - 32).toString('hex');

// SPKI DER for Ed25519: 44 bytes total, last 32 = raw public key
const pubDer = publicKey.export({ type: 'spki', format: 'der' });
const pubHex  = pubDer.slice(pubDer.length - 32).toString('hex');

process.stdout.write(privSeed + ' ' + pubHex);
")

PRIV_HEX=$(echo "$KEY_OUTPUT" | cut -d' ' -f1)
PUB_HEX=$(echo  "$KEY_OUTPUT" | cut -d' ' -f2)

echo "   Private seed : ${PRIV_HEX:0:16}… (stored in backend/.env)"
echo "   Public key   : $PUB_HEX"

# ── Convert public key hex → vector<u8> for Move CLI ──────
PUB_BYTES_ARG=$(python3 -c "
h = '$PUB_HEX'
bs = [str(int(h[i:i+2], 16)) for i in range(0, len(h), 2)]
print('[' + ','.join(bs) + ']')
")

# ── Generate HMAC secret for fan-approval tokens ──────────
HMAC_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")

# ── Call initialize_verifier on-chain ─────────────────────
echo ""
echo "📤  Calling initialize_verifier on-chain..."

RESULT=$(one client call \
  --package "$PACKAGE_ID" \
  --module ticket \
  --function initialize_verifier \
  --args "$ADMIN_CAP_ID" "$PUB_BYTES_ARG" \
  --gas-budget 10000000 \
  --json 2>/dev/null)

VERIFIER_ID=$(echo "$RESULT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for c in data.get('objectChanges', []):
    if '::ticket::BackendVerifier' in c.get('objectType', '') and c.get('type') == 'created':
        print(c['objectId'])
        break
" 2>/dev/null)

if [ -z "$VERIFIER_ID" ]; then
  echo "❌  Failed to extract BackendVerifier object ID from transaction output."
  echo "    Raw result: $RESULT"
  exit 1
fi

echo "   ✅  BackendVerifier : $VERIFIER_ID"

# ── Update src/onechain/config.ts ─────────────────────────
python3 -c "
import re

with open('$CONFIG_FILE', 'r') as f:
    content = f.read()

# Add or replace BACKEND_VERIFIER_ID
if 'BACKEND_VERIFIER_ID' in content:
    content = re.sub(
        r'(export const BACKEND_VERIFIER_ID\s*=\s*\")[^\"]*(\";?)',
        r'\g<1>$VERIFIER_ID\g<2>',
        content,
    )
else:
    content = content.rstrip() + '\nexport const BACKEND_VERIFIER_ID = \"$VERIFIER_ID\"\n'

with open('$CONFIG_FILE', 'w') as f:
    f.write(content)

print('   ✅  config.ts updated')
"

# ── Update backend/.env ───────────────────────────────────
update_or_append() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" "$BACKEND_ENV" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$BACKEND_ENV"
  else
    echo "${key}=${val}" >> "$BACKEND_ENV"
  fi
}

update_or_append "BACKEND_ED25519_PRIVATE_KEY" "$PRIV_HEX"
update_or_append "BACKEND_ED25519_PUBLIC_KEY"  "$PUB_HEX"
update_or_append "FAN_TOKEN_HMAC_SECRET"       "$HMAC_SECRET"

echo "   ✅  backend/.env updated"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  BackendVerifier ID : $VERIFIER_ID"
echo "  Public Key         : $PUB_HEX"
echo "  ⚠️   Private key and HMAC secret saved ONLY to backend/.env"
echo "      Never commit backend/.env to git!"
echo ""
echo "  NEXT STEPS:"
echo "  1. Restart the backend: cd backend/discord-squad && node server.js"
echo "  2. Re-run the frontend (npm run dev) — config.ts now has"
echo "     BACKEND_VERIFIER_ID wired in."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
