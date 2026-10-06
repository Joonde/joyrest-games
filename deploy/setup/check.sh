#!/usr/bin/env bash
# Шаг 1 первичной настройки: проверка связи сервера. Ничего не устанавливает и не меняет.
# Запуск под root:  bash check.sh
set -u
export LC_NUMERIC=C

SERVER_IP="217.114.13.92"
DOMAINS="games.joy-rest.ru joy-rest.ru www.joy-rest.ru test.games.joy-rest.ru"
critical_failed=0

ok()   { printf '  ✅ %s — %s\n' "$1" "$2"; }
bad()  { printf '  ❌ %s — %s\n' "$1" "$2"; }
warn() { printf '  ⚠️ %s — %s\n' "$1" "$2"; }

# Код ответа и время; любой HTTP-ответ (даже 401/404) значит, что адрес доступен.
probe() {
  local result
  result=$(curl -s -o /dev/null --max-time 15 -w '%{http_code} %{time_total}' "$1" 2>/dev/null)
  echo "${result:-000 0}"
}

# $1 — название, $2 — адрес, $3 — critical | info
check_url() {
  local result code seconds
  result=$(probe "$2"); code=${result% *}; seconds=${result#* }
  if [ "$code" != "000" ]; then
    ok "$1" "HTTP $code, $(printf '%.1f' "$seconds") с"
  elif [ "$3" = "critical" ]; then
    bad "$1" "нет связи (КРИТИЧНО)"; critical_failed=1
  else
    warn "$1" "нет связи"
  fi
}

echo
echo "=== JoyRest: проверка сервера $(date '+%Y-%m-%d %H:%M') ==="
echo
echo "Система:"
. /etc/os-release
printf '  %s, ядро %s\n' "$PRETTY_NAME" "$(uname -r)"
printf '  Процессоры: %s, память: %s МБ, подкачка: %s МБ\n' "$(nproc)" \
  "$(free -m | awk '/^Mem:/{print $2}')" "$(free -m | awk '/^Swap:/{print $2}')"
printf '  Диск /: свободно %s из %s\n' "$(df -h / | awk 'NR==2{print $4}')" "$(df -h / | awk 'NR==2{print $2}')"
[ "${VERSION_ID:-}" = "24.04" ] || warn "Версия Ubuntu" "ожидалась 24.04"

echo
echo "DNS (должны указывать на $SERVER_IP):"
for domain in $DOMAINS; do
  addresses=$(getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')
  if echo " $addresses" | grep -q " $SERVER_IP "; then ok "$domain" "$SERVER_IP"
  elif [ "$domain" = "test.games.joy-rest.ru" ]; then warn "$domain" "${addresses:-нет записи} (нужна для тестового окружения)"
  else bad "$domain" "${addresses:-нет записи} (КРИТИЧНО)"; critical_failed=1
  fi
done
if command -v dig >/dev/null 2>&1; then
  caa=$(dig +short CAA joy-rest.ru 2>/dev/null)
  if [ -z "$caa" ]; then ok "CAA joy-rest.ru" "нет ограничений"
  elif echo "$caa" | grep -qE 'letsencrypt.org|sectigo.com'; then ok "CAA joy-rest.ru" "$(echo "$caa" | tr '\n' ' ')"
  else bad "CAA joy-rest.ru" "запрещает Let's Encrypt: $caa"; critical_failed=1
  fi
fi

echo
echo "Образы и код (сервер скачивает образы только из GHCR):"
check_url "ghcr.io" "https://ghcr.io/v2/" critical
check_url "ghcr.io: слои образов" "https://pkg-containers.githubusercontent.com/" critical
token=$(curl -sS --max-time 15 "https://ghcr.io/token?service=ghcr.io&scope=repository:homebrew/core/hello:pull" 2>/dev/null \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -n "$token" ] && curl -sS -o /dev/null --max-time 15 -w '%{http_code}' \
    -H "Authorization: Bearer $token" "https://ghcr.io/v2/homebrew/core/hello/tags/list" 2>/dev/null | grep -q 200; then
  ok "ghcr.io: пробное чтение образа" "работает"
else
  bad "ghcr.io: пробное чтение образа" "не работает (КРИТИЧНО)"; critical_failed=1
fi
check_url "github.com" "https://github.com/" info
check_url "api.github.com" "https://api.github.com/" info
check_url "objects.githubusercontent.com" "https://objects.githubusercontent.com/" info

echo
echo "Установка Docker:"
check_url "download.docker.com" "https://download.docker.com/linux/ubuntu/dists/noble/Release" info
mirror=$(grep -hoE 'https?://[^ ]+' /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list 2>/dev/null | head -1)
[ -n "$mirror" ] && check_url "Зеркало Ubuntu" "${mirror%/}/dists/noble/Release" critical
check_url "Docker Hub (для сведения)" "https://registry-1.docker.io/v2/" info

echo
echo "Сертификаты HTTPS:"
le=$(probe "https://acme-v02.api.letsencrypt.org/directory"); zs=$(probe "https://acme.zerossl.com/v2/DV90")
[ "${le% *}" != "000" ] && ok "Let's Encrypt" "HTTP ${le% *}" || warn "Let's Encrypt" "нет связи"
[ "${zs% *}" != "000" ] && ok "ZeroSSL (запасной)" "HTTP ${zs% *}" || warn "ZeroSSL (запасной)" "нет связи"
if [ "${le% *}" = "000" ] && [ "${zs% *}" = "000" ]; then
  bad "Сертификаты" "ни один центр недоступен (КРИТИЧНО)"; critical_failed=1
fi

echo
echo "Остальное:"
check_url "npm (для сведения)" "https://registry.npmjs.org/-/ping" info
check_url "Telegram" "https://api.telegram.org/" info
check_url "Beget S3" "https://s3.ru1.storage.beget.cloud/" info
check_url "UptimeRobot" "https://uptimerobot.com/" info
if timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -q yes; then
  ok "Точное время (NTP)" "синхронизировано"
else
  warn "Точное время (NTP)" "не синхронизировано (настроит установка)"
fi
busy=$(ss -ltnH 2>/dev/null | awk '{print $4}' | grep -E ':(80|443)$' | tr '\n' ' ')
[ -z "$busy" ] && ok "Порты 80 и 443" "свободны" || warn "Порты 80 и 443" "заняты: $busy"

echo
if [ "$critical_failed" = 1 ]; then
  echo "ИТОГ: ❌ есть критичные проблемы. Пришлите скриншот — установку пока не запускаем."
else
  echo "ИТОГ: ✅ критичных проблем нет. Пришлите скриншот и переходите к установке."
fi
echo
