#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ -e .env ]; then
  echo '.env already exists; leaving it unchanged.'
  exit 0
fi
umask 077
cat > .env <<ENV
APP_ORIGIN=http://localhost:8097
POSTGRES_PASSWORD=$(openssl rand -hex 24)
OPERATOR_PASSWORD=$(openssl rand -hex 24)
BROADCAST_PASSWORD=$(openssl rand -hex 24)
LIVEKIT_API_KEY=hencor-local
LIVEKIT_API_SECRET=$(openssl rand -hex 32)
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_NODE_IP=127.0.0.1
ENV
echo 'Created private .env for localhost. Role credentials are stored in that file.'
