#!/bin/sh
# Build an Entware/opkg .ipk from a prebuilt static telltale binary.
#
#   build-ipk.sh <binary> <arch> <version> <outdir>
#   build-ipk.sh bin/telltale-armv7-linux armv7-3.2 0.7.0-merlin.1 public/entware
#
# <arch> is the opkg architecture string Entware uses: armv7-3.2 or aarch64-3.10.
set -eu

if [ "$#" -ne 4 ]; then
    echo "usage: $0 <binary> <arch> <version> <outdir>" >&2
    exit 2
fi

binary=$1
arch=$2
version=$3
outdir=$4
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

[ -f "$binary" ] || { echo "no such binary: $binary" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM

mkdir -p "$work/data/opt/sbin" \
         "$work/data/opt/etc/telltale" \
         "$work/data/opt/etc/init.d" \
         "$work/control"

install -m 755 "$binary" "$work/data/opt/sbin/telltale"
install -m 644 "$here/telltale.toml" "$work/data/opt/etc/telltale/telltale.toml"
install -m 755 "$here/S99telltale" "$work/data/opt/etc/init.d/S99telltale"

size=$(du -sb "$work/data" | cut -f1)

sed -e "s|@VERSION@|$version|g" \
    -e "s|@ARCH@|$arch|g" \
    -e "s|@SIZE@|$size|g" \
    "$here/control.in" > "$work/control/control"
install -m 755 "$here/postinst" "$work/control/postinst"
install -m 755 "$here/prerm" "$work/control/prerm"
printf '%s\n' /opt/etc/telltale/telltale.toml > "$work/control/conffiles"

# Reproducible timestamps/owners, like the release builds.
tar_args="--owner=0 --group=0 --numeric-owner --sort=name --mtime=@0"
(cd "$work/control" && tar $tar_args -czf "$work/control.tar.gz" .)
(cd "$work/data" && tar $tar_args -czf "$work/data.tar.gz" .)
printf '2.0\n' > "$work/debian-binary"

mkdir -p "$outdir"
# `ar` runs from a temporary directory, so the output path must be absolute.
outdir=$(CDPATH= cd -- "$outdir" && pwd)
ipk="$outdir/telltale_${version}_${arch}.ipk"
rm -f "$ipk"
(cd "$work" && ar rcs "$ipk" debian-binary control.tar.gz data.tar.gz)

echo "$ipk"
