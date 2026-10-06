#!/usr/bin/env bash
# Последний шаг настройки: запрет входа root и входа по паролю.
# Запускать ТОЛЬКО после того, как вход вашим пользователем по ключу из Termius проверен
# и выкладка по ключу из GitHub Actions работает. Запуск: sudo bash lock-ssh.sh
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Запускайте через sudo." >&2; exit 1; }
owner=$(sed -n 's/^\([a-z][a-z0-9_-]*\) ALL=(ALL) NOPASSWD:ALL$/\1/p' /etc/sudoers.d/90-joyrest-owner 2>/dev/null)
[ -n "$owner" ] && [ -s "/home/$owner/.ssh/authorized_keys" ] \
  || { echo "Нет пользователя-владельца с ключом — сначала install.sh." >&2; exit 1; }

if [ "${SUDO_USER:-}" != "$owner" ]; then
  echo "Запустите этот скрипт, войдя как $owner (по ключу), а не как root." >&2
  echo "Так мы точно знаем, что вход по ключу работает." >&2
  exit 1
fi

cat > /etc/ssh/sshd_config.d/10-joyrest.conf <<CONF
# JoyRest: файл читается раньше 50-cloud-init.conf, его значения главнее.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
MaxAuthTries 4
LoginGraceTime 30
X11Forwarding no
AllowUsers $owner deploy
CONF
sshd -t
systemctl reload ssh
echo "✅ Готово: вход только по ключу, root входить не может."
echo "Не закрывайте это окно: откройте НОВОЕ подключение в Termius и проверьте вход."
