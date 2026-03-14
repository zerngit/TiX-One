#!/bin/bash
# =============================================================
# TiX-One Step 1: Deploy the smart contract
# Run this ONCE whenever ticket.move is changed.
# Output: saves new IDs to scripts/.deployed-ids.env
# =============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOVE_DIR="$SCRIPT_DIR/../blockchain/tix_one"
OUT_FILE="$SCRIPT_DIR/.deployed-ids.env"

echo ""
echo "🚀  Deploying TiX-One contract to OneChain testnet..."
echo ""

# Deploy and capture JSON output
RESULT=$(one client publish "$MOVE_DIR" \
  --gas-budget 200000000 \
  --json 2>/dev/null)

# ---- Extract Package ID ----
PACKAGE_ID=$(echo "$RESULT" | \
  python3 -c "
import sys, json
data = json.load(sys.stdin)
changes = data.get('objectChanges', [])
for c in changes:
    if c.get('type') == 'published':
        print(c['packageId'])
        break
")

# ---- Extract AdminCap ID ----
ADMIN_CAP_ID=$(echo "$RESULT" | \
  python3 -c "
import sys, json
data = json.load(sys.stdin)
changes = data.get('objectChanges', [])
for c in changes:
    t = c.get('objectType', '')
    if '::ticket::AdminCap' in t and c.get('type') == 'created':
        print(c['objectId'])
        break
")

# ---- Extract ListingRegistry ID ----
LISTING_REGISTRY_ID=$(echo "$RESULT" | \
  python3 -c "
import sys, json
data = json.load(sys.stdin)
changes = data.get('objectChanges', [])
for c in changes:
    t = c.get('objectType', '')
    if '::ticket::ListingRegistry' in t and c.get('type') == 'created':
        print(c['objectId'])
        break
")

# ---- Extract Publisher object ID ----
PUBLISHER_ID=$(echo "$RESULT" | \
  python3 -c "
import sys, json
data = json.load(sys.stdin)
changes = data.get('objectChanges', [])
for c in changes:
    t = c.get('objectType', '')
    if 'package::Publisher' in t and c.get('type') == 'created':
        print(c['objectId'])
        break
")

if [ -z "$PACKAGE_ID" ]; then
  echo "❌ Deploy failed — could not parse Package ID from output."
  echo "$RESULT" | python3 -m json.tool 2>/dev/null || echo "$RESULT"
  exit 1
fi

# ---- Save IDs ----
cat > "$OUT_FILE" <<EOF
PACKAGE_ID=$PACKAGE_ID
ADMIN_CAP_ID=$ADMIN_CAP_ID
LISTING_REGISTRY_ID=$LISTING_REGISTRY_ID
PUBLISHER_ID=$PUBLISHER_ID
EOF

echo "✅  Deployment successful!"
echo ""
echo "  Package ID          : $PACKAGE_ID"
echo "  AdminCap ID         : $ADMIN_CAP_ID"
echo "  ListingRegistry ID  : $LISTING_REGISTRY_ID"
echo "  Publisher ID        : $PUBLISHER_ID"
echo ""
echo "  Saved to: $OUT_FILE"
echo ""

# ---- Auto-patch src/onechain/config.ts with updated IDs ----
CONFIG_FILE="$SCRIPT_DIR/../src/onechain/config.ts"
if [ -f "$CONFIG_FILE" ]; then
  python3 - "$CONFIG_FILE" "$PACKAGE_ID" "$ADMIN_CAP_ID" "$LISTING_REGISTRY_ID" <<'PYEOF'
import sys, re

config_path, pkg, admin, registry = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

with open(config_path, 'r') as f:
    content = f.read()

# Replace multi-line or single-line const string assignments
def replace_const(text, name, new_val):
    # handles:  export const NAME =\n  "old" as const;
    #       or: export const NAME = "old" as const;
    return re.sub(
        r'(export const ' + re.escape(name) + r'\s*=\s*\n?\s*)"[^"]*"',
        r'\g<1>"' + new_val + '"',
        text
    )

content = replace_const(content, 'PACKAGE_ID', pkg)
content = replace_const(content, 'ADMIN_CAP_ID', admin)
content = replace_const(content, 'LISTING_REGISTRY_ID', registry)

with open(config_path, 'w') as f:
    f.write(content)

print(f"  config.ts patched with new IDs.")
PYEOF
  echo "  ✅  src/onechain/config.ts updated automatically."
else
  echo "  ⚠️   config.ts not found at $CONFIG_FILE — update PACKAGE_ID manually."
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  NEXT STEP: Run scripts/3-init-verifier.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
