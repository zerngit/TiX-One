#!/usr/bin/env bash
# =============================================================
# Create TransferPolicy on-chain and patch config.ts.
# Run after 1-deploy.sh.
# =============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../src/onechain/config.ts"
DEPLOY_IDS="$SCRIPT_DIR/.deployed-ids.env"

if [ ! -f "$DEPLOY_IDS" ]; then
  echo "❌  $DEPLOY_IDS not found — run scripts/1-deploy.sh first."
  exit 1
fi

source "$DEPLOY_IDS"

if [ -z "${PACKAGE_ID:-}" ] || [ -z "${ADMIN_CAP_ID:-}" ] || [ -z "${PUBLISHER_ID:-}" ]; then
  echo "❌  PACKAGE_ID, ADMIN_CAP_ID, or PUBLISHER_ID missing in $DEPLOY_IDS"
  exit 1
fi

echo ""
echo "📜  Creating TransferPolicy on-chain..."
echo "    Package   : $PACKAGE_ID"
echo "    Admin Cap : $ADMIN_CAP_ID"
echo "    Publisher : $PUBLISHER_ID"
echo ""

RESULT=$(one client call \
  --package "$PACKAGE_ID" \
  --module ticket \
  --function create_transfer_policy \
  --args "$ADMIN_CAP_ID" "$PUBLISHER_ID" \
  --gas-budget 100000000 \
  --json 2>/dev/null)

TRANSFER_POLICY_ID=$(echo "$RESULT" | \
  python3 -c "
import sys, json
data = json.load(sys.stdin)
for c in data.get('objectChanges', []):
    t = c.get('objectType', '')
    owner = c.get('owner', {})
    if 'transfer_policy::TransferPolicy<' in t and c.get('type') == 'created':
        if isinstance(owner, dict) and 'Shared' in owner:
            print(c['objectId'])
            break
")

if [ -z "$TRANSFER_POLICY_ID" ]; then
  echo "❌  Failed to parse TransferPolicy ID from output."
  echo "$RESULT" | python3 -m json.tool 2>/dev/null || echo "$RESULT"
  exit 1
fi

python3 - "$CONFIG_FILE" "$TRANSFER_POLICY_ID" <<'PYEOF'
import sys, re

config_path, policy_id = sys.argv[1], sys.argv[2]

with open(config_path, 'r') as f:
    content = f.read()

content = re.sub(
    r'(export const TRANSFER_POLICY_ID\s*=\s*\n?\s*)"[^"]*"',
    r'\g<1>"' + policy_id + '"',
    content,
)

with open(config_path, 'w') as f:
    f.write(content)

print('  ✅  config.ts updated.')
PYEOF

if grep -q '^TRANSFER_POLICY_ID=' "$DEPLOY_IDS"; then
  sed -i "s|^TRANSFER_POLICY_ID=.*|TRANSFER_POLICY_ID=$TRANSFER_POLICY_ID|" "$DEPLOY_IDS"
else
  echo "TRANSFER_POLICY_ID=$TRANSFER_POLICY_ID" >> "$DEPLOY_IDS"
fi

echo "✅  TransferPolicy created: $TRANSFER_POLICY_ID"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  NEXT STEP: node scripts/2-seed-dynamic.mjs"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""