#!/bin/sh
# Build an OpenWrt 25.12+ (apk v3) package from a prebuilt static telltale binary.
#
#   build-apk.sh <apk> <binary> <arch> <version> <outdir>
#   build-apk.sh openwrt-sdk/staging_dir/host/bin/apk \
#       bin/telltale-aarch64-linux aarch64_cortex-a53 0.7.0 public/openwrt
#
# <apk> is OpenWrt's host apk-tools (it needs the SDK's host libraries); run this
# as root (or under fakeroot) so the packaged files are owned by root.
set -eu

if [ "$#" -ne 5 ]; then
    echo "usage: $0 <apk> <binary> <arch> <version> <outdir>" >&2
    exit 2
fi

apk=$1
binary=$2
arch=$3
version=$4
outdir=$5
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

[ -f "$binary" ] || { echo "no such binary: $binary" >&2; exit 1; }
[ -x "$apk" ] || { echo "no apk tool: $apk" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM
stage=$work/stage

mkdir -p "$stage/usr/bin" \
         "$stage/etc/init.d" \
         "$stage/etc/telltale" \
         "$stage/lib/apk/packages"

install -m 755 "$binary" "$stage/usr/bin/telltale"
install -m 755 "$here/telltale.init" "$stage/etc/init.d/telltale"
install -m 644 "$here/telltale.toml" "$stage/etc/telltale/telltale.toml"

# apk conffiles: keep the user's config across upgrades.
conffile=/etc/telltale/telltale.toml
printf '%s\n' "$conffile" > "$stage/lib/apk/packages/telltale.conffiles"
sum=$(sha256sum "$stage$conffile" | cut -d' ' -f1)
printf '%s %s\n' "$conffile" "$sum" > "$stage/lib/apk/packages/telltale.conffiles_static"

# OpenWrt also records the file list (paths as /usr/bin/...).
(cd "$stage" && find . \( -type f -o -type l \) -printf '/%P\n' | grep -v '^/lib/apk/packages/' | sort) \
    > "$stage/lib/apk/packages/telltale.list"

if [ "$(id -u)" -eq 0 ]; then
    chown -R 0:0 "$stage"
fi

mkdir -p "$outdir"
package="$outdir/telltale-${version}-${arch}.apk"
rm -f "$package"

SOURCE_DATE_EPOCH=0 "$apk" mkpkg \
    --info "name:telltale" \
    --info "version:${version}" \
    --info "description:TelltaleDNS - a fast, per-device filtering DNS resolver with a web UI" \
    --info "arch:${arch}" \
    --info "license:Apache-2.0 OR MIT" \
    --info "origin:telltale" \
    --info "url:https://github.com/bongomanuk/telltaledns-merlin-openwrt" \
    --info "maintainer:bongomanuk <bongomanuk@users.noreply.github.com>" \
    --script "post-install:$here/post-install" \
    --script "pre-deinstall:$here/pre-deinstall" \
    --files "$stage" \
    --output "$package"

echo "$package"
