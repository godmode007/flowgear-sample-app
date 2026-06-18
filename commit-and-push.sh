#!/usr/bin/env bash
# Commit and push the Adjustments support feature.
# Run from the repo root:  bash commit-and-push.sh
set -euo pipefail

BRANCH="Development"

cd "$(dirname "$0")"

# Stage only the adjustment-feature files (leaves unrelated working-tree edits untouched).
git add \
  src/models/receiptConfirmation.ts \
  src/utils/ordersListParser.ts \
  src/services/payloadService.ts \
  src/components/ReceiptEditor.tsx \
  src/components/OrderListPanel.tsx \
  src/components/App.tsx \
  src/index.scss

git commit -m "Add inventory Adjustment support alongside Receipts

- Parse Adjustment ({\"Adjustment\":...}) envelopes from Content/SourcePayload
- Edit via a shared Receipt_Confirmation view; capture unit rate as before
- Write captured rate back as Gross_Price (rate x net weight/qty) on post
- Post adjustments to /v2/Adjustments; receipts stay on /v2/ProcurementInbound
- Type badge in list + dynamic record-type header labels in the editor"

git push origin "$BRANCH"

echo "Pushed to origin/$BRANCH."
