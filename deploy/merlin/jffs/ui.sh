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
    # Remove an older TelltaleDNS entry and page first: a re-install can pick a
    # different userN.asp, and leaving the old one would add a second tab.
    old=$(cat "$base/ui-page" 2>/dev/null || true)
    [ -n "$old" ] && rm -f "/www/user/$old"
    [ -f "$tree" ] || cp "$target" "$tree"
    sed -i '/tabName: "TelltaleDNS"/d' "$tree"

    [ -n "$page" ] || { echo "no free user page slot" >&2; return 1; }

    cp "$base/telltale.asp" "/www/user/$page"
    printf '%s\n' "$page" > "$base/ui-page"

    # A top-level menu entry, not a tab buried under Network. The entry is one
    # line, inserted first in the list; the menu renders it like AiMesh.
    sed -i "/url: \"$page\", tabName: \"TelltaleDNS\"/d" "$tree"
    sed -i '/index: "menu_TelltaleDNS"/d' "$tree"
    if ! grep -q '^list: \[$' "$tree"; then
        echo "unexpected menuTree.js layout" >&2
        return 1
    fi
    # Every top-level entry ends its tab list with this terminator; without it
    # the router's menu code drops the entry.
    sed -i "/^list: \[$/a {menuName: \"TelltaleDNS\", index: \"menu_TelltaleDNS\", tab: [{url: \"$page\", tabName: \"TelltaleDNS\"}, {url: \"NULL\", tabName: \"__INHERIT__\"}]}," "$tree"

    umount "$target" 2>/dev/null || true
    mount -o bind "$tree" "$target"
    # A firmware update replaces /www; services-start runs this again. Verify the
    # patch actually landed instead of reporting success blindly.
    if ! grep -q "menu_TelltaleDNS" "$target" || [ ! -f "/www/user/$page" ]; then
        echo "the menu patch did not apply" >&2
        return 1
    fi
    echo "TelltaleDNS tab added ($page)"
}

remove_page() {
    page=$(cat "$base/ui-page" 2>/dev/null || true)
    [ -n "$page" ] && rm -f "/www/user/$page"
    if [ -f "$tree" ]; then
        sed -i '/tabName: "TelltaleDNS"/d;/index: "menu_TelltaleDNS"/d' "$tree"
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
