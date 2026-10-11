#!/bin/bash
# Extract all unique values from Azure Updates API by fetching all data
# This script fetches all items and extracts unique values to verify completeness
# Usage: ./extract-facets.sh [output_dir]
#
# NOTE: This script fetches ALL data (9000+ items) which may take a few minutes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${1:-${SCRIPT_DIR}/../assets}"
API_URL="https://www.microsoft.com/releasecommunications/api/v2/azure"
PAGE_SIZE=100

# Create output directory if it doesn't exist
mkdir -p "${OUTPUT_DIR}"

echo "Fetching total count..."
TOTAL=$(curl -s "${API_URL}?\$count=true&top=0" | jq '.["@odata.count"]')
echo "Total items: ${TOTAL}"

# Calculate number of pages
PAGES=$(( (TOTAL + PAGE_SIZE - 1) / PAGE_SIZE ))
echo "Pages to fetch: ${PAGES} (${PAGE_SIZE} items per page)"

# Create temp file for all data
TEMP_FILE=$(mktemp)
trap "rm -f ${TEMP_FILE}" EXIT

echo "Fetching all data..."
echo "[" > "${TEMP_FILE}"

for ((i=0; i<PAGES; i++)); do
    SKIP=$((i * PAGE_SIZE))
    PROGRESS=$(( (i + 1) * 100 / PAGES ))
    echo -ne "\r  Progress: ${PROGRESS}% (page $((i+1))/${PAGES})"
    
    if [ $i -gt 0 ]; then
        echo "," >> "${TEMP_FILE}"
    fi
    
    curl -s "${API_URL}?top=${PAGE_SIZE}&skip=${SKIP}" | jq -c '.value[]' | paste -sd ',' >> "${TEMP_FILE}"
done

echo "]" >> "${TEMP_FILE}"
echo ""
echo "Data fetched. Extracting unique values..."

# Parse the temp file and extract unique values
ALL_DATA=$(cat "${TEMP_FILE}")

# Extract unique productCategories
echo "Extracting productCategories..."
echo "${ALL_DATA}" | jq -r '.[].productCategories[]?' 2>/dev/null | sort -u > "${OUTPUT_DIR}/product-categories.txt"
CATEGORY_COUNT=$(wc -l < "${OUTPUT_DIR}/product-categories.txt" | tr -d ' ')
echo "  -> ${CATEGORY_COUNT} unique categories"

# Extract unique tags
echo "Extracting tags..."
echo "${ALL_DATA}" | jq -r '.[].tags[]?' 2>/dev/null | sort -u > "${OUTPUT_DIR}/tags.txt"
TAGS_COUNT=$(wc -l < "${OUTPUT_DIR}/tags.txt" | tr -d ' ')
echo "  -> ${TAGS_COUNT} unique tags"

# Extract unique products
echo "Extracting products..."
echo "${ALL_DATA}" | jq -r '.[].products[]?' 2>/dev/null | sort -u > "${OUTPUT_DIR}/products.txt"
PRODUCT_COUNT=$(wc -l < "${OUTPUT_DIR}/products.txt" | tr -d ' ')
echo "  -> ${PRODUCT_COUNT} unique products"

# Extract unique status values
echo "Extracting status values..."
echo "${ALL_DATA}" | jq -r '.[].status // empty' 2>/dev/null | sort -u > "${OUTPUT_DIR}/status.txt"
STATUS_COUNT=$(wc -l < "${OUTPUT_DIR}/status.txt" | tr -d ' ')
echo "  -> ${STATUS_COUNT} unique statuses"

# Extract unique availability rings
echo "Extracting availability rings..."
echo "${ALL_DATA}" | jq -r '.[].availabilities[]?.ring // empty' 2>/dev/null | sort -u > "${OUTPUT_DIR}/availability-rings.txt"
RING_COUNT=$(wc -l < "${OUTPUT_DIR}/availability-rings.txt" | tr -d ' ')
echo "  -> ${RING_COUNT} unique rings"

# Create a summary with counts and extraction method
cat > "${OUTPUT_DIR}/facets-summary.json" << EOF
{
  "extractedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "extractionMethod": "full-scan",
  "totalItems": ${TOTAL},
  "facets": {
    "productCategories": ${CATEGORY_COUNT},
    "tags": ${TAGS_COUNT},
    "products": ${PRODUCT_COUNT},
    "status": ${STATUS_COUNT},
    "availabilityRings": ${RING_COUNT}
  }
}
EOF

echo ""
echo "Done! Files saved to: ${OUTPUT_DIR}"
echo "  - product-categories.txt (${CATEGORY_COUNT} items)"
echo "  - tags.txt (${TAGS_COUNT} items)"
echo "  - products.txt (${PRODUCT_COUNT} items)"
echo "  - status.txt (${STATUS_COUNT} items)"
echo "  - availability-rings.txt (${RING_COUNT} items)"
echo "  - facets-summary.json"
