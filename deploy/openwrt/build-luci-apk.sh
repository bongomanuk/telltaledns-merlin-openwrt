#!/bin/sh
# Build the noarch LuCI app package for TelltaleDNS.
#
#   build-luci-apk.sh <apk> <version> <outdir>
#   build-luci-apk.sh openwrt-sdk/staging_dir/host/bin/apk 0.6.0-r7 public/openwrt
#
# <apk> is OpenWrt's host apk-tools (it needs the SDK's host libraries); run this
# as root (or under fakeroot) so the packaged files are owned by root.
set -eu

if [ "$#" -ne 3 ]; then
    echo "usage: $0 <apk> <version> <outdir>" >&2
    exit 2
fi

apk=$1
version=$2
outdir=$3
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
src="$here/luci"

[ -x "$apk" ] || { echo "no apk tool: $apk" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM
stage=$work/stage

mkdir -p "$stage/www/luci-static/resources/view" \
         "$stage/usr/share/luci/menu.d" \
         "$stage/usr/share/rpcd/acl.d" \
         "$stage/lib/apk/packages"

install -m 644 "$src/htdocs/luci-static/resources/view/telltale.js" \
    "$stage/www/luci-static/resources/view/telltale.js"
install -m 644 "$src/root/usr/share/luci/menu.d/luci-app-telltale.json" \
    "$stage/usr/share/luci/menu.d/luci-app-telltale.json"
install -m 644 "$src/root/usr/share/rpcd/acl.d/luci-app-telltale.json" \
    "$stage/usr/share/rpcd/acl.d/luci-app-telltale.json"

(cd "$stage" && find . \( -type f -o -type l \) -printf '/%P\n' | grep -v '^/lib/apk/packages/' | sort) \
    > "$stage/lib/apk/packages/luci-app-telltale.list"

if [ "$(id -u)" -eq 0 ]; then
    chown -R 0:0 "$stage"
fi

mkdir -p "$outdir"
package="$outdir/luci-app-telltale-${version}.apk"
rm -f "$package"

SOURCE_DATE_EPOCH=0 "$apk" mkpkg \
    --info "name:luci-app-telltale" \
    --info "version:${version}" \
    --info "description:LuCI app for TelltaleDNS: service status, start/stop/restart and a link to the dashboard" \
    --info "arch:noarch" \
    --info "license:Apache-2.0 OR MIT" \
    --info "origin:luci-app-telltale" \
    --info "url:https://github.com/bongomanuk/telltaledns-merlin-openwrt" \
    --info "maintainer:bongomanuk <bongomanuk@users.noreply.github.com>" \
    --info "depends:luci-base telltale" \
    --script "post-install:$src/post-install" \
    --files "$stage" \
    --output "$package"

echo "$package"
