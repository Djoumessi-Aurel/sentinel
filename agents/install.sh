#!/usr/bin/env bash
#
# Installation d'un agent de collecte Sentinel sur un serveur applicatif.
# Voir docs/AGENT_SETUP.md pour le parcours complet.
#
#   ./install.sh <app_type> <application_id> <backend_url> <agent_token> \
#                [log_path] [--services svc1,svc2,...]
#
# Exemple (filemanager) :
#   ./install.sh spring-boot 3f2a... https://sentinel.gie.local <token> \
#     /fmanager/logs/manager.log --services file-manager.service,httpd.service,mysqld.service
#
# À exécuter sur le serveur qui héberge l'application, pas sur le serveur central.

set -euo pipefail

# --- Constantes ---------------------------------------------------------------
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly VECTOR_VERSION="0.44.0"
readonly AGENT_CONF_DIR="/etc/monitoring-agent"
readonly VECTOR_CONF="/etc/vector/vector.toml"

# Chemins de log par défaut, par type d'appli. Toujours surchargeables en argument.
declare -A DEFAULT_LOG_PATHS=(
  ["spring-boot"]="/var/log/application/*.log"
  ["java-simple"]="/var/log/application/*.log"
  ["distribcard"]="/programs_data/programs/distribcard/logs/distribcard.log"
  ["nodejs-pm2"]="/root/.pm2/logs/*-out-*.log"
  ["react-nginx"]="/var/log/nginx/*.log"
)

# --- Sortie -------------------------------------------------------------------
log()  { printf '\033[0;34m[sentinel]\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m[sentinel]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[0;31m[sentinel]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 1
}

# --- Arguments ----------------------------------------------------------------
[[ $# -lt 4 ]] && usage

readonly APP_TYPE="$1"
readonly APPLICATION_ID="$2"
readonly BACKEND_URL="${3%/}"
readonly AGENT_TOKEN="$4"
shift 4

LOG_PATH=""
SERVICES=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --services)
      SERVICES="${2:-}"
      shift 2
      ;;
    --services=*)
      SERVICES="${1#*=}"
      shift
      ;;
    *)
      LOG_PATH="$1"
      shift
      ;;
  esac
done

if [[ -z "$LOG_PATH" ]]; then
  LOG_PATH="${DEFAULT_LOG_PATHS[$APP_TYPE]:-}"
  [[ -z "$LOG_PATH" ]] && die "Aucun chemin de log par défaut pour le type « $APP_TYPE » : le passer en argument."
  log "Chemin de log par défaut retenu : $LOG_PATH"
fi

readonly SERVER_NAME="$(hostname -s)"
readonly TEMPLATE="${SCRIPT_DIR}/vector-templates/${APP_TYPE}.toml"
[[ -f "$TEMPLATE" ]] || die "Template introuvable : $TEMPLATE"

# --- Contrôles préalables -----------------------------------------------------
# On échoue tôt et clairement : un agent installé mais incapable de joindre le
# backend serait un agent silencieux, exactement ce que Sentinel doit éviter.
require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "Ce script doit être exécuté avec sudo (installation d'un service systemd)."
}

check_backend() {
  log "Vérification de l'accès au backend ($BACKEND_URL) ..."
  if ! curl --fail --silent --show-error --max-time 10 "${BACKEND_URL}/api/health" >/dev/null; then
    die "Backend injoignable à ${BACKEND_URL}/api/health. Vérifier l'URL, le réseau et le pare-feu."
  fi
}

check_token() {
  log "Vérification du token d'agent ..."
  local code
  code=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 \
    -H "Authorization: Bearer ${AGENT_TOKEN}" \
    "${BACKEND_URL}/api/ingestion/applications/${APPLICATION_ID}/services")

  case "$code" in
    200) log "Token valide et rattaché à cette application." ;;
    401) die "Token refusé. Le token n'est affiché qu'une fois à la création de l'application ; en régénérer un si besoin." ;;
    403) die "Ce token appartient à une autre application. Vérifier l'identifiant d'application." ;;
    *)   die "Réponse inattendue du backend (HTTP $code)." ;;
  esac
}

check_log_path() {
  # `compgen -G` gère les motifs (nodejs-pm2, react-nginx).
  if ! compgen -G "$LOG_PATH" >/dev/null; then
    warn "Aucun fichier ne correspond à « $LOG_PATH » pour l'instant."
    warn "L'agent démarrera quand même et suivra le fichier dès son apparition."
  fi
}

# --- Installation de Vector ---------------------------------------------------
install_vector() {
  if command -v vector >/dev/null 2>&1; then
    log "Vector est déjà installé ($(vector --version 2>/dev/null | head -1))."
    return
  fi

  log "Installation de Vector ${VECTOR_VERSION} ..."
  local arch tarball url tmp
  case "$(uname -m)" in
    x86_64)  arch="x86_64-unknown-linux-gnu" ;;
    aarch64) arch="aarch64-unknown-linux-gnu" ;;
    *)       die "Architecture non gérée : $(uname -m)" ;;
  esac

  tarball="vector-${VECTOR_VERSION}-${arch}.tar.gz"
  url="https://packages.timber.io/vector/${VECTOR_VERSION}/${tarball}"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  curl --fail --location --silent --show-error --max-time 300 -o "${tmp}/${tarball}" "$url" \
    || die "Téléchargement de Vector impossible depuis $url"

  # Vérification d'intégrité du binaire téléchargé (docs/SECURITY.md A08).
  # Sans elle, un miroir compromis installerait un binaire arbitraire en root.
  if curl --fail --location --silent --max-time 60 -o "${tmp}/${tarball}.sha256sum" "${url}.sha256sum"; then
    ( cd "$tmp" && sha256sum --check --status "${tarball}.sha256sum" ) \
      || die "Empreinte SHA-256 de Vector invalide : téléchargement corrompu ou altéré. Installation interrompue."
    log "Empreinte SHA-256 vérifiée."
  else
    die "Empreinte SHA-256 indisponible : installation interrompue plutôt que d'installer un binaire non vérifié."
  fi

  tar -xzf "${tmp}/${tarball}" -C "$tmp"
  install -m 0755 "${tmp}"/vector-*/bin/vector /usr/local/bin/vector
  log "Vector installé dans /usr/local/bin/vector."
}

# --- Configuration Vector -----------------------------------------------------
write_vector_config() {
  log "Écriture de $VECTOR_CONF ..."
  mkdir -p "$(dirname "$VECTOR_CONF")"

  # Substitution par sed plutôt que par `envsubst` : on ne remplace que les
  # variables attendues, sans risquer d'interpréter une séquence présente dans
  # un chemin de log.
  sed \
    -e "s|\${APPLICATION_ID}|${APPLICATION_ID}|g" \
    -e "s|\${SERVER_NAME}|${SERVER_NAME}|g" \
    -e "s|\${BACKEND_URL}|${BACKEND_URL}|g" \
    -e "s|\${AGENT_TOKEN}|${AGENT_TOKEN}|g" \
    -e "s|\${LOG_PATH}|${LOG_PATH}|g" \
    "$TEMPLATE" > "$VECTOR_CONF"

  # Le fichier contient le token en clair : lisible par root uniquement.
  chmod 0600 "$VECTOR_CONF"

  vector validate --no-environment "$VECTOR_CONF" \
    || die "Configuration Vector invalide. Rien n'a été démarré."
}

install_vector_service() {
  log "Enregistrement du service systemd vector ..."
  cat > /etc/systemd/system/vector.service <<'UNIT'
[Unit]
Description=Agent de collecte de logs Sentinel (Vector)
After=network-online.target
Wants=network-online.target

[Service]
Type=exec
ExecStart=/usr/local/bin/vector --config /etc/vector/vector.toml
Restart=always
RestartSec=10
# Un agent qui redémarre en boucle doit rester visible dans journalctl.
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable --now vector
  log "Service vector démarré et activé au redémarrage du serveur."
}

# --- Vérification du statut des services --------------------------------------
install_status_checker() {
  [[ -z "$SERVICES" ]] && { log "Aucun service à surveiller (--services non fourni) : vérification de statut non installée."; return; }

  log "Installation du vérificateur de statut pour : $SERVICES"
  mkdir -p "$AGENT_CONF_DIR"

  # Amorce du cache local. La liste de référence reste celle de l'interface web :
  # refresh-services.sh la resynchronise toutes les 5 minutes, ce qui permet
  # d'ajouter ou retirer un service sans revenir sur le serveur.
  tr ',' '\n' <<< "$SERVICES" | sed '/^$/d' > "${AGENT_CONF_DIR}/services.conf"

  cat > "${AGENT_CONF_DIR}/agent.env" <<ENV
BACKEND_URL=${BACKEND_URL}
APPLICATION_ID=${APPLICATION_ID}
AGENT_TOKEN=${AGENT_TOKEN}
SERVER_NAME=${SERVER_NAME}
ENV
  chmod 0600 "${AGENT_CONF_DIR}/agent.env"

  install -m 0755 "${SCRIPT_DIR}/check-services.sh" /usr/local/bin/sentinel-check-services
  install -m 0755 "${SCRIPT_DIR}/refresh-services.sh" /usr/local/bin/sentinel-refresh-services

  write_timer "monitoring-status-check" "sentinel-check-services" "30s" \
    "Vérification du statut des services surveillés"
  write_timer "monitoring-status-refresh" "sentinel-refresh-services" "5min" \
    "Resynchronisation de la liste des services à vérifier"

  systemctl daemon-reload
  systemctl enable --now monitoring-status-check.timer monitoring-status-refresh.timer
  log "Vérification de statut active (contrôle toutes les 30 s, resynchronisation toutes les 5 min)."
}

write_timer() {
  local name="$1" binary="$2" interval="$3" description="$4"

  cat > "/etc/systemd/system/${name}.service" <<UNIT
[Unit]
Description=${description}

[Service]
Type=oneshot
EnvironmentFile=${AGENT_CONF_DIR}/agent.env
ExecStart=/usr/local/bin/${binary}
UNIT

  cat > "/etc/systemd/system/${name}.timer" <<UNIT
[Unit]
Description=${description} (déclencheur)

[Timer]
OnBootSec=30s
OnUnitActiveSec=${interval}
AccuracySec=1s

[Install]
WantedBy=timers.target
UNIT
}

# --- Exécution ----------------------------------------------------------------
main() {
  require_root
  log "Installation de l'agent Sentinel — type: ${APP_TYPE}, serveur: ${SERVER_NAME}"
  check_backend
  check_token
  check_log_path
  install_vector
  write_vector_config
  install_vector_service
  install_status_checker

  log ""
  log "Installation terminée."
  log "  Logs de l'agent      : journalctl -u vector -f"
  log "  Statut des timers    : systemctl list-timers 'monitoring-*'"
  log "  Fichier suivi        : ${LOG_PATH}"
}

main "$@"
