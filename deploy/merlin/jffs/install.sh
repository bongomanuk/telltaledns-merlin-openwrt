#!/bin/sh
# Install the TelltaleDNS Merlin bundle under /jffs. Run this on the router, as
# root, from the unpacked bundle directory:
#
#   tar xzf telltale-<version>-merlin-armv7.tar.gz
#   cd telltale-*merlin-armv7
#   ./install.sh
#
# It installs a gzip-compressed binary (about 15 MB instead of 35 MB) and a
# small launcher that unpacks it into /tmp at start, which keeps the flash use
# down. It points dnsmasq at TelltaleDNS and restarts dnsmasq: dnsmasq keeps
# port 53 and its local names, so the LAN keeps resolving when TelltaleDNS is
# down. Pass --no-dns to leave dnsmasq alone.
#
# The router web UI tab is added by default. Pass --no-ui to skip it; the
# TelltaleDNS dashboard is always at http://<router>:8053/.
set -eu

ui=1
dns=1
for arg in "$@"; do
    case "$arg" in
        --no-ui) ui=0 ;;
        --no-dns) dns=0 ;;
        "") ;;
        *) echo "usage: $0 [--no-ui] [--no-dns]" >&2; exit 2 ;;
    esac
done

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
data_dir=/tmp/telltale-data
usb=""
for m in /tmp/mnt/*; do
    [ -d "$m" ] || continue
    mount | grep -q " on $m type " || continue
    data_dir="$m/telltale/data"
    usb="$m"
    break
done
# On a USB volume, keep SQLite in a small ext4 image: Asus's NTFS driver is not safe
# for a database under load. The image is one large file to tntfs and a normal
# filesystem to ext4.
if [ -n "$usb" ]; then
    img="$usb/telltale.ext4"
    if [ ! -f "$img" ]; then
        dd if=/dev/zero of="$img" bs=1M count=0 seek=2048 2>/dev/null
        mke2fs -t ext4 -F -q -L ttdata "$img" 2>/dev/null || rm -f "$img"
    fi
    if [ -f "$img" ]; then
        mkdir -p /tmp/mnt/telltale
        mount | grep -q " on /tmp/mnt/telltale " || mount -o loop "$img" /tmp/mnt/telltale
        if mount | grep -q " on /tmp/mnt/telltale "; then
            data_dir=/tmp/mnt/telltale/data
            usb=/tmp/mnt/telltale
        fi
    fi
fi
mkdir -p "$data_dir"

if [ -f "$dest/telltale.toml" ]; then
    backup="$dest/telltale.toml.bak-$(date +%Y%m%d%H%M%S)"
    cp -p "$dest/telltale.toml" "$backup"
    echo "kept the old config as $backup"
fi

# Accounts and settings live in the database under data_dir. Moving it to
# another filesystem starts a new database, so the first admin must be created
# again; say so instead of letting the user find out at the login page.
old_data=$(sed -n 's/^data_dir = "\(.*\)"/\1/p' "$dest/telltale.toml" 2>/dev/null | head -1)
cp "$here/telltale.toml" "$dest/telltale.toml"
sed -i "s#^data_dir = .*#data_dir = \"$data_dir\"#" "$dest/telltale.toml"
if [ -n "$old_data" ] && [ "$old_data" != "$data_dir" ]; then
    echo "Data directory changed: $old_data -> $data_dir"
    echo "The account database does not move between filesystems: if the login"
    echo "stops working, create the first admin again with the setup token."
fi
# The 15 MB bundle must not live on the 47 MB JFFS2 partition: writing it can
# trigger JFFS2 garbage collection, and on some ASUS firmware that panics the
# kernel. Keep it on the data volume and leave only the small launcher and
# config on flash.
bundle_dir=$dest
if [ -n "$usb" ] && mount | grep -q " on /tmp/mnt/telltale "; then
    bundle_dir=/tmp/mnt/telltale
fi
cp "$here/telltale.gz" "$bundle_dir/telltale.gz"
[ "$bundle_dir" = "$dest" ] || rm -f "$dest/telltale.gz"
if [ "$bundle_dir" = "$dest" ]; then
    echo "warning: no data volume is mounted, so the 15 MB bundle is on the 47 MB"
    echo "flash partition. Writing it can trigger JFFS2 garbage collection, which"
    echo "panics on some ASUS firmware. Plug in a USB drive and run this again."
fi
cp "$here/ui.sh" "$dest/ui.sh"
cp "$here/telltale.asp" "$dest/telltale.asp"
[ -f "$here/telltale_icon.png" ] && cp "$here/telltale_icon.png" "$dest/telltale_icon.png"
# The router page signs the embedded dashboard in with this token. It is readable only
# by root and only sent to sessions that already signed in to the router.
if [ ! -s "$dest/ui-token" ]; then
    dd if=/dev/urandom bs=16 count=1 2>/dev/null | md5sum | cut -d' ' -f1 > "$dest/ui-token"
    chmod 600 "$dest/ui-token"
fi
chmod 755 "$dest/ui.sh"
chmod 644 "$dest/telltale.asp"

cat > "$dest/telltale" <<'LAUNCH'
#!/bin/sh
# Run from the data volume: unpacking a 35 MB binary into /tmp costs RAM that a
# 512 MB router needs for its filter compile.
BIN=/tmp/mnt/telltale/telltale.bin
if [ -x "$BIN" ]; then
    exec "$BIN" "$@"
fi
# The bundle lives on the data volume; /jffs keeps only a small launcher. Fall
# back to an old flash copy if one is still there.
for gz in /tmp/mnt/*/telltale/telltale.gz /jffs/telltale/telltale.gz; do
    [ -f "$gz" ] || continue
    out=/tmp/telltale.bin
    [ -d /tmp/mnt/telltale ] && out=/tmp/mnt/telltale/telltale.bin
    gzip -dc "$gz" > "$out" || exit 1
    chmod 755 "$out"
    exec "$out" "$@"
done
exit 1
LAUNCH
chmod 755 "$dest/telltale"
rm -f /tmp/telltale.bin
# If the data volume is already mounted (a re-install on a running router), put
# the binary there now rather than waiting for the next boot.
if [ -d /tmp/mnt/telltale ]; then
    gzip -dc "$bundle_dir/telltale.gz" > /tmp/mnt/telltale/telltale.bin 2>/dev/null &&
        chmod 755 /tmp/mnt/telltale/telltale.bin
fi

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
    if [ -z "$data" ]; then
        echo "$(date) no USB volume mounted: using RAM, nothing persists across a reboot" >>/tmp/telltale.log
        data=/tmp/telltale-data
    fi
    # Data lives in the ext4 image on the USB volume when it is there.
    if [ -n "$data" ]; then
        img="${data%/telltale/*}/telltale.ext4"
        if [ -f "$img" ]; then
            mkdir -p /tmp/mnt/telltale
            mount | grep -q " on /tmp/mnt/telltale " || mount -o loop "$img" /tmp/mnt/telltale
            data=/tmp/mnt/telltale/data
        fi
    fi
    # Run the binary from the data volume, not from /tmp: the unpacked copy is
    # 35 MB of RAM that a 512 MB router needs for its filter compile. The bundle
    # is there too, so an upgrade writes nothing large to the flash. Refresh the
    # binary when a newer bundle is present.
    bin=/tmp/mnt/telltale/telltale.bin
    bundle=/jffs/telltale/telltale.gz
    for g in /tmp/mnt/*/telltale/telltale.gz; do
        [ -f "$g" ] && bundle=$g && break
    done
    if [ -d /tmp/mnt/telltale ] && [ -f "$bundle" ] &&
        { [ ! -x "$bin" ] || [ "$bundle" -nt "$bin" ]; }; then
        gzip -dc "$bundle" > "$bin.tmp" 2>/dev/null &&
            chmod 755 "$bin.tmp" && mv -f "$bin.tmp" "$bin"
    fi
    # Connection accounting for the Traffic page, and clear yesterday's firewall pauses.
    echo 1 > /proc/sys/net/netfilter/nf_conntrack_acct 2>/dev/null
    iptables -F TELLTALE_BLOCK 2>/dev/null
    rm -f /tmp/telltale-pause-* /tmp/telltale-unpause-* /tmp/telltale-pause-*.sh
    mkdir -p "$data"
    sed "s#^data_dir = .*#data_dir = \"$data\"#" "$cfg" > /tmp/telltale-run.toml
    ui_token=""
    [ -s /jffs/telltale/ui-token ] && ui_token=$(cat /jffs/telltale/ui-token)
    TELLTALE_UI_TOKEN="$ui_token" /jffs/telltale/telltale run -c /tmp/telltale-run.toml >>/tmp/telltale.log 2>&1 &
    # Asuswrt sets vm.panic_on_oom=1, so an OOM panics the whole router instead
    # of killing one process. Make this the process the kernel kills: a list
    # refresh can then only stop DNS, which dnsmasq's plain upstreams cover.
    echo 500 > /proc/$!/oom_score_adj 2>/dev/null
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

# Safe mode: dnsmasq keeps port 53 and its local names, and sends public
# queries to TelltaleDNS on 5354. The plain servers after it are the fallback
# when TelltaleDNS is not running. `port=5354` is left over from the older
# "TelltaleDNS on 53" install and must go, or dnsmasq and TelltaleDNS fight for
# the same port.
if [ "$dns" = 1 ]; then
    mkdir -p /jffs/configs
    add=/jffs/configs/dnsmasq.conf.add
    touch "$add"
    sed -i '/^port=5354$/d' "$add"
    for line in 'no-resolv' 'strict-order' 'add-mac' 'server=127.0.0.1#5354' 'server=9.9.9.9' 'server=1.1.1.1'; do
        grep -qx "$line" "$add" || echo "$line" >> "$add"
    done
    service restart_dnsmasq >/dev/null 2>&1 || true
fi

"$dest/telltale" --version
echo
echo "Installed in $dest."
if [ -n "$usb" ]; then
    echo "Data and query log: $data_dir (USB volume at $usb). Nothing is written"
    echo "to the router's flash while it runs."
else
    echo "No USB volume is mounted. The data and query log will live in RAM"
    echo "(/tmp/telltale-data) and be lost on reboot. Mount a USB drive and run"
    echo "this installer again to keep them, without wearing the router's flash."
fi
if [ "$ui" = 1 ]; then
    if "$dest/ui.sh" install; then
        echo "Added a TelltaleDNS tab under Network in the router's web UI."
    else
        echo "Could not add the web UI tab; the dashboard is still at http://<router>:8053/."
    fi
fi
if [ "$dns" = 1 ]; then
    echo "dnsmasq now forwards public queries to TelltaleDNS on 127.0.0.1:5354 and"
    echo "keeps port 53 for DHCP and local names. Undo with:"
    echo "  sed -i '/^no-resolv$/d;/^strict-order$/d;/^add-mac$/d;/^server=127.0.0.1#5354$/d' /jffs/configs/dnsmasq.conf.add"
    echo "  service restart_dnsmasq"
fi
echo "Start it now (or reboot):"
echo "  /jffs/scripts/services-start"
echo "First admin token:"
echo "  /jffs/telltale/telltale auth setup-token -c /jffs/telltale/telltale.toml"
