#!/usr/bin/env bash
set -euo pipefail

# Bundle size checker for logscope
# Usage: ./scripts/check-size.sh [--no-build]

MAX_GZIP_BYTES=10240 # 10 KB target
DIST_DIR="packages/logscope/dist"

# Build unless --no-build is passed (handle pnpm's extra -- arg)
skip_build=false
for arg in "$@"; do
  [[ "$arg" == "--no-build" ]] && skip_build=true
done
if [[ "$skip_build" == false ]]; then
  echo "Building..."
  pnpm build --silent 2>/dev/null
  echo ""
fi

if [[ ! -d "$DIST_DIR" ]]; then
  echo "Error: $DIST_DIR not found. Run pnpm build first."
  exit 1
fi

# Header
printf "%-24s %10s %10s\n" "File" "Raw" "Gzip"
printf "%-24s %10s %10s\n" "------------------------" "----------" "----------"

total_raw=0
total_gzip=0

# Runtime-specific util files — only one is loaded per environment,
# so count only the largest for the total (worst case).
util_variants=()

# Measure each ESM JS file (skip .d.ts, .map, .cjs)
for file in "$DIST_DIR"/*.js; do
  basename=$(basename "$file")

  # Skip declaration and sourcemap files
  [[ "$basename" == *.d.ts ]] && continue
  [[ "$basename" == *.map ]] && continue

  raw=$(wc -c < "$file")
  gzip=$(gzip -c "$file" | wc -c)

  # Format as human-readable KB
  raw_kb=$(awk "BEGIN { printf \"%.2f KB\", $raw / 1024 }")
  gzip_kb=$(awk "BEGIN { printf \"%.2f KB\", $gzip / 1024 }")

  # Track runtime-specific util variants separately
  if [[ "$basename" == util.js || "$basename" == util.node.js || "$basename" == util.deno.js ]]; then
    printf "%-24s %10s %10s  (runtime-specific)\n" "$basename" "$raw_kb" "$gzip_kb"
    util_variants+=("$gzip")
  else
    printf "%-24s %10s %10s\n" "$basename" "$raw_kb" "$gzip_kb"
    total_raw=$((total_raw + raw))
    total_gzip=$((total_gzip + gzip))
  fi
done

# Add the largest util variant to the total (worst-case size)
max_util_gzip=0
for v in "${util_variants[@]}"; do
  if [[ $v -gt $max_util_gzip ]]; then
    max_util_gzip=$v
  fi
done
total_gzip=$((total_gzip + max_util_gzip))

# Totals
printf "%-24s %10s %10s\n" "------------------------" "----------" "----------"
total_gzip_kb=$(awk "BEGIN { printf \"%.2f KB\", $total_gzip / 1024 }")
printf "%-24s %10s %10s\n" "Total (ESM, worst-case)" "" "$total_gzip_kb"

# Pass/fail check
echo ""
if [[ $total_gzip -gt $MAX_GZIP_BYTES ]]; then
  echo "FAIL: Gzipped size (${total_gzip_kb}) exceeds target ($(awk "BEGIN { printf \"%.2f KB\", $MAX_GZIP_BYTES / 1024 }"))"
  exit 1
else
  echo "PASS: Gzipped size (${total_gzip_kb}) is within target ($(awk "BEGIN { printf \"%.2f KB\", $MAX_GZIP_BYTES / 1024 }"))"
fi
