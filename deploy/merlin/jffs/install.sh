#!/bin/sh
# Install the TelltaleDNS Merlin bundle under /jffs. Run this on the router, as
# root, from the unpacked bundle directory:
#
#   tar xzf telltale-<version>-merlin-armv7.tar.gz
#   cd telltale-*merlin-armv7
#   ./install.sh
#
# It installs a gzip-compressed binary (about 14 MB instead of 28 MB) and a
# small launcher that unpacks it into /tmp at start, which keeps the flash use
# down. It does not change dnsmasq or start the service; see the install guide
# for the port 53 step.
#
# The router web UI tab is added by default. Pass --no-ui to skip it; the
# TelltaleDNS dashboard is always at http://<router>:8053/.
set -eu

ui=1
case "${1:-}" in
    --no-ui) ui=0 ;;
    "") ;;
    *) echo "usage: $0 [--no-ui]" >&2; exit 2 ;;
esac

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
arch=$(uname -m)
case "$arch" in
    armv7l|aarch64) ;;
    *) echo "unsupported architecture: $arch (need armv7l or aarch64)" >&2; exit 1 ;;
esac
[ -d /jffs ] || { echo "no /jffs on this router" >&2; exit 1; }
# Busybox on Merlin has no id(1), so read the uid from /proc.
uid=$(sed -n 's/^Uid:[[:space:]]*\([0-9]*\).*/\1/p' /proc/self/status)
[ "$uid" = 0 ] || { echo "run this as root" >&2; exit 1; }
[ -f "$here/telltale.gz" ] || { echo "telltale.gz is missing from the bundle" >&2; exit 1; }

dest=/jffs/telltale
mkdir -p "$dest/data" /jffs/scripts

# Prefer a mounted USB volume for the data directory. The query log, the state
# database and the blocklists are written constantly, and the router's internal
# flash is small and wears out. Falls back to /jffs when no USB volume is
# mounted. The config is rewritten below to the chosen path.
data_dir=/jffs/telltale/data
usb=""
for m in /tmp/mnt/*; do
    [ -d "$m" ] || continue
    mount | grep -q " on $m type " || continue
    data_dir="$m/telltale/data"
    usb="$m"
    break
done
mkdir -p "$data_dir"

if [ -f "$dest/telltale.toml" ]; then
    backup="$dest/telltale.toml.bak-$(date +%Y%m%d%H%M%S)"
    cp -p "$dest/telltale.toml" "$backup"
    echo "kept the old config as $backup"
fi

cp "$here/telltale.toml" "$dest/telltale.toml"
sed -i "s#^data_dir = .*#data_dir = \"$data_dir\"#" "$dest/telltale.toml"
cp "$here/telltale.gz" "$dest/telltale.gz"
cp "$here/ui.sh" "$dest/ui.sh"
cp "$here/telltale.asp" "$dest/telltale.asp"
chmod 755 "$dest/ui.sh"
chmod 644 "$dest/telltale.asp"

cat > "$dest/telltale" <<'LAUNCH'
#!/bin/sh
BIN=/tmp/telltale.bin
if [ ! -x "$BIN" ]; then
    gzip -dc /jffs/telltale/telltale.gz > "$BIN" || exit 1
    chmod 755 "$BIN"
fi
exec "$BIN" "$@"
LAUNCH
chmod 755 "$dest/telltale"
rm -f /tmp/telltale.bin

if [ ! -f /jffs/scripts/services-start ]; then
    printf '#!/bin/sh\n' > /jffs/scripts/services-start
fi
# Replace an earlier block, so a re-install picks up a changed data directory.
if grep -q '^# telltale$' /jffs/scripts/services-start; then
    sed -i '/^# telltale$/,/^fi$/d' /jffs/scripts/services-start
fi
# The USB volume is mounted by the firmware under a name that can change (the
# label, or sda1). Find it at start, wait for it, and fall back to internal
# flash when it never appears: an unplugged stick must not leave the router
# without DNS.
cat >> /jffs/scripts/services-start <<'START'
# telltale
if [ -x /jffs/telltale/telltale ]; then
    cfg=/jffs/telltale/telltale.toml
    data=""
    i=0
    while [ $i -lt 30 ]; do
        for m in /tmp/mnt/*; do
            [ -d "$m" ] || continue
            mount | grep -q " on $m type " || continue
            mkdir -p "$m/telltale" 2>/dev/null || continue
            data="$m/telltale/data"
            break
        done
        [ -n "$data" ] && break
        sleep 2
        i=$((i + 1))
    done
    [ -n "$data" ] || data=/jffs/telltale/data
    mkdir -p "$data"
    sed "s#^data_dir = .*#data_dir = \"$data\"#" "$cfg" > /tmp/telltale-run.toml
    /jffs/telltale/telltale run -c /tmp/telltale-run.toml >>/tmp/telltale.log 2>&1 &
fi
START

if [ "$ui" = 1 ]; then
    : > "$dest/ui-enabled"
    if ! grep -q '^# telltale-ui$' /jffs/scripts/services-start; then
        cat >> /jffs/scripts/services-start <<'START'
# telltale-ui
if [ -x /jffs/telltale/ui.sh ] && [ -f /jffs/telltale/ui-enabled ]; then
    /jffs/telltale/ui.sh install >/dev/null 2>&1 || true
fi
START
    fi
else
    rm -f "$dest/ui-enabled"
    if grep -q '^# telltale-ui$' /jffs/scripts/services-start; then
        sed -i '/^# telltale-ui$/,/^fi$/d' /jffs/scripts/services-start
    fi
fi
chmod 755 /jffs/scripts/services-start

"$dest/telltale" --version
echo
echo "Installed in $dest."
if [ -n "$usb" ]; then
    echo "Data and query log: $data_dir (USB volume at $usb)."
else
    echo "Data and query log: $data_dir (internal flash; mount a USB volume and"
    echo "re-run this installer to move it off the router's flash)."
fi
if [ "$ui" = 1 ]; then
    if "$dest/ui.sh" install; then
        echo "Added a TelltaleDNS tab under Network in the router's web UI."
    else
        echo "Could not add the web UI tab; the dashboard is still at http://<router>:8053/."
    fi
fi
echo "Free port 53 from dnsmasq first (see deploy/merlin/README.md), then start it:"
echo "  /jffs/telltale/telltale run -c /jffs/telltale/telltale.toml"
echo "  /jffs/telltale/telltale auth setup-token -c /jffs/telltale/telltale.toml"
