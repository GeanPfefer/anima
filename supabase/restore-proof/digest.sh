#!/usr/bin/env bash
# Operational Durability — canonical security digest (READ-ONLY).
# usage: supabase/restore-proof/digest.sh <db-container> <out-prefix>
#   writes <out-prefix>.rows   (projection rows; keep OUT of Git — local evidence only)
#   writes <out-prefix>.digest (projection <TAB> count <TAB> sha256; safe to record)
# Digest = sha256 of the projection's rows sorted with LC_ALL=C, "\n"-joined with trailing "\n".
set -euo pipefail
docker exec -i "$1" psql -U postgres -d postgres -X -A -t -q < "$(dirname "$0")/security-projection.sql" | LC_ALL=C sort > "$2.rows"
for p in $(cut -f1 "$2.rows" | LC_ALL=C sort -u); do
  n=$(awk -F'\t' -v p="$p" '$1==p' "$2.rows" | wc -l)
  h=$(awk -F'\t' -v p="$p" '$1==p{print substr($0, length(p)+2)}' "$2.rows" | LC_ALL=C sort | sha256sum | cut -c1-64)
  printf '%s\t%s\t%s\n' "$p" "$n" "$h"
done > "$2.digest"
