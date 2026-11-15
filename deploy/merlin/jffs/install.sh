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
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
arch=$(uname -m)
case "$arch" in
    armv7l|aarch64) ;;
    *) echo "unsupported architecture: $arch (need armv7l or aarch64)" >&2; exit 1 ;;
esac
[ -d /jffs ] || { echo "no /jffs on this router" >&2; exit 1; }
[ "$(id -u)" = 0 ] || { echo "run this as root" >&2; exit 1; }
[ -f "$here/telltale.gz" ] || { echo "telltale.gz is missing from the bundle" >&2; exit 1; }

dest=/jffs/telltale
mkdir -p "$dest/data" /jffs/scripts

if [ -f "$dest/telltale.toml" ]; then
    backup="$dest/telltale.toml.bak-$(date +%Y%m%d%H%M%S)"
    cp -p "$dest/telltale.toml" "$backup"
    echo "kept the old config as $backup"
fi

cp "$here/telltale.toml" "$dest/telltale.toml"
cp "$here/telltale.gz" "$dest/telltale.gz"

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
if ! grep -q '^# telltale$' /jffs/scripts/services-start; then
    cat >> /jffs/scripts/services-start <<'START'
# telltale
if [ -x /jffs/telltale/telltale ]; then
    /jffs/telltale/telltale run -c /jffs/telltale/telltale.toml >>/tmp/telltale.log 2>&1 &
fi
START
fi
chmod 755 /jffs/scripts/services-start

"$dest/telltale" --version
echo
echo "Installed in $dest."
echo "Free port 53 from dnsmasq first (see deploy/merlin/README.md), then start it:"
echo "  /jffs/telltale/telltale run -c /jffs/telltale/telltale.toml"
echo "  /jffs/telltale/telltale auth setup-token -c /jffs/telltale/telltale.toml"
