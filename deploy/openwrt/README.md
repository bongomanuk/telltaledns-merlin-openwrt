# TelltaleDNS on OpenWrt

Static TelltaleDNS packages for **OpenWrt 25.12 and newer**, which uses **apk v3**.
OpenWrt 24.10 and older used opkg; that series is end of life, so this fork does not
build opkg packages for it. (ASUS Merlin users want the [Entware/opkg feed](../merlin/README.md)
instead.)

The packages are built by the [`merlin-feed`](../../.github/workflows/merlin-feed.yml)
workflow and published at:

```
https://bongomanuk.github.io/telltaledns-merlin-openwrt/openwrt/
```

They are unsigned, so install them with `--allow-untrusted`.

## Choose the package

The package arch must match `apk --print-arch` on the router:

| `apk --print-arch` | Binary | Typical targets |
|---|---|---|
| `aarch64_cortex-a53` | aarch64 | bcm27xx, mediatek/filogic, many arm64 boards |
| `aarch64_cortex-a72` | aarch64 | Raspberry Pi 4/5, ipq807x |
| `aarch64_generic` | aarch64 | armsr/armv8, generic arm64 VMs |
| `arm_cortex-a7_neon-vfpv4` | armv7 | ipq40xx and other Cortex-A7 boards |
| `arm_cortex-a15_neon-vfpv4` | armv7 | ipq806x |
| `x86_64` | x86_64 | x86/64 |

The binary itself is static, so no OpenWrt libraries are needed. If your arch is not
listed, take the package for the closest one and add `--arch <package-arch>` when
installing (or build it yourself with `build-apk.sh`).

## Install

```sh
# pick the file for: apk --print-arch
wget -O /tmp/telltale.apk 'https://bongomanuk.github.io/telltaledns-merlin-openwrt/openwrt/telltale-<version>-aarch64_cortex-a53.apk'
apk add --allow-untrusted /tmp/telltale.apk
```

The package installs:

| Path | What |
|---|---|
| `/usr/bin/telltale` | the static binary |
| `/etc/init.d/telltale` | procd init script |
| `/etc/telltale/telltale.toml` | starter config (a conffile; edits survive upgrades) |
| `/etc/telltale/data` | data and query log (created by the post-install script) |

## Free port 53 (read this first)

OpenWrt's `dnsmasq` serves DHCP and DNS. TelltaleDNS needs port 53, so keep dnsmasq
for DHCP but turn its DNS off:

```sh
uci set dhcp.@dnsmasq[0].port='0'
uci commit dhcp
/etc/init.d/dnsmasq restart
```

Keep an SSH session open: while dnsmasq's DNS is off, the LAN has no DNS unless
TelltaleDNS is running. To undo:

```sh
uci set dhcp.@dnsmasq[0].port='53'
uci commit dhcp
/etc/init.d/dnsmasq restart
```

## Start it

```sh
/etc/init.d/telltale enable
/etc/init.d/telltale start
```

Then create the first admin and open the UI:

```sh
/usr/bin/telltale auth setup-token -c /etc/telltale/telltale.toml
# http://<router>:8053/
```

Check that it is resolving:

```sh
nslookup example.com 127.0.0.1
```

## Data and flash

The starter config keeps its data in `/etc/telltale/data`, which is on the router's
flash. The query log is capped (`retention_bytes = "16MiB"`, `retention_days = 7`),
but for a long-lived setup move `data_dir` to a USB mount (for example
`/mnt/sda1/telltale`) and restart the service.

## Update and remove

```sh
# update: download the newer package and install it over the old one
apk add --allow-untrusted /tmp/telltale-<new-version>-<arch>.apk

# remove
/etc/init.d/telltale stop
/etc/init.d/telltale disable
apk del telltale
```

`apk del` keeps the conffile (`/etc/telltale/telltale.toml`); remove
`/etc/telltale/data` yourself if you also want to delete the query log and state.

## Notes

- The packages are unsigned. `apk add --allow-untrusted` is required.
- The service runs as root because it binds port 53.
- The web UI is plain HTTP on `:8053`; keep it on the LAN.
- New builds follow upstream releases: the [`upstream-watch`](../../.github/workflows/upstream-watch.yml)
  workflow dispatches a build for each new `paimonsoror/telltaledns` release.
- Build the package yourself with [`build-apk.sh`](build-apk.sh) and the OpenWrt 25.12
  SDK's `apk` tool; see that script for the exact metadata.
