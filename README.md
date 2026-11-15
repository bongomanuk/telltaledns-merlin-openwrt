# TelltaleDNS for ASUS Merlin and OpenWrt

[![merlin-binaries](https://github.com/bongomanuk/telltaledns-merlin-openwrt/actions/workflows/merlin-binaries.yml/badge.svg)](https://github.com/bongomanuk/telltaledns-merlin-openwrt/actions/workflows/merlin-binaries.yml)
[![merlin-feed](https://github.com/bongomanuk/telltaledns-merlin-openwrt/actions/workflows/merlin-feed.yml/badge.svg)](https://github.com/bongomanuk/telltaledns-merlin-openwrt/actions/workflows/merlin-feed.yml)
[![License: Apache-2.0 OR MIT](https://img.shields.io/badge/license-Apache--2.0%20OR%20MIT-blue.svg)](#license)

Static, self-contained builds of [TelltaleDNS](https://github.com/paimonsoror/telltaledns) for **ASUS Merlin (Asuswrt-Merlin) and OpenWrt routers** — one binary with the web UI embedded, no Docker and no systemd. The ASUS Merlin builds need no Entware to run; the OpenWrt builds are apk packages for OpenWrt 25.12+.

> **This fork is proudly not built by Claude.**

## What this fork is, and why it exists

This is a fork of [paimonsoror/telltaledns](https://github.com/paimonsoror/telltaledns). Upstream targets Docker, Kubernetes, and systemd hosts; routers have none of those. Many Merlin models — including the RT-AX95Q / ZenWiFi XT8 — are 32-bit ARM with a small JFFS partition, and OpenWrt 25.12+ uses apk, not a conventional package manager. On these routers you need a static file or a native package, not an image.

This fork adds exactly that:

- **Static ARMv7 and ARM64 binaries** with the web UI compiled in — one file, no Entware, no shared libraries, no container.
- An **opkg/Entware feed** at `https://bongomanuk.github.io/telltaledns-merlin-openwrt/entware`, rebuilt by the [`merlin-feed`](.github/workflows/merlin-feed.yml) workflow.
- **OpenWrt 25.12+ apk packages** for armv7, aarch64 and x86_64 at `https://bongomanuk.github.io/telltaledns-merlin-openwrt/openwrt/`.
- A [`merlin-binaries`](.github/workflows/merlin-binaries.yml) workflow that builds and checksums the raw binaries.
- An [`upstream-watch`](.github/workflows/upstream-watch.yml) workflow that rebuilds the packages for each new upstream release.
- A [Merlin install guide](deploy/merlin/README.md) with the full model list, the port-53/dnsmasq conflict, the config, and a boot-time `/jffs/scripts/services-start` script.

The resolver source is upstream's. This fork adds only the Merlin packaging.

## Install

### From the opkg feed (recommended, needs Entware)

If the router already runs [Entware](https://github.com/Entware/Entware) (usually installed with `amtm` on a USB drive), add the feed and install:

```sh
echo 'src/gz telltale https://bongomanuk.github.io/telltaledns-merlin-openwrt/entware' >> /opt/etc/opkg/customfeeds.conf
opkg update
opkg install telltale
```

The package installs the static binary to `/opt/sbin/telltale`, the config to `/opt/etc/telltale/telltale.toml` (a conffile), an init script at `/opt/etc/init.d/S99telltale`, and keeps its data and query log on the USB at `/opt/var/lib/telltale`, away from the router's flash.

`dnsmasq` still owns port 53. Free it before starting the service:

```sh
grep -qx 'port=0' /jffs/configs/dnsmasq.conf.add 2>/dev/null || echo 'port=0' >> /jffs/configs/dnsmasq.conf.add
service restart_dnsmasq
/opt/etc/init.d/S99telltale start
```

Then create the first admin and open the UI:

```sh
/opt/sbin/telltale auth setup-token -c /opt/etc/telltale/telltale.toml
# http://192.168.1.1:8053/
```

Update with `opkg update && opkg upgrade telltale`; remove with `/opt/etc/init.d/S99telltale stop && opkg remove telltale` (the config and data are kept). The feed is for Entware's `armv7-3.2` and `aarch64-3.10` repositories, and it is unsigned.

### Manually, without Entware

Download the binary from the [`merlin-binaries`](.github/workflows/merlin-binaries.yml) Actions run (or the release asset), copy it to `/jffs/telltale/telltale`, and follow [`deploy/merlin/README.md`](deploy/merlin/README.md) for the config, port 53, and the boot script.

### On OpenWrt 25.12+ (apk v3)

Current OpenWrt uses apk; the same build produces unsigned `.apk` packages for armv7, aarch64 and x86_64. Install the one matching `apk --print-arch`:

```sh
apk add --allow-untrusted https://bongomanuk.github.io/telltaledns-merlin-openwrt/openwrt/telltale-<version>-<arch>.apk
```

Then free port 53 from dnsmasq (`uci set dhcp.@dnsmasq[0].port='0'`, commit, restart dnsmasq) and start `/etc/init.d/telltale`. [`deploy/openwrt/README.md`](deploy/openwrt/README.md) has the arch table, the exact port-53 steps, flash/data notes, and updates. OpenWrt 24.10 and older (opkg) is end of life and is not packaged.

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

- **Run it on the router (the feed/manual installs above):** keep dnsmasq for DHCP but turn its DNS off with `port=0` (see the install step). While TelltaleDNS is down, the LAN has no DNS, so keep a way in and test before rebooting.
- **Run it on a separate host (a Pi):** leave the router alone and point the router's DHCP DNS at the Pi. This is the least risky option.
- **Keep dnsmasq and forward to TelltaleDNS on another port:** works, but every query reaches TelltaleDNS from the router, so per-device attribution is lost unless you use dnsmasq's `add-mac` and TelltaleDNS's `trust_edns_mac_from`.

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
