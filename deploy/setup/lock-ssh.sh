#!/usr/bin/env bash
# Последний шаг настройки: запрет входа root и входа по паролю (RUNBOOK, шаг 9).
# Запускать ТОЛЬКО после того, как вход вашим пользователем по ключу из Termius проверен
# и выкладка по ключу из GitHub Actions работает.
#
#   sudo bash lock-ssh.sh --check   показать, что будет сделано, ничего не менять
#   sudo bash lock-ssh.sh           применить
#
# После применения скрипт сверяет итоговые настройки sshd (sshd -T). Если root или пароль
# всё ещё разрешены — возвращает прежние настройки. Открытые подключения не обрываются.
set -euo pipefail

CONF=/etc/ssh/sshd_config.d/10-joyrest.conf
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

fail() { echo "❌ $*" >&2; exit 1; }
ok()   { echo "  ✅ $*"; }

[ "$(id -u)" = 0 ] || fail "Запускайте через sudo."
owner=$(sed -n 's/^\([a-z][a-z0-9_-]*\) ALL=(ALL) NOPASSWD:ALL$/\1/p' /etc/sudoers.d/90-joyrest-owner 2>/dev/null)
[ -n "$owner" ] || fail "Нет пользователя-владельца (/etc/sudoers.d/90-joyrest-owner) — сначала install.sh."
if [ "${SUDO_USER:-}" != "$owner" ]; then
  echo "Запустите этот скрипт, войдя как $owner (по ключу), а не как root." >&2
  echo "Так мы точно знаем, что вход по ключу работает." >&2
  exit 1
fi

echo "Проверка перед запретом:"
home=$(getent passwd "$owner" | cut -d: -f6)
keys="$home/.ssh/authorized_keys"
# sshd (StrictModes) отвергает ключ, если папка или файл доступны на запись другим.
[ -s "$keys" ] && grep -qE '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp[0-9]+) ' "$keys" \
  || fail "У $owner нет ключа в $keys."
[ "$(stat -c '%U' "$home/.ssh")" = "$owner" ] && [ "$(stat -c '%U' "$keys")" = "$owner" ] \
  || fail "Папка $home/.ssh или $keys принадлежит не $owner."
[ $(( 0$(stat -c '%a' "$home/.ssh") & 022 )) -eq 0 ] && [ $(( 0$(stat -c '%a' "$keys") & 022 )) -eq 0 ] \
  || fail "Права на $home/.ssh или $keys слишком открытые (нужно 700 и 600)."
ok "у $owner есть ключ, права на ~/.ssh верные"
grep -q 'command="/usr/local/bin/joyrest-gate"' /home/deploy/.ssh/authorized_keys 2>/dev/null \
  || fail "Нет ключа выкладки у пользователя deploy — выкладка из GitHub перестала бы работать."
ok "ключ выкладки deploy на месте"

new=$(mktemp)
trap 'rm -f "$new"' EXIT
cat > "$new" <<CONF
# JoyRest: файл читается раньше 50-cloud-init.conf, его значения главнее.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
MaxAuthTries 4
LoginGraceTime 30
X11Forwarding no
AllowUsers $owner deploy
CONF

if [ "$CHECK_ONLY" = 1 ]; then
  echo
  echo "Будет записано в $CONF:"
  sed 's/^/    /' "$new"
  echo
  echo "Сейчас действует:"
  sshd -T 2>/dev/null | grep -E '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|allowusers) ' | sed 's/^/    /'
  echo
  echo "Ничего не изменено. Применить: sudo bash $0"
  exit 0
fi

backup="$CONF.before-lock"
[ -f "$CONF" ] && cp -p "$CONF" "$backup"
install -m 644 "$new" "$CONF"
mkdir -p /run/sshd

restore() {
  echo "❌ $1 — возвращаю прежние настройки SSH." >&2
  if [ -f "$backup" ]; then mv -f "$backup" "$CONF"; else rm -f "$CONF"; fi
  sshd -t && { systemctl reload ssh 2>/dev/null || systemctl restart ssh; }
  echo "Прежние настройки восстановлены, вход как раньше. Пришлите вывод Claude." >&2
  exit 1
}

sshd -t || restore "sshd не принял новый файл настроек"
systemctl reload ssh 2>/dev/null || systemctl restart ssh || restore "SSH не перезапустился"

# Итоговые настройки, как их видит sshd с учётом всех файлов (в том числе 50-cloud-init.conf).
effective=$(sshd -T)
grep -qx 'permitrootlogin no' <<<"$effective" || restore "вход root всё ещё разрешён"
grep -qx 'passwordauthentication no' <<<"$effective" || restore "вход по паролю всё ещё разрешён"
grep -qx 'kbdinteractiveauthentication no' <<<"$effective" || restore "вход по коду с клавиатуры всё ещё разрешён"
grep -qE "^allowusers( .*)? $owner( |$)" <<<"$effective" || restore "в AllowUsers нет $owner"

rm -f "$backup"
echo
echo "✅ Готово: вход только по ключу, root по SSH входить не может."
echo "   Итог: $(grep -E '^(permitrootlogin|passwordauthentication|allowusers) ' <<<"$effective" | tr '\n' ';' | sed 's/;$//; s/;/; /g')"
echo
echo "Не закрывайте это окно: откройте НОВОЕ подключение в Termius под $owner и проверьте вход."
