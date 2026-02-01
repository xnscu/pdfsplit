#!/bin/bash

# D1 Migration Script - Apply questions table composite primary key migration
# This fixes the "PRIMARY KEY constraint" error when uploading ZIP files

set -e

echo "🔄 Starting D1 Migration..."
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Error: wrangler CLI is not installed"
    echo "Please install it with: npm install -g wrangler"
    exit 1
fi

# Database name from wrangler.toml
DB_NAME="gksx"
MIGRATION_FILE="./migrations/001_questions_composite_pk.sql"

echo "📊 Database: $DB_NAME"
echo "📄 Migration: $MIGRATION_FILE"
echo ""

# Ask for confirmation
read -p "⚠️  This will modify the questions table structure. Continue? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Migration cancelled"
    exit 0
fi

echo ""
echo "🚀 Applying migration to PRODUCTION database..."
wrangler d1 execute $DB_NAME --file=$MIGRATION_FILE

echo ""
echo "✅ Production migration completed!"
echo ""

# Ask if also want to migrate local
read -p "📦 Also apply to LOCAL development database? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "🚀 Applying migration to LOCAL database..."
    wrangler d1 execute $DB_NAME --local --file=$MIGRATION_FILE
    echo ""
    echo "✅ Local migration completed!"
fi

echo ""
echo "🎉 All migrations completed successfully!"
echo ""
echo "Next steps:"
echo "  1. Test uploading a ZIP file"
echo "  2. Verify no PRIMARY KEY conflicts"
echo "  3. Check data in D1 console"
