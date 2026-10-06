#!/usr/bin/env sh
# Hand the KhaiDocs (Docmost) account over to DeepCode, so the DeepCode login
# is the only one: the workspace owner's Docmost password is replaced by a
# random one nobody types, written to the checkout's .env (git-ignored,
# owner-only) as KHAIDOCS_EMAIL / KHAIDOCS_PASSWORD, which the DeepCode web
# service uses to sign in on the owner's behalf (app_server/khaidocs_proxy.py).
#
# The previous Docmost password stops working. Run again any time to rotate.
# Then restart the service: .venv/bin/deepcode service restart
set -eu
cd "$(dirname "$0")"
env_file="../../.env"

email=$(docker compose exec -T db psql -U docmost -d docmost -tAc \
  "select email from users where role = 'owner' and deleted_at is null order by created_at limit 1")
if [ -z "$email" ]; then
  echo "No KhaiDocs workspace owner yet: open KhaiDocs once and create the workspace." >&2
  exit 1
fi

password=$(openssl rand -hex 24)
hash=$(docker compose exec -T -e KHAIDOCS_NEW_PASSWORD="$password" docmost \
  node -e "require('bcrypt').hash(process.env.KHAIDOCS_NEW_PASSWORD, 12).then((h) => process.stdout.write(h))")
# Through stdin: psql only interpolates :'vars' in script input, not in -c.
echo "update users set password = :'hash', updated_at = now() where email = :'email';" |
  docker compose exec -T db psql -U docmost -d docmost -q -v ON_ERROR_STOP=1 \
    -v email="$email" -v hash="$hash" >/dev/null

umask 077
touch "$env_file"
grep -v -e '^KHAIDOCS_EMAIL=' -e '^KHAIDOCS_PASSWORD=' "$env_file" > "$env_file.tmp" || true
{
  echo "KHAIDOCS_EMAIL=$email"
  echo "KHAIDOCS_PASSWORD=$password"
} >> "$env_file.tmp"
mv "$env_file.tmp" "$env_file"
chmod 600 "$env_file"

echo "KhaiDocs now signs in as $email through DeepCode. Restart the service to apply."
