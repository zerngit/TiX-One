#!/bin/bash
# TiX-One Admin Setup Script
# Run this once after deploying a new contract version

set -e

echo "🎫 TiX-One Admin Setup"
echo "====================="
echo ""

# Configuration
PACKAGE_ID="0x2ccc463b541701e399125048cfd9f022499eb7b0aa455cfefbac6ef89f5fcc82"
ADMIN_CAP_ID="0xac2a2213bf63874b5e47adf961e882978cf1bddafd0cb1c9e28011a734b00364"

echo "📦 Package ID: $PACKAGE_ID"
echo "🔑 AdminCap ID: $ADMIN_CAP_ID"
echo ""

# Step 1: Get Publisher ID
echo "Step 1: Finding Publisher object..."
PUBLISHER_ID=$(one client objects 2>&1 | grep -A 20 "Publisher" | grep "0x" | head -1 | awk '{print $1}')

if [ -z "$PUBLISHER_ID" ]; then
    echo "❌ Publisher not found. Please check your deployment."
    exit 1
fi

echo "✅ Publisher ID: $PUBLISHER_ID"
echo ""

# Step 2: Create TransferPolicy
echo "Step 2: Creating TransferPolicy with PriceCapRule..."
echo "This enables resale price enforcement on all marketplaces."
echo ""

read -p "Press Enter to create TransferPolicy..."

one client call \
  --package "$PACKAGE_ID" \
  --module ticket \
  --function create_transfer_policy \
  --args "$ADMIN_CAP_ID" "$PUBLISHER_ID" \
  --gas-budget 100000000

echo ""
echo "✅ Setup Complete!"
echo ""
echo "Next Steps:"
echo "1. Run 'npm run dev' in the repo root (TiX-One/)"
echo "2. Buy a test ticket"
echo "3. Set up Kiosk"
echo "4. List ticket on global market"
echo ""
