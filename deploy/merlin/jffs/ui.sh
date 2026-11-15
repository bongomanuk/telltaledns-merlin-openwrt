#!/bin/sh
# Add or remove the TelltaleDNS tab in the Asuswrt-Merlin web UI.
#
# Asuswrt has no add-on menu API. This copies a small user page into /www/user
# and bind-mounts a menuTree.js with a "TelltaleDNS" entry. /www is rebuilt on
# every boot and on a firmware update, so the services-start hook runs this
# again. It is optional: install.sh --no-ui skips it, and `ui.sh remove` takes
# it out. If the firmware changes its menu layout, this fails with a message
# and the dashboard remains at :8053.
set -eu

action=${1:-install}
base=/jffs/telltale
tree=/tmp/menuTree.js
target=/www/require/modules/menuTree.js

[ "$(uname -m)" = "armv7l" ] || [ "$(uname -m)" = "aarch64" ] || {
    echo "unsupported architecture" >&2
    exit 1
}
[ -f "$base/telltale.asp" ] || { echo "telltale.asp is missing" >&2; exit 1; }

need_addons() {
    nvram get rc_support 2>/dev/null | tr ' ' '\n' | grep -qx 'am_addons'
}

install_page() {
    need_addons || { echo "firmware has no add-on menu support" >&2; return 1; }
    [ -d /www/user ] || { echo "/www/user is missing" >&2; return 1; }

    page=""
    for i in 1 2 3 4 5 6 7 8 9 10; do
        if [ ! -f "/www/user/user$i.asp" ]; then
            page="user$i.asp"
            break
        fi
    done
    [ -n "$page" ] || { echo "no free user page slot" >&2; return 1; }

    cp "$base/telltale.asp" "/www/user/$page"
    printf '%s\n' "$page" > "$base/ui-page"

    [ -f "$tree" ] || cp "$target" "$tree"
    sed -i "/url: \"$page\", tabName: \"TelltaleDNS\"/d" "$tree"
    if ! grep -q 'url: "Guest_network.asp", tabName:' "$tree"; then
        echo "no Guest Network tab to insert after" >&2
        return 1
    fi
    sed -i "/url: \"Guest_network.asp\", tabName:/a {url: \"$page\", tabName: \"TelltaleDNS\"}," "$tree"

    umount "$target" 2>/dev/null || true
    mount -o bind "$tree" "$target"
    echo "TelltaleDNS tab added ($page)"
}

remove_page() {
    page=$(cat "$base/ui-page" 2>/dev/null || true)
    [ -n "$page" ] && rm -f "/www/user/$page"
    if [ -f "$tree" ]; then
        [ -n "$page" ] && sed -i "/url: \"$page\", tabName: \"TelltaleDNS\"/d" "$tree"
        umount "$target" 2>/dev/null || true
        mount -o bind "$tree" "$target"
    fi
    rm -f "$base/ui-page"
    echo "TelltaleDNS tab removed"
}

case "$action" in
    install) install_page ;;
    remove) remove_page ;;
    *) echo "usage: $0 install|remove" >&2; exit 2 ;;
esac
