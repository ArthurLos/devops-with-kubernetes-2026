#!/usr/bin/env bash
set -euo pipefail

RANDOM_ARTICLE_URL="https://en.wikipedia.org/wiki/Special:Random"
TODO_BACKEND_URL="${TODO_BACKEND_URL:?TODO_BACKEND_URL must be set}"

# Special:Random responds with a redirect to a random article; we only want
# where it points to, not the page itself.
ARTICLE_URL=$(curl -s -o /dev/null -w '%{redirect_url}' "$RANDOM_ARTICLE_URL")

if [ -z "$ARTICLE_URL" ]; then
  echo "No redirect URL received from $RANDOM_ARTICLE_URL, aborting"
  exit 1
fi

TEXT="Read $ARTICLE_URL"
echo "Adding todo: $TEXT"

curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d "$(printf '{"text":"%s"}' "$TEXT")" \
  "$TODO_BACKEND_URL"
echo
