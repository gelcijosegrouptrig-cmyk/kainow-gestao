#!/bin/bash
# ============================================================
# deploy-cloudflare.sh — Kainow Gestão · Cloudflare Pages Deploy
# Account ID : ef4dfafae6fc56ebf84a3b58aa7d8b45
# Zone ID    : 946e46e374ec646894e3b75a6f6cfe27
# Project    : kainow-gestao
# ============================================================
# Usage:
#   CF_API_TOKEN=<your_token> ./deploy-cloudflare.sh
# ============================================================

set -e

ACCOUNT_ID="ef4dfafae6fc56ebf84a3b58aa7d8b45"
ZONE_ID="946e46e374ec646894e3b75a6f6cfe27"
PROJECT_NAME="kainow-gestao"
BRANCH="genspark_ai_developer"
OUTPUT_DIR="frontend/public"

if [ -z "$CF_API_TOKEN" ]; then
  echo "❌  CF_API_TOKEN is required."
  echo ""
  echo "  1. Go to: https://dash.cloudflare.com/profile/api-tokens"
  echo "  2. Create token with: Cloudflare Pages - Edit"
  echo "  3. Run: CF_API_TOKEN=<token> ./deploy-cloudflare.sh"
  exit 1
fi

export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"

echo "🚀 Deploying Kainow Gestão → Cloudflare Pages"
echo "   Account : $ACCOUNT_ID"
echo "   Zone    : $ZONE_ID"
echo "   Project : $PROJECT_NAME"
echo "   Branch  : $BRANCH"
echo "   Dir     : $OUTPUT_DIR"
echo ""

# ── Step 1: Create project if it doesn't exist ──────────────
echo "📋 Checking / creating Pages project…"
wrangler pages project create "$PROJECT_NAME" \
  --production-branch main 2>/dev/null || echo "   (project may already exist — continuing)"

# ── Step 2: Deploy frontend static files ────────────────────
echo ""
echo "📦 Deploying static frontend…"
wrangler pages deploy "$OUTPUT_DIR" \
  --project-name "$PROJECT_NAME" \
  --branch "$BRANCH" \
  --commit-message "Deploy: page-header banners + topbar fix v3.1"

echo ""
echo "✅ Deploy complete!"
echo ""
echo "🌐 Your site will be available at:"
echo "   https://${PROJECT_NAME}.pages.dev"
echo "   https://${BRANCH}.${PROJECT_NAME}.pages.dev  (branch preview)"
echo ""
echo "📌 Next steps:"
echo "   • Add custom domain in Cloudflare Dashboard"
echo "   • Set Zone ${ZONE_ID} DNS: CNAME @ → ${PROJECT_NAME}.pages.dev"
echo "   • Configure backend API URL in dashboard.html (replace localhost:3001)"
