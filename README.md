# TelltaleDNS for ASUS Merlin and OpenWrt

[![merlin-binaries](https://github.com/bongomanuk/telltaledns-merlin-openwrt/actions/workflows/merlin-binaries.yml/badge.svg)](https://github.com/bongomanuk/telltaledns-merlin-openwrt/actions/workflows/merlin-binaries.yml)
[![merlin-feed](https://github.com/bongomanuk/telltaledns-merlin-openwrt/actions/workflows/merlin-feed.yml/badge.svg)](https://github.com/bongomanuk/telltaledns-merlin-openwrt/actions/workflows/merlin-feed.yml)
[![License: Apache-2.0 OR MIT](https://img.shields.io/badge/license-Apache--2.0%20OR%20MIT-blue.svg)](#license)

Static, self-contained builds of [TelltaleDNS](https://github.com/paimonsoror/telltaledns) for **ASUS Merlin (Asuswrt-Merlin) and OpenWrt routers**. One binary with the web UI embedded, no Docker and no systemd. The ASUS Merlin builds need no Entware to run; the OpenWrt builds are apk packages for OpenWrt 25.12+.

> **This fork is proudly not built by Claude.**

These are unofficial builds. There is no guarantee that they work on your router,
and a resolver that owns port 53 can take the LAN offline while it is broken.
Keep SSH access and the undo steps in the install guide. Use at your own risk.

## What this fork is, and why it exists

This is a fork of [paimonsoror/telltaledns](https://github.com/paimonsoror/telltaledns). Upstream targets Docker, Kubernetes, and systemd hosts; routers have none of those. Many Merlin models, including the RT-AX95Q / ZenWiFi XT8, are 32-bit ARM with a small JFFS partition, and OpenWrt 25.12+ uses apk, not a conventional package manager. On these routers you need a static file or a native package, not an image.

This fork adds:

- **Static ARMv7 and ARM64 binaries** with the web UI compiled in: one file, no Entware, no shared libraries, no container.
- **Flash-friendly installs:** the Merlin bundle and the OpenWrt package keep the binary gzip-compressed (about 14 MB) and unpack it to RAM at start.
- **Router UI integration:** a **Services → TelltaleDNS** page in LuCI, and a **TelltaleDNS tab** under Network in the Merlin web UI.
- An **opkg/Entware feed** at `https://bongomanuk.github.io/telltaledns-merlin-openwrt/entware`, rebuilt by the [`merlin-feed`](.github/workflows/merlin-feed.yml) workflow.
- **OpenWrt 25.12+ apk packages** for armv7, aarch64 and x86_64 at `https://bongomanuk.github.io/telltaledns-merlin-openwrt/openwrt/`.
- A [`merlin-binaries`](.github/workflows/merlin-binaries.yml) workflow that builds and checksums the raw binaries.
- An [`upstream-watch`](.github/workflows/upstream-watch.yml) workflow that rebuilds the packages for each new upstream release.
- A [Merlin install guide](deploy/merlin/README.md) with the full model list, the port-53/dnsmasq conflict, the config, and a boot-time `/jffs/scripts/services-start` script.

The resolver source is upstream's. This fork adds only the router packaging.

## Install

### From the opkg feed (recommended, needs Entware)

If the router already runs [Entware](https://github.com/Entware/Entware) (usually installed with `amtm` on a USB drive), add the feed and install:

```sh
echo 'src/gz telltale https://bongomanuk.github.io/telltaledns-merlin-openwrt/entware' >> /opt/etc/opkg/customfeeds.conf
opkg update
opkg install telltale
```

The package installs the static binary to `/opt/sbin/telltale`, the config to `/opt/etc/telltale/telltale.toml` (a conffile), an init script at `/opt/etc/init.d/S99telltale`, and keeps its data and query log on the USB at `/opt/var/lib/telltale`, away from the router's flash.

Move dnsmasq's DNS to port 5354 so TelltaleDNS can take port 53, then start it:

```sh
grep -qx 'port=5354' /jffs/configs/dnsmasq.conf.add 2>/dev/null || echo 'port=5354' >> /jffs/configs/dnsmasq.conf.add
service restart_dnsmasq
/opt/etc/init.d/S99telltale start
```

TelltaleDNS forwards `home.lan`, `lan`, `router.asus.com` and `192.168.x` reverse lookups to dnsmasq on 5354, so the router's DHCP hostnames and local names keep working. It also reads `/var/lib/misc/dnsmasq.leases` for device names.

Then create the first admin and open the UI:

```sh
/opt/sbin/telltale auth setup-token -c /opt/etc/telltale/telltale.toml
# http://192.168.1.1:8053/
```

Update with `opkg update && opkg upgrade telltale`; remove with `/opt/etc/init.d/S99telltale stop && opkg remove telltale` (the config and data are kept). The feed is for Entware's `armv7-3.2` and `aarch64-3.10` repositories, and it is unsigned.

### Manually, without Entware

Download the **flash-friendly bundle** (`telltale-<version>-merlin-armv7.tar.gz` or `-aarch64`) from the release or the [Merlin bundles](https://bongomanuk.github.io/telltaledns-merlin-openwrt/merlin/), extract it on the router, and run `./install.sh`. The bundle keeps the binary gzip-compressed (about 14 MB on flash) and unpacks it to `/tmp` at start. The installer also puts `data_dir` (state database, query log, blocklists) on the first mounted USB volume, or on `/jffs/telltale/data` when there is none, and adds a **TelltaleDNS tab** under Network in the router's web UI by default (`--no-ui` skips it). The drive must be ext2/3/4 or NTFS; this firmware does not read exFAT. The raw binary is also in the release. [`deploy/merlin/README.md`](deploy/merlin/README.md) covers port 53, the first run, and the setup token.

### On OpenWrt 25.12+ (apk v3)

Current OpenWrt uses apk; the same build produces unsigned `.apk` packages for armv7, aarch64, x86_64 and x86 (i686). The package keeps the binary gzip-compressed (about 14 MB on flash), unpacks it to `/tmp` at start, and installs a UCI config at `/etc/config/telltale`. Install the one matching `apk --print-arch`:

```sh
apk add --allow-untrusted https://bongomanuk.github.io/telltaledns-merlin-openwrt/openwrt/telltale-<version>-<arch>.apk
```

Then move dnsmasq's DNS to 5354 (`uci set dhcp.@dnsmasq[0].port='5354'`, commit, restart dnsmasq) and start `/etc/init.d/telltale`. TelltaleDNS forwards `lan` and `192.168.x` reverse lookups to dnsmasq on 5354, so DHCP hostnames and `*.lan` keep working, and it reads `/tmp/dhcp.leases` for device names. Install `luci-app-telltale` too for the **Services → TelltaleDNS** page. [`deploy/openwrt/README.md`](deploy/openwrt/README.md) has the arch table, the exact port-53 steps, flash/data notes, and updates. OpenWrt 24.10 and older (opkg) is end of life and is not packaged.

## Supported ASUS Merlin routers

Your router's `uname -m` picks the binary. Run it on the router if you are unsure.

| `uname -m` | Binary | Routers |
|---|---|---|
| `armv7l` | `telltale-armv7-linux` | **RT-AX95Q / ZenWiFi XT8**, RT-AX58U / RT-AX58U v2 ★, RT-AX82U v1/v2 ★, RT-AX92U ★, RT-AX5400 ★, TUF-AX3000 v1/v2 ★, TUF-AX5400 v1 ★, DSL-AX82U / DSL-AX5400 ★, RT-AXE95Q / ZenWiFi ET8 ★, RT-BE58_GO, RT-BE92U, RT-AX56U (end of support) |
| `aarch64` | `telltale-aarch64-linux` | RT-AX86U / RT-AX86U Pro, RT-AX88U / RT-AX88U Pro, RT-AX68U, GT-AX11000 / GT-AX11000 Pro, GT-AXE11000, GT-AX6000, GT-AXE16000, ZenWiFi Pro XT12, RT-BE86U, RT-BE88U, RT-BE96U, GT-BE98 ★ / GT-BE98 Pro, GT-BE25000 ★, GT-BE19000AI, RT-AC86U (end of support), GT-AC2900 (end of support) |

★ = added by [GNUton's Merlin fork](https://gnuton.github.io/asuswrt-merlin.ng/); the rest are in the main Asuswrt-Merlin releases.

**Not supported:**

| Routers | Why |
|---|---|
| RT-N66U, RT-AC66U (original), RT-N16 | MIPS; there is no MIPS build |
| RT-AC56U, RT-AC66U B1, RT-AC68U, RT-AC87U, RT-AC3200, RT-AC88U, RT-AC3100, RT-AC5300 | 32-bit ARM, but the firmware runs Linux 2.6.36; this build needs Linux 3.2+ |
| anything not running Asuswrt-Merlin | the installer uses `/jffs/scripts`, which stock Asuswrt does not run reliably |

`armv7l` and `aarch64` are the only two `uname -m` answers that work. `uname -r` shows the kernel; if it starts with `2.6.36`, the binary will not run.

## The port 53 problem

The router's `dnsmasq` serves DHCP and DNS on port 53. TelltaleDNS needs port 53 to be the LAN resolver, so you have to choose:

- **Run it on the router (the feed/manual installs above):** keep dnsmasq for DHCP, but move its DNS to 5354 (`port=5354`) and let TelltaleDNS answer port 53. Local zones (`home.lan`, `lan`, `router.asus.com`, reverse) are forwarded to dnsmasq, and its lease file supplies the device names. While TelltaleDNS is down, clients using the router (192.168.1.1:53) have no DNS; keep an SSH session open and test before rebooting.
- **Run it on a separate host (a Pi):** leave the router alone and point the router's DHCP DNS at the Pi. This is the least risky option.
- **Keep dnsmasq and forward to TelltaleDNS on another port:** works, but every query reaches TelltaleDNS from the router, so per-device attribution is lost unless you use dnsmasq's `add-mac` and TelltaleDNS's `trust_edns_mac_from`.

## Builds and packages

- **Actions:** [all workflow runs](https://github.com/bongomanuk/telltaledns-merlin-openwrt/actions)
- **Releases:** [releases](https://github.com/bongomanuk/telltaledns-merlin-openwrt/releases) (raw binaries, Entware `.ipk`, OpenWrt `.apk`, `SHA256SUMS`)
- **Entware feed:** `https://bongomanuk.github.io/telltaledns-merlin-openwrt/entware`
- **OpenWrt packages:** `https://bongomanuk.github.io/telltaledns-merlin-openwrt/openwrt/`
- **Merlin bundles:** `https://bongomanuk.github.io/telltaledns-merlin-openwrt/merlin/`
- **Artifacts:** the `telltale-merlin-<run>` artifact on any `merlin-binaries` or `merlin-feed` run

## Build it yourself

- **Raw binaries:** Actions → **merlin-binaries** → *Run workflow* (or push a `v*` tag). The `telltale-merlin-<run>` artifact contains the three static binaries and `SHA256SUMS`.
- **The packages:** Actions → **merlin-feed** → *Run workflow* (or push a `v*` tag). It builds the binaries, makes the Entware `armv7-3.2`/`aarch64-3.10` packages, makes the OpenWrt 25.12 apk packages, writes the indexes, and deploys them to GitHub Pages.
- **Upstream tracking:** the [`upstream-watch`](.github/workflows/upstream-watch.yml) workflow runs daily. It merges `paimonsoror/telltaledns` `main` into this fork (keeping this fork's README, packaging and workflows on conflicts), then dispatches `merlin-feed` for the latest upstream release if this fork has not built it yet. The source stays current and every release gets packages and a GitHub release.
- **Locally:** the Entware scripts are in [`deploy/merlin/opkg/`](deploy/merlin/opkg/) and the OpenWrt scripts in [`deploy/openwrt/`](deploy/openwrt/); the builds use the project's usual `cargo zigbuild` targets.

## Documentation

This fork only changes packaging. The full documentation lives upstream:

| Read this | For |
|---|---|
| [Upstream README](https://github.com/paimonsoror/telltaledns#readme) | what TelltaleDNS is and what it does |
| [`docs/running.md`](https://github.com/paimonsoror/telltaledns/blob/main/docs/running.md) | native/Pi install, clusters, updates |
| [`docs/configuration.md`](https://github.com/paimonsoror/telltaledns/blob/main/docs/configuration.md) | every configuration key |
| [`docs/`](https://github.com/paimonsoror/telltaledns/tree/main/docs) | API, DNS, filtering, observability, security |
| [`spec/`](https://github.com/paimonsoror/telltaledns/tree/main/spec) | the build specification and decisions |
| [Project site](https://paimonsoror.github.io/telltaledns/) | FAQ, guides, release notes |
| [Upstream releases](https://github.com/paimonsoror/telltaledns/releases) | upstream binaries and images |
| [`deploy/merlin/`](deploy/merlin/README.md) | **this fork:** ASUS Merlin install, models, port 53, boot script |
| [`deploy/openwrt/`](deploy/openwrt/README.md) | **this fork:** OpenWrt 25.12+ apk packages, archs, port 53 |

## License

Apache-2.0 OR MIT, the same as upstream. See [LICENSE-APACHE](LICENSE-APACHE) and [LICENSE-MIT](LICENSE-MIT).

TelltaleDNS is by [paimonsoror](https://github.com/paimonsoror/telltaledns).
