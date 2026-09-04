#!/usr/bin/env bash
#
# Resynchronise la liste locale des services à vérifier depuis le backend.
# Déclenché par le timer systemd monitoring-status-refresh (5 min par défaut).
# Voir docs/AGENT_SETUP.md §8.
#
# C'est ce script qui permet d'ajouter ou de retirer un service surveillé depuis
# l'interface web **sans repasser par le serveur applicatif**.

set -uo pipefail

readonly CONF_DIR="/etc/monitoring-agent"
readonly SERVICES_FILE="${CONF_DIR}/services.conf"
readonly TYPES_FILE="${CONF_DIR}/services.types"

for required in BACKEND_URL APPLICATION_ID AGENT_TOKEN; do
  if [[ -z "${!required:-}" ]]; then
    echo "Variable $required absente : vérifier ${CONF_DIR}/agent.env" >&2
    exit 1
  fi
done

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

HTTP_CODE="$(curl --silent --max-time 15 --output "${TMP}/response.json" --write-out '%{http_code}' \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  "${BACKEND_URL}/api/ingestion/applications/${APPLICATION_ID}/services")"

if [[ "$HTTP_CODE" != "200" ]]; then
  # On garde la liste locale en place : mieux vaut continuer à vérifier une
  # liste un peu ancienne que cesser de vérifier quoi que ce soit parce que le
  # backend est momentanément indisponible.
  echo "Resynchronisation impossible (HTTP ${HTTP_CODE}), la liste locale est conservée" >&2
  exit 1
fi

python3 - "$TMP" <<'PY' || { echo "Réponse du backend illisible, liste locale conservée" >&2; exit 1; }
import json, os, sys

tmp = sys.argv[1]
with open(os.path.join(tmp, 'response.json'), encoding='utf-8') as handle:
    payload = json.load(handle)

services = payload.get('services', [])
if not isinstance(services, list):
    raise SystemExit('Format inattendu')

names, types = [], []
for service in services:
    name = str(service.get('name', '')).strip()
    if not name or '\n' in name:
        continue
    names.append(name)
    types.append(f"{name}={service.get('checkType', 'systemd')}")

with open(os.path.join(tmp, 'services.conf'), 'w', encoding='utf-8', newline='\n') as handle:
    handle.write('\n'.join(names) + ('\n' if names else ''))
with open(os.path.join(tmp, 'services.types'), 'w', encoding='utf-8', newline='\n') as handle:
    handle.write('\n'.join(types) + ('\n' if types else ''))
PY

# Remplacement atomique : le vérificateur peut lire le fichier au même instant,
# il doit voir l'ancienne version complète ou la nouvelle, jamais un fichier
# tronqué qui lui ferait sauter des services.
mv -f "${TMP}/services.conf" "$SERVICES_FILE"
mv -f "${TMP}/services.types" "$TYPES_FILE"

COUNT="$(grep -c . "$SERVICES_FILE" 2>/dev/null || printf '0')"
echo "Liste des services resynchronisée : ${COUNT} service(s)"
