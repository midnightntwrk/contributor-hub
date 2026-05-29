#!/usr/bin/env bash
# midnight-healthcheck.sh — One-command node health check
# Usage: bash midnight-healthcheck.sh [--watch] [--alert]
#
# Part of the "Running a Midnight Node" tutorial
# Issue: https://github.com/midnightntwrk/contributor-hub/issues/323

set -euo pipefail

RPC_HOST="${MIDNIGHT_RPC_HOST:-127.0.0.1:9944}"
ALERT_PEER_THRESHOLD="${ALERT_PEER_MIN:-3}"
ALERT_SYNC_LAG="${ALERT_SYNC_LAG:-50}"

rpc_call() {
  curl -sf -H "Content-Type: application/json" \
    -d "{\"id\":1,\"jsonrpc\":\"2.0\",\"method\":\"$1\"}" \
    "http://${RPC_HOST}" 2>/dev/null
}

check_health() {
  local health sync_state

  health=$(rpc_call "system_health" | jq -r '.result')
  sync_state=$(rpc_call "system_syncState" | jq -r '.result')

  local is_syncing peers current_block target_block
  is_syncing=$(echo "$health" | jq '.isSyncing')
  peers=$(echo "$health" | jq '.peers')
  current_block=$(echo "$sync_state" | jq '.currentBlock')
  target_block=$(echo "$sync_state" | jq '.highestBlock')

  local sync_pct=0
  if [ "$target_block" -gt 0 ]; then
    sync_pct=$(( current_block * 100 / target_block ))
  fi

  local status="✅ HEALTHY"
  local issues=""

  if [ "$is_syncing" = "true" ]; then
    status="🔄 SYNCING"
  fi

  if [ "$peers" -lt "$ALERT_PEER_THRESHOLD" ]; then
    status="⚠️ LOW PEERS"
    issues="${issues}PEERS=${peers} (<${ALERT_PEER_THRESHOLD}) "
  fi

  local lag=$(( target_block - current_block ))
  if [ "$lag" -gt "$ALERT_SYNC_LAG" ] && [ "$is_syncing" = "false" ]; then
    status="⚠️ STALE"
    issues="${issues}LAG=${lag} (>${ALERT_SYNC_LAG}) "
  fi

  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ${status}"
  echo "  Block: ${current_block}/${target_block} (${sync_pct}%)"
  echo "  Peers: ${peers} | Syncing: ${is_syncing}"
  [ -n "$issues" ] && echo "  Issues: ${issues}"

  # Return non-zero for alert mode
  if [ "$1" = "--alert" ] && [ "$status" != "✅ HEALTHY" ]; then
    return 1
  fi
  return 0
}

# --- Main ---
if [ "${1:-}" = "--watch" ]; then
  while true; do
    check_health "" 2>/dev/null || true
    echo "---"
    sleep 30
  done
else
  check_health "${1:-}"
fi
