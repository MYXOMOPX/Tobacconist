#!/usr/bin/env bash
set -euo pipefail
: "${BOT_TOKEN:?set BOT_TOKEN}"
: "${PUBLIC_URL:?set PUBLIC_URL}"

curl -sS "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -d "url=${PUBLIC_URL}/telegram/webhook"
echo
curl -sS "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"
echo
