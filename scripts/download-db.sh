#!/bin/bash
# Download and extract data.db from GitHub Release
DB_FILE="data.db"
DB_GZ="data.db.gz"
RELEASE_URL="https://github.com/Abooood11/Arabic-Legal-Platform/releases/download/v1.0-data/data.db.gz"

if [ -f "$DB_FILE" ] && [ $(stat -f%z "$DB_FILE" 2>/dev/null || stat -c%s "$DB_FILE" 2>/dev/null) -gt 1000000 ]; then
    echo "data.db already exists and is valid. Skipping download."
    exit 0
fi

echo "Downloading data.db.gz from GitHub Release..."
curl -L -o "$DB_GZ" "$RELEASE_URL"

echo "Extracting data.db..."
gunzip -f "$DB_GZ"

echo "Done! data.db size: $(du -h $DB_FILE | cut -f1)"
