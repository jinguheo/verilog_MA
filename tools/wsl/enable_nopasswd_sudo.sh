#!/usr/bin/env bash
# Grant passwordless sudo to the WSL login user.
#
# Run this yourself, as root, from PowerShell:
#   wsl -d Ubuntu -u root -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/enable_nopasswd_sudo.sh
#
# To undo later:
#   wsl -d Ubuntu -u root -- rm /etc/sudoers.d/99-nopasswd
set -euo pipefail

TARGET_USER=oem

if ! id -u "$TARGET_USER" >/dev/null 2>&1; then
  echo "ERROR: user '$TARGET_USER' does not exist in this distro." >&2
  exit 1
fi

printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$TARGET_USER" > /etc/sudoers.d/99-nopasswd
chmod 440 /etc/sudoers.d/99-nopasswd

# Reject a malformed sudoers file rather than leaving sudo broken.
if visudo -c -f /etc/sudoers.d/99-nopasswd; then
  echo "done: passwordless sudo enabled for $TARGET_USER"
else
  rm -f /etc/sudoers.d/99-nopasswd
  echo "ERROR: sudoers validation failed, change reverted." >&2
  exit 1
fi
