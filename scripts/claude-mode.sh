#!/usr/bin/env bash
# claude-mode.sh — toggle Claude Code between native Anthropic auth and the AIClient2API proxy.
#
# Usage:
#   claude-mode.sh on        # switch to proxy (AIClient2API)
#   claude-mode.sh off       # switch to native Anthropic
#   claude-mode.sh status    # show current mode
#
# When sourced (not executed), this file also exports `claude-proxy` / `claude-native` /
# `claude-mode-status` as shell functions that update the *parent* shell's env vars in addition
# to the persistent settings.json. That's the only way Claude Code picks up the change without
# a full restart.

# Detect sourced vs executed across bash AND zsh. We deliberately do NOT use `set -u` /
# `set -o pipefail` here — those would leak into the parent shell when sourced and break
# unrelated hooks (Amazon Q's `Q_DOTFILES_SOURCED`, fig's `precmd_functions`, etc.).
_claude_mode_sourced=0
if [ -n "${ZSH_VERSION:-}" ]; then
  # zsh: ZSH_EVAL_CONTEXT ends with ":file" when sourced from a file
  case "${ZSH_EVAL_CONTEXT:-}" in
    *:file*) _claude_mode_sourced=1 ;;
  esac
elif [ -n "${BASH_VERSION:-}" ]; then
  # bash: BASH_SOURCE[0] differs from $0 when sourced
  [ "${BASH_SOURCE[0]}" != "${0}" ] && _claude_mode_sourced=1
fi

CLAUDE_SETTINGS_FILE="${CLAUDE_SETTINGS_FILE:-$HOME/.claude/settings.json}"
CLAUDE_PROXY_BACKUP_FILE="${CLAUDE_PROXY_BACKUP_FILE:-$HOME/.claude/proxy_settings_backup.json}"

# Single source of truth for the proxy address/token. Override via env before sourcing.
: "${AICLIENT_BASE:=http://127.0.0.1:3000}"
: "${AICLIENT_TOKEN:=}"

_claude_mode_require_jq() {
  if ! command -v jq &>/dev/null; then
    echo "ERROR: 'jq' is required. Install with: brew install jq" >&2
    return 1
  fi
}

_claude_mode_proxy_alive() {
  [ -n "$AICLIENT_TOKEN" ] || return 1
  curl -sf -o /dev/null --max-time 2 \
    -H "Authorization: Bearer $AICLIENT_TOKEN" \
    "$AICLIENT_BASE/v1/models" 2>/dev/null
}

# Persist (or remove) the proxy env block inside Claude Code's settings.json.
_claude_mode_write_settings() {
  local mode="$1" base="$2" token="$3"
  _claude_mode_require_jq || return 1
  [ -f "$CLAUDE_SETTINGS_FILE" ] || printf '{}' >"$CLAUDE_SETTINGS_FILE"

  local tmp="${CLAUDE_SETTINGS_FILE}.tmp.$$"
  if [ "$mode" = "on" ]; then
    jq --arg base "$base" --arg token "$token" \
      '.env = (.env // {}) | .env.ANTHROPIC_BASE_URL = $base | .env.ANTHROPIC_AUTH_TOKEN = $token' \
      "$CLAUDE_SETTINGS_FILE" >"$tmp" && mv "$tmp" "$CLAUDE_SETTINGS_FILE"
  else
    jq 'if has("env") then .env |= (del(.ANTHROPIC_BASE_URL, .ANTHROPIC_AUTH_TOKEN)) else . end' \
      "$CLAUDE_SETTINGS_FILE" >"$tmp" && mv "$tmp" "$CLAUDE_SETTINGS_FILE"
  fi
}

claude-proxy() {
  _claude_mode_require_jq || return 1

  if [ -z "$AICLIENT_TOKEN" ]; then
    echo "ERROR: AICLIENT_TOKEN is empty. Export it (or source ~/.zshrc) before toggling." >&2
    return 1
  fi

  local base="$AICLIENT_BASE" token="$AICLIENT_TOKEN"
  if [ -f "$CLAUDE_PROXY_BACKUP_FILE" ]; then
    local backup_base backup_token
    backup_base="$(jq -r '.ANTHROPIC_BASE_URL // empty' "$CLAUDE_PROXY_BACKUP_FILE")"
    backup_token="$(jq -r '.ANTHROPIC_AUTH_TOKEN // empty' "$CLAUDE_PROXY_BACKUP_FILE")"
    [ -n "$backup_base" ] && base="$backup_base"
    [ -n "$backup_token" ] && token="$backup_token"
  fi

  _claude_mode_write_settings on "$base" "$token" || return 1
  export ANTHROPIC_BASE_URL="$base"
  export ANTHROPIC_API_KEY="$token"
  export ANTHROPIC_AUTH_TOKEN="$token"

  if ! _claude_mode_proxy_alive; then
    echo "WARN: Proxy at $base did not respond. Run 'start-proxies' (or 'npm start' in the AIClient2API dir)." >&2
  fi
  echo "✅ Claude Code → PROXY mode ($base)"
}

claude-native() {
  _claude_mode_require_jq || return 1

  # Back up current proxy settings (if any) before removing them.
  if [ -f "$CLAUDE_SETTINGS_FILE" ]; then
    local has_proxy
    has_proxy="$(jq -r '(.env // {}) | (has("ANTHROPIC_BASE_URL") or has("ANTHROPIC_AUTH_TOKEN"))' "$CLAUDE_SETTINGS_FILE" 2>/dev/null || echo false)"
    if [ "$has_proxy" = "true" ]; then
      jq '.env // {} | {ANTHROPIC_BASE_URL: (.ANTHROPIC_BASE_URL // ""), ANTHROPIC_AUTH_TOKEN: (.ANTHROPIC_AUTH_TOKEN // "")}' \
        "$CLAUDE_SETTINGS_FILE" >"$CLAUDE_PROXY_BACKUP_FILE"
    fi
  fi

  _claude_mode_write_settings off "" "" || return 1
  unset ANTHROPIC_BASE_URL
  unset ANTHROPIC_API_KEY
  unset ANTHROPIC_AUTH_TOKEN

  echo "✅ Claude Code → NATIVE mode (Anthropic direct)"
}

claude-mode-status() {
  local settings_mode="unknown"
  local env_mode="unknown"

  if [ -f "$CLAUDE_SETTINGS_FILE" ] && command -v jq &>/dev/null; then
    local in_settings
    in_settings="$(jq -r '(.env // {}) | (has("ANTHROPIC_BASE_URL") or has("ANTHROPIC_AUTH_TOKEN"))' "$CLAUDE_SETTINGS_FILE" 2>/dev/null || echo false)"
    [ "$in_settings" = "true" ] && settings_mode="proxy" || settings_mode="native"
  fi

  if [ -n "${ANTHROPIC_BASE_URL:-}" ]; then
    env_mode="proxy ($ANTHROPIC_BASE_URL)"
  else
    env_mode="native"
  fi

  echo "── Claude Code mode ──────────────────────"
  echo "  settings.json:     $settings_mode"
  echo "  current shell env: $env_mode"
  if _claude_mode_proxy_alive; then
    echo "  proxy reachable:   yes ($AICLIENT_BASE)"
  else
    echo "  proxy reachable:   no  ($AICLIENT_BASE)"
  fi
  echo "──────────────────────────────────────────"
}

# When executed (not sourced) dispatch the subcommand. When sourced this block is skipped
# and the functions above are available in the parent shell — DO NOT run status here, or
# the block prints on every shell open.
if [ "$_claude_mode_sourced" -eq 0 ]; then
  # Enable strict mode only in the executed path so it can't leak into the parent shell.
  set -uo pipefail
  case "${1:-status}" in
    on|proxy)   claude-proxy ;;
    off|native) claude-native ;;
    status)     claude-mode-status ;;
    *)
      echo "Usage: $0 {on|off|status}" >&2
      exit 1
      ;;
  esac
fi
unset _claude_mode_sourced
