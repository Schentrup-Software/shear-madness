#!/usr/bin/env bash
set -e

PB_VERSION="0.28.2"
PB_DIR="/workspaces/shear-madness/.local-pocketbase"
PB_DATA="$PB_DIR/pb_data"
PB_BIN="$PB_DIR/pocketbase"
SCHEMA_FILE="/workspaces/shear-madness/app/backend/pb_schema.json"
ENV_FILE="/workspaces/shear-madness/.env.development.local"

ADMIN_EMAIL="admin@local.test"
ADMIN_PASSWORD="admin12345678"
PB_URL="http://localhost:8090"

mkdir -p "$PB_DATA"

# Download PocketBase binary if not already present
if [ ! -f "$PB_BIN" ]; then
  echo "Downloading PocketBase v${PB_VERSION}..."
  curl -fsSL "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" -o /tmp/pb.zip
  unzip -o /tmp/pb.zip -d "$PB_DIR" pocketbase
  chmod +x "$PB_BIN"
  rm /tmp/pb.zip
  echo "PocketBase downloaded."
fi

# Stop any existing instance on port 8090
pkill -f "pocketbase serve.*8090" 2>/dev/null || true
sleep 1

# Start PocketBase in the background
"$PB_BIN" serve --http=0.0.0.0:8090 --dir="$PB_DATA" > "$PB_DIR/pb.log" 2>&1 &
echo "PocketBase started (PID $!), log: $PB_DIR/pb.log"

# Wait up to 30 seconds for PocketBase to be ready
echo "Waiting for PocketBase to be ready..."
for i in $(seq 1 30); do
  if curl -sf "$PB_URL/api/health" > /dev/null 2>&1; then
    echo "PocketBase is ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: PocketBase did not start in time. Check $PB_DIR/pb.log"
    exit 1
  fi
  sleep 1
done

# Create (or update) the superuser — idempotent
"$PB_BIN" superuser upsert "$ADMIN_EMAIL" "$ADMIN_PASSWORD" --dir="$PB_DATA"

# Authenticate to get a token for API calls
TOKEN=$(curl -sf -X POST "$PB_URL/api/collections/_superusers/auth-with-password" \
  -H "Content-Type: application/json" \
  -d "{\"identity\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "ERROR: Could not authenticate as superuser."
  exit 1
fi

# Import collections schema (non-destructive: deleteMissing=false)
echo "Importing schema..."
curl -sf -X PUT "$PB_URL/api/collections/import" \
  -H "Content-Type: application/json" \
  -H "Authorization: $TOKEN" \
  -d "{\"collections\":$(cat "$SCHEMA_FILE"),\"deleteMissing\":false}" > /dev/null
echo "Schema imported."

# Disable rate limiting so integration tests can run without delays
echo "Disabling rate limits..."
curl -sf -X PATCH "$PB_URL/api/settings" \
  -H "Content-Type: application/json" \
  -H "Authorization: $TOKEN" \
  -d '{"rateLimits":{"enabled":false,"rules":[]}}' > /dev/null
echo "Rate limiting disabled."

# Write the Vite env file so the dev server and tests use the local PocketBase
echo "VITE_POCKETBASE_URL=$PB_URL" > "$ENV_FILE"
echo "Wrote $ENV_FILE"

echo ""
echo "Local PocketBase ready at $PB_URL"
echo "  Admin panel: $PB_URL/_/"
echo "  Login: $ADMIN_EMAIL / $ADMIN_PASSWORD"
