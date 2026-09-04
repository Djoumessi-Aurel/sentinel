#!/usr/bin/env bash
#
# Vérifie l'état des services dont dépend l'application et l'envoie au backend.
# Déclenché par le timer systemd monitoring-status-check (30 s par défaut).
# Voir docs/AGENT_SETUP.md §8.
#
# Les variables BACKEND_URL, APPLICATION_ID, AGENT_TOKEN et SERVER_NAME viennent
# de /etc/monitoring-agent/agent.env, chargé par l'unité systemd.

set -uo pipefail

readonly SERVICES_FILE="/etc/monitoring-agent/services.conf"
readonly TYPES_FILE="/etc/monitoring-agent/services.types"

for required in BACKEND_URL APPLICATION_ID AGENT_TOKEN SERVER_NAME; do
  if [[ -z "${!required:-}" ]]; then
    echo "Variable $required absente : vérifier /etc/monitoring-agent/agent.env" >&2
    exit 1
  fi
done

if [[ ! -s "$SERVICES_FILE" ]]; then
  echo "Aucun service à vérifier dans $SERVICES_FILE" >&2
  exit 0
fi

# Type de vérification associé à un service, alimenté par refresh-services.sh
# au format "nom=type". Par défaut systemd.
check_type_of() {
  local name="$1"
  if [[ -f "$TYPES_FILE" ]]; then
    local found
    found="$(grep -m1 -F "${name}=" "$TYPES_FILE" 2>/dev/null | cut -d= -f2-)"
    [[ -n "$found" ]] && { printf '%s' "$found"; return; }
  fi
  printf 'systemd'
}

# Ramène l'état à l'un des quatre états du contrat : active | inactive | failed |
# unknown. Tout autre retour devient `unknown` — jamais `active` par défaut :
# supposer qu'un service va bien quand on ne sait pas serait exactement la panne
# silencieuse que Sentinel doit empêcher.
normalize_state() {
  case "$1" in
    active|inactive|failed) printf '%s' "$1" ;;
    activating|reloading)   printf 'active' ;;
    deactivating)           printf 'inactive' ;;
    *)                      printf 'unknown' ;;
  esac
}

probe_systemd() {
  normalize_state "$(systemctl is-active "$1" 2>/dev/null || true)"
}

probe_pm2() {
  # `pm2 jlist` liste les processus de l'utilisateur courant : le timer doit
  # tourner sous le bon utilisateur, sinon la liste est vide et le service
  # paraîtrait arrêté à tort (docs/AGENT_SETUP.md, point de vigilance PM2).
  local name="$1" status
  command -v pm2 >/dev/null 2>&1 || { printf 'unknown'; return; }
  status="$(pm2 jlist 2>/dev/null | python3 -c "
import json,sys
try:
    for proc in json.load(sys.stdin):
        if proc.get('name') == '$name':
            print(proc.get('pm2_env', {}).get('status', 'unknown'))
            break
except Exception:
    pass
" 2>/dev/null)"

  case "$status" in
    online)            printf 'active' ;;
    stopped|stopping)  printf 'inactive' ;;
    errored)           printf 'failed' ;;
    *)                 printf 'unknown' ;;
  esac
}

probe_process() {
  # Card Companion et Select PX ne sont pas gérés par systemd : leurs processus
  # sont lancés par des scripts (start_auth, startup.sh). On teste donc la
  # présence du processus (docs, section « points de vigilance »).
  if pgrep -f -- "$1" >/dev/null 2>&1; then printf 'active'; else printf 'inactive'; fi
}

probe_tcp_port() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :${port}" 2>/dev/null | grep -q LISTEN && printf 'active' || printf 'inactive'
  else
    printf 'unknown'
  fi
}

probe() {
  local name="$1"
  case "$(check_type_of "$name")" in
    systemd)  probe_systemd "$name" ;;
    pm2)      probe_pm2 "$name" ;;
    process)  probe_process "$name" ;;
    tcp-port) probe_tcp_port "$name" ;;
    *)        printf 'unknown' ;;
  esac
}

# Échappement JSON minimal des noms de service, pour ne pas produire un corps
# invalide si un nom contient un caractère spécial.
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

CHECKED_AT="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
CHECKS=""

while IFS= read -r service || [[ -n "$service" ]]; do
  service="$(printf '%s' "$service" | tr -d '[:space:]')"
  [[ -z "$service" || "$service" == \#* ]] && continue

  state="$(probe "$service")"
  [[ -n "$CHECKS" ]] && CHECKS+=","
  CHECKS+="{\"serviceName\":\"$(json_escape "$service")\",\"state\":\"${state}\",\"checkedAt\":\"${CHECKED_AT}\"}"
done < "$SERVICES_FILE"

[[ -z "$CHECKS" ]] && exit 0

PAYLOAD="{\"applicationId\":\"${APPLICATION_ID}\",\"server\":\"${SERVER_NAME}\",\"checks\":[${CHECKS}]}"

HTTP_CODE="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 15 \
  -X POST "${BACKEND_URL}/api/ingestion/status" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")"

if [[ "$HTTP_CODE" != "202" ]]; then
  # Journalisé sans le token ni le corps complet (docs/SECURITY.md A09).
  echo "Envoi du statut refusé par le backend (HTTP ${HTTP_CODE})" >&2
  exit 1
fi
