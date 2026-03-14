#!/bin/bash
# =============================================================
# TiX-One Full Redeploy (dynamic, Supabase-driven)
#
# Steps:
#   1. Deploy contract
#   2. Init BackendVerifier
#   3. Create TransferPolicy
#   4. Seed concerts + waitlists from Supabase and sync IDs back
#
# Usage:
#   bash scripts/redeploy.sh
# =============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║          TiX-One Full Redeploy Pipeline              ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

echo "━━━  STEP 1/5 — Deploy contract  ━━━━━━━━━━━━━━━━━━━━━━"
bash "$SCRIPT_DIR/1-deploy.sh"

echo "━━━  STEP 2/4 — Init BackendVerifier  ━━━━━━━━━━━━━━━━━"
bash "$SCRIPT_DIR/3-init-verifier.sh"

echo "━━━  STEP 3/4 — Create TransferPolicy  ━━━━━━━━━━━━━━━━"
bash "$SCRIPT_DIR/init-transfer-policy.sh"

echo "━━━  STEP 4/4 — Seed from Supabase  ━━━━━━━━━━━━━━━━━━━"
node "$SCRIPT_DIR/2-seed-dynamic.mjs"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✅  Full redeploy complete!                         ║"
echo "║                                                      ║"
echo "║  Next steps:                                         ║"
echo "║  • npm run dev   — start the frontend                ║"
echo "║  • cd backend/discord-squad && node server.js        ║"
echo "║    (only if you need the Squad Room feature)         ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
