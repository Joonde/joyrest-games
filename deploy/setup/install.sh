#!/usr/bin/env bash
# Шаг 2 первичной настройки сервера JoyRest Games (Ubuntu 24.04, под root).
# Повторный запуск безопасен: готовые шаги пропускаются, пароль базы и ключи не меняются.
#
# Делает: обновления и автообновления безопасности, точное время, подкачку, ротацию логов,
# пользователя для владельца (sudo, вход по ключу), пользователя deploy (только выкладка),
# файрвол (22/80/443), fail2ban, Docker, вход в GHCR и первый запуск сайта.
# Вход root по паролю НЕ отключает — это отдельный шаг lock-ssh.sh после проверки.
set -euo pipefail

SERVER_IP="217.114.13.92"
GHCR_USER="joonde"
APP_REPO="ghcr.io/joonde/joyrest-app"
ROOT_DIR="/srv/joyrest"
APP_TAG="${APP_TAG:-main}"

step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
fail() { printf '\n❌ %s\n' "$1" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "Запускайте под root."
. /etc/os-release
[ "${VERSION_ID:-}" = "24.04" ] || fail "Нужна Ubuntu 24.04, а здесь ${PRETTY_NAME:-неизвестно}."

# ---------------------------------------------------------------- вопросы
step "Данные для настройки"
read -r -p "Почта администратора [student.maik@gmail.com]: " ADMIN_EMAIL
ADMIN_EMAIL="${ADMIN_EMAIL:-student.maik@gmail.com}"
read -r -p "Имя вашего пользователя на сервере [joy]: " OWNER_USER
OWNER_USER="${OWNER_USER:-joy}"
echo "$OWNER_USER" | grep -qE '^[a-z][a-z0-9_-]{1,30}$' || fail "Имя пользователя: латиница, цифры, - и _."

OWNER_KEY=""
if [ -s "/home/$OWNER_USER/.ssh/authorized_keys" ]; then
  echo "Ключ для $OWNER_USER уже есть — оставляю."
else
  echo "Вставьте ПУБЛИЧНЫЙ ключ из Termius (одна строка, начинается с ssh-ed25519) и нажмите Enter:"
  read -r OWNER_KEY
  echo "$OWNER_KEY" | grep -qE '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) [A-Za-z0-9+/=]+' \
    || fail "Это не похоже на публичный ключ. Скопируйте в Termius: Keychain → ключ → Export / Copy public key."
fi

GHCR_TOKEN=""
if grep -q '"ghcr.io"' /root/.docker/config.json 2>/dev/null; then
  echo "Вход в GHCR уже настроен — оставляю."
else
  echo "Вставьте токен GitHub (classic, только read:packages) и нажмите Enter (символы не видны):"
  read -r -s GHCR_TOKEN; echo
  [ -n "$GHCR_TOKEN" ] || fail "Токен пустой."
fi

# ---------------------------------------------------------------- система
step "Обновление системы и пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confold upgrade
apt-get -y -q install ca-certificates curl jq xxd openssl ufw fail2ban unattended-upgrades chrony python3-systemd

step "Часовой пояс и точное время"
timedatectl set-timezone Europe/Moscow
systemctl enable --now chrony
chronyc -a makestep >/dev/null 2>&1 || true

step "Автообновления безопасности (без автоматической перезагрузки)"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
cat > /etc/apt/apt.conf.d/52joyrest-unattended <<'CONF'
// Перезагрузку посреди ночного праздника не делаем: о ней напомнит мониторинг.
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
CONF
systemctl enable --now unattended-upgrades

step "Подкачка 2 ГБ"
if ! swapon --show | grep -q /swapfile; then
  [ -f /swapfile ] || { fallocate -l 2G /swapfile; chmod 600 /swapfile; mkswap /swapfile >/dev/null; }
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/90-joyrest.conf
sysctl -q -p /etc/sysctl.d/90-joyrest.conf

step "Ротация системных логов (journald: до 200 МБ и 14 дней)"
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/joyrest.conf <<'CONF'
[Journal]
SystemMaxUse=200M
MaxRetentionSec=14day
CONF
systemctl restart systemd-journald

# ---------------------------------------------------------------- пользователи
step "Пользователь $OWNER_USER (sudo, вход по ключу)"
id "$OWNER_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$OWNER_USER"
passwd -l "$OWNER_USER" >/dev/null
install -d -m 700 -o "$OWNER_USER" -g "$OWNER_USER" "/home/$OWNER_USER/.ssh"
if [ -n "$OWNER_KEY" ]; then
  echo "$OWNER_KEY" > "/home/$OWNER_USER/.ssh/authorized_keys"
  chown "$OWNER_USER:$OWNER_USER" "/home/$OWNER_USER/.ssh/authorized_keys"
  chmod 600 "/home/$OWNER_USER/.ssh/authorized_keys"
fi
# Пароля у пользователя нет (вход только по ключу), поэтому sudo без пароля.
echo "$OWNER_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-joyrest-owner
chmod 440 /etc/sudoers.d/90-joyrest-owner
visudo -cq

step "Пользователь deploy (только команда выкладки, без sudo)"
id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash deploy
passwd -l deploy >/dev/null
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh

step "Настройки SSH (вход по паролю пока остаётся)"
cat > /etc/ssh/sshd_config.d/10-joyrest.conf <<CONF
# JoyRest: файл читается раньше 50-cloud-init.conf, его значения главнее.
MaxAuthTries 4
LoginGraceTime 30
X11Forwarding no
AllowUsers root $OWNER_USER deploy
CONF
mkdir -p /run/sshd
sshd -t
systemctl reload ssh 2>/dev/null || systemctl restart ssh

# ---------------------------------------------------------------- защита
step "Файрвол: только 22, 80, 443"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null   # HTTP/3
ufw --force enable >/dev/null
ufw status | sed 's/^/  /'

step "fail2ban: блокировка подбора пароля SSH"
cat > /etc/fail2ban/jail.d/joyrest.conf <<'CONF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
CONF
systemctl enable fail2ban >/dev/null 2>&1
systemctl restart fail2ban || echo "⚠️  fail2ban не запустился — пришлите Claude вывод: journalctl -u fail2ban -n 30"

# ---------------------------------------------------------------- Docker
step "Docker"
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  install -d -m 755 /etc/apt/keyrings
  if curl -fsS --max-time 20 https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc; then
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" \
      > /etc/apt/sources.list.d/docker.list
    if apt-get update -q && apt-get -y -q install docker-ce docker-ce-cli containerd.io docker-compose-plugin; then
      echo "Docker установлен из официального репозитория."
    else
      rm -f /etc/apt/sources.list.d/docker.list
    fi
  fi
  if ! docker compose version >/dev/null 2>&1; then
    apt-get update -q
    apt-get -y -q install docker.io docker-compose-v2
    echo "Docker установлен из репозитория Ubuntu (официальный недоступен)."
  fi
fi
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'CONF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}
CONF
systemctl enable docker >/dev/null 2>&1
systemctl restart docker
docker compose version

step "Вход в GHCR (только чтение образов)"
if [ -n "$GHCR_TOKEN" ]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null \
    || fail "GHCR не принял токен. Проверьте: classic, право read:packages, срок не истёк."
  unset GHCR_TOKEN
fi
chmod 600 /root/.docker/config.json

# ---------------------------------------------------------------- JoyRest
step "Папки и настройки JoyRest"
install -d -m 755 "$ROOT_DIR" "$ROOT_DIR/releases"
install -d -m 700 "$ROOT_DIR/postgres" "$ROOT_DIR/caddy" "$ROOT_DIR/backups"
if [ ! -f "$ROOT_DIR/secrets.env" ]; then
  umask 077
  cat > "$ROOT_DIR/secrets.env" <<CONF
# Секреты сервера JoyRest. Не копируйте этот файл в чаты и репозиторий.
ADMIN_EMAIL=$ADMIN_EMAIL
POSTGRES_PASSWORD=$(openssl rand -hex 24)
CONF
  umask 022
else
  sed -i "s/^ADMIN_EMAIL=.*/ADMIN_EMAIL=$ADMIN_EMAIL/" "$ROOT_DIR/secrets.env"
fi
chmod 600 "$ROOT_DIR/secrets.env"

step "Скачиваю версию $APP_TAG и запускаю сайт"
docker pull -q "$APP_REPO:$APP_TAG" >/dev/null || fail "Не скачался образ $APP_REPO:$APP_TAG."
cid=$(docker create "$APP_REPO:$APP_TAG")
rm -rf "$ROOT_DIR/releases/.incoming"
docker cp "$cid:/app/deploy" "$ROOT_DIR/releases/.incoming" >/dev/null
docker rm "$cid" >/dev/null
version=$(sed -n 's/^APP_VERSION=//p' "$ROOT_DIR/releases/.incoming/release.env")
[ -n "$version" ] || fail "В образе нет описания версии."
rm -rf "${ROOT_DIR:?}/releases/$version"
mv "$ROOT_DIR/releases/.incoming" "$ROOT_DIR/releases/$version"
ln -sfn "releases/$version" "$ROOT_DIR/current"
install -m 755 "$ROOT_DIR/current/bin/joyrest" /usr/local/bin/joyrest
install -m 755 "$ROOT_DIR/current/bin/joyrest-gate" /usr/local/bin/joyrest-gate
joyrest up

echo "Жду, пока сайт ответит (выпуск сертификата — до 2 минут)…"
healthy=0
for _ in $(seq 1 40); do
  if curl -fsS --max-time 5 --resolve "games.joy-rest.ru:443:127.0.0.1" https://games.joy-rest.ru/health >/dev/null 2>&1; then
    healthy=1; break
  fi
  sleep 3
done

# ---------------------------------------------------------------- ключ выкладки
# Создаётся в самом конце: если установка прервётся раньше, повторный запуск создаст
# и покажет ключ (иначе он остался бы на сервере, а вы бы его не увидели).
step "Ключ выкладки для GitHub Actions"
DEPLOY_KEY_NEW=0
if [ ! -s /home/deploy/.ssh/authorized_keys ] || [ "${ROTATE_DEPLOY_KEY:-0}" = 1 ]; then
  tmp=$(mktemp -d)
  ssh-keygen -q -t ed25519 -N "" -C "github-actions-deploy" -f "$tmp/key"
  # restrict: без консоли и пробросов; запускается только привратник выкладки.
  echo "restrict,command=\"/usr/local/bin/joyrest-gate\" $(cat "$tmp/key.pub")" > /home/deploy/.ssh/authorized_keys
  DEPLOY_KEY_HEX=$(xxd -p "$tmp/key" | tr -d '\n')
  shred -u "$tmp/key" "$tmp/key.pub" 2>/dev/null || rm -f "$tmp/key" "$tmp/key.pub"
  rmdir "$tmp"
  DEPLOY_KEY_NEW=1
fi
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

# ---------------------------------------------------------------- итог
echo
echo "=================================================================="
if [ "$healthy" = 1 ]; then
  echo "✅ Сайт работает: https://games.joy-rest.ru/health"
else
  echo "⚠️  Сайт пока не ответил. Посмотрите: joyrest status, joyrest logs caddy"
fi
echo
echo "Ваш вход в Termius: пользователь $OWNER_USER, адрес $SERVER_IP, ваш ключ."
echo "Проверьте его в НОВОМ подключении, это окно не закрывайте."
if [ "$DEPLOY_KEY_NEW" = 1 ]; then
  echo
  echo "Секреты для GitHub (показываются ОДИН раз). Каждый — одна строка:"
  echo "двойное касание выделяет её целиком."
  echo
  echo "DEPLOY_SSH_KEY:"
  echo
  echo "$DEPLOY_KEY_HEX"
  echo
  echo "DEPLOY_KNOWN_HOSTS:"
  echo
  printf '%s %s\n' "$SERVER_IP" "$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)" | xxd -p | tr -d '\n'
  echo
  unset DEPLOY_KEY_HEX
fi
echo "=================================================================="
