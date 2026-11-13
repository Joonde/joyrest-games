#!/usr/bin/env bash
# Посредник Telegram для JoyRest (6 ноября 2026).
#
# Из российских дата-центров api.telegram.org недоступен, поэтому основной сервер ходит в Telegram
# через этот маленький сервер за границей (HostVDS, Амстердам, 1 ГБ). Здесь только Caddy: HTTPS на
# своём поддомене (сертификат Let's Encrypt) и пересылка запросов с секретным путём на api.telegram.org.
# Ничего не хранится: ни базы, ни журналов запросов (в адресе запроса — токен бота). Порт 443 открыт
# только адресу основного сервера, 80 — для выдачи сертификата, 22 — вход по ключу.
#
# Запуск на сервере-посреднике (под root, Ubuntu 24.04):
#   curl -fsSL https://raw.githubusercontent.com/Joonde/joyrest-games/<ветка>/deploy/relay/install.sh -o relay.sh
#   bash relay.sh tg.joy-rest.ru <адрес основного сервера>
# В конце скрипт один раз показывает адрес посредника с секретом — его вставляют на основном
# сервере в `sudo joyrest tg-relay` (в чат и в репозиторий его не отправлять).
# Повторный запуск безопасен: секрет сохраняется (/etc/caddy/relay-secret), настройки пишутся заново.
set -euo pipefail

DOMAIN=${1:-}
MAIN_IP=${2:-}

fail() { echo "❌ $*" >&2; exit 1; }
step() { echo; echo "▶ $*"; }

[ "$(id -u)" = 0 ] || fail "Запустите под root: bash relay.sh $DOMAIN $MAIN_IP"
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]] || fail "Первый аргумент — поддомен посредника, например tg.joy-rest.ru"
[[ "$MAIN_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || fail "Второй аргумент — IPv4-адрес основного сервера, например 195.133.61.251"
grep -q 'Ubuntu' /etc/os-release || fail "Нужна Ubuntu 24.04."

step "Проверяю, что $DOMAIN указывает на этот сервер…"
MY_IP=$(curl -4 -fsS --max-time 10 https://api.ipify.org || true)
DNS_IP=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)
echo "  адрес этого сервера: ${MY_IP:-не узнал}, $DOMAIN → ${DNS_IP:-нет записи}"
if [ -z "$DNS_IP" ] || { [ -n "$MY_IP" ] && [ "$DNS_IP" != "$MY_IP" ]; }; then
  fail "Запись DNS ещё не готова: в Beget добавьте A-запись ${DOMAIN%%.*} → ${MY_IP:-адрес этого сервера}, подождите 5–10 минут и запустите снова."
fi

step "Проверяю, что отсюда открывается Telegram…"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://api.telegram.org/ || true)
[ "$code" != 000 ] || fail "api.telegram.org отсюда недоступен — посредник здесь не поможет. Нужен сервер в другой стране."
echo "  Telegram отвечает (код $code)."

step "Обновляю систему (несколько минут)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade
apt-get -y -q install ufw fail2ban unattended-upgrades curl gnupg debian-keyring debian-archive-keyring apt-transport-https

step "Автообновления безопасности (перезагрузка при необходимости — в 04:30)…"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
cat > /etc/apt/apt.conf.d/52joyrest-reboot <<'CONF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
CONF

step "Вход только по ключу…"
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/99-joyrest-relay.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF
[ -s /root/.ssh/authorized_keys ] || fail "На сервере нет ключа входа (/root/.ssh/authorized_keys) — без него вход по паролю закрывать нельзя."
sshd -t || fail "Настройка входа не прошла проверку — ничего не перезапускаю. Пришлите Claude вывод: sshd -t"
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
systemctl enable --now fail2ban >/dev/null 2>&1 || true

step "Ставлю Caddy…"
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get -y -q install caddy
fi

SECRET_FILE=/etc/caddy/relay-secret
if [ ! -s "$SECRET_FILE" ]; then
  (umask 077 && head -c 24 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n' > "$SECRET_FILE")
fi
chmod 600 "$SECRET_FILE"
SECRET=$(cat "$SECRET_FILE")
[[ "$SECRET" =~ ^[A-Za-z0-9_-]{24,}$ ]] || fail "Секрет испорчен: удалите $SECRET_FILE и запустите снова."

# Журналов запросов нет (в адресе — токен бота). Всё, кроме секретного пути, — 404.
cat > /etc/caddy/Caddyfile <<CONF
{
	admin localhost:2019
}

$DOMAIN {
	@relay path /$SECRET/*
	handle @relay {
		uri strip_prefix /$SECRET
		reverse_proxy https://api.telegram.org {
			header_up Host api.telegram.org
			header_up -X-Forwarded-For
			header_up -X-Forwarded-Host
			header_up -X-Forwarded-Proto
			transport http {
				dial_timeout 10s
			}
		}
	}
	handle {
		respond 404
	}
}
CONF
chmod 640 /etc/caddy/Caddyfile
chgrp caddy /etc/caddy/Caddyfile 2>/dev/null || true
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null

step "Брандмауэр: 22 и 80 — всем, 443 — только основному серверу ($MAIN_IP)…"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow from "$MAIN_IP" to any port 443 proto tcp >/dev/null
ufw --force enable >/dev/null

systemctl enable caddy >/dev/null 2>&1
systemctl restart caddy

step "Жду сертификат HTTPS и проверяю пересылку (до 2 минут)…"
ok=""
for _ in $(seq 1 24); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/$SECRET/bot0:check/getMe" || true)
  if [ "$code" = 401 ] || [ "$code" = 404 ]; then ok=1; break; fi
  sleep 5
done
[ -n "$ok" ] || fail "Посредник не заработал (код ${code:-нет}). Пришлите Claude вывод: journalctl -u caddy -n 40 --no-pager"

echo
echo "✅ Посредник работает."
echo
echo "Адрес посредника (секрет — НЕ отправляйте его в чат, только вставьте на основном сервере):"
echo
echo "    https://$DOMAIN/$SECRET"
echo
echo "Дальше: на основном сервере (ssh joyrest) — sudo joyrest tg-relay — и вставьте этот адрес."
