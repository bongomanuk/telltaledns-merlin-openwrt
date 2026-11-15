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
| `arm_cortex-a7_neon-vfpv4` | armv7 | ipq40xx, sunxi, imx and other Cortex-A7 boards |
| `arm_cortex-a15_neon-vfpv4` | armv7 | ipq806x |
| `arm_cortex-a9_neon` | armv7 | mvebu |
| `arm_cortex-a9_vfpv3-d16` | armv7 | mvebu (VFPv3-D16) |
| `arm_cortex-a5_vfpv4` | armv7 | Cortex-A5 boards |
| `aarch64_cortex-a35` | aarch64 | newer low-power arm64 boards |
| `aarch64_cortex-a53` | aarch64 | bcm27xx, mediatek/filogic, qualcommax, rockchip, many arm64 boards |
| `aarch64_cortex-a55` | aarch64 | newer arm64 boards |
| `aarch64_cortex-a72` | aarch64 | Raspberry Pi 4/5, ipq807x |
| `aarch64_cortex-a76` | aarch64 | newer arm64 boards |
| `aarch64_generic` | aarch64 | armsr/armv8, generic arm64 VMs |
| `i386_pentium4` | i686 | x86/generic (32-bit) |
| `x86_64` | x86_64 | x86/64 |

The binary itself is static, so no OpenWrt libraries are needed. If your arch is not
listed, take the package for the closest one and add `--arch <package-arch>` when
installing (or build it yourself with `build-apk.sh`).

Not built: `mipsel`/`mips` and `riscv64` (the TLS stack, ring, has no backend for
them), and ARMv6 (not supported upstream). ASUS Merlin is armv7/aarch64 only; the
old MIPS and 2.6.36 models are end of life and cannot run this build.

## Install

```sh
# pick the file for: apk --print-arch
wget -O /tmp/telltale.apk 'https://bongomanuk.github.io/telltaledns-merlin-openwrt/openwrt/telltale-<version>-aarch64_cortex-a53.apk'
apk add --allow-untrusted /tmp/telltale.apk
```

The package installs:

| Path | What |
|---|---|
| `/usr/bin/telltale` | a launcher that unpacks the binary into `/tmp` and runs it |
| `/usr/lib/telltale/telltale.gz` | the gzip-compressed binary (about 14 MB on flash, 28 MB unpacked) |
| `/etc/init.d/telltale` | procd init script; reads `/etc/config/telltale` |
| `/etc/config/telltale` | UCI enable switch and config path (a conffile) |
| `/etc/telltale/telltale.toml` | the TOML config (a conffile; edits survive upgrades) |
| `/tmp/telltale-data` | data and query log (RAM; point `data_dir` at a USB mount to keep them) |

The launcher unpacks the binary into `/tmp` (RAM) at start, so the package uses
about 14 MB of flash instead of 28 MB.

## Keep dnsmasq on port 53

OpenWrt's `dnsmasq` serves DHCP and DNS. Leave it on port 53 and point it at
TelltaleDNS, which listens on `127.0.0.1:5354`:

```sh
uci set dhcp.@dnsmasq[0].noresolv='1'
uci set dhcp.@dnsmasq[0].strictorder='1'
# client MAC in the query, so device rules keep working (--add-mac)
uci set dhcp.@dnsmasq[0].addmac='1'
uci -q delete dhcp.@dnsmasq[0].server
uci add_list dhcp.@dnsmasq[0].server='127.0.0.1#5354'
uci add_list dhcp.@dnsmasq[0].server='9.9.9.9'
uci add_list dhcp.@dnsmasq[0].server='1.1.1.1'
uci commit dhcp
/etc/init.d/dnsmasq restart
```

dnsmasq keeps port 53, DHCP, `*.lan` and the router's own names. Public queries go
to TelltaleDNS first; `strictorder` makes dnsmasq use the plain servers only when
it does not answer. `addmac` carries the client MAC, so per-device rules and
statistics still work, and the lease file supplies the device names. If your
dnsmasq has no `addmac` option, add `add-mac` to its configuration instead.

To undo, delete the `server` list and set `noresolv` back to `0`, then restart
dnsmasq.

### Flash wear

Nothing is written to the router's flash while it runs. The install writes the compressed
binary and the two config files once. The database, query log and blocklists default to
`/tmp/telltale-data`, which is RAM and is lost on reboot; set `data_dir` to a mounted USB
drive to keep them. The router's own syslog is a firmware setting and is outside this app.

## Start it

The UCI config is `/etc/config/telltale`:

```sh
uci set telltale.main.enabled='1'
uci set telltale.main.config='/etc/telltale/telltale.toml'
uci commit telltale
/etc/init.d/telltale enable
/etc/init.d/telltale start
```

`telltale.main.enabled='0'` stops procd from starting it at boot; the TOML file
remains the resolver's own configuration.

Then create the first admin and open the UI:

```sh
/usr/bin/telltale auth setup-token -c /etc/telltale/telltale.toml
# http://<router>:8053/
```

Check that it is resolving:

```sh
nslookup example.com 127.0.0.1
```

## LuCI page

Install the small noarch app as well:

```sh
apk add --allow-untrusted ./luci-app-telltale-<version>.apk
```

Then open **Services → TelltaleDNS**. The page shows whether the resolver is
running, gives Start / Stop / Restart buttons, and links to the full dashboard at
`http://<router>:8053/`. It uses `/etc/init.d/telltale` for the actions and
`/etc/config/telltale` for the enabled state; enable or disable it at boot in
**System → Startup**.

The app depends on `luci-base` and `telltale`, and the same `noarch` package works
on every architecture.

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

`apk del` keeps the conffiles (`/etc/telltale/telltale.toml` and
`/etc/config/telltale`); remove `/etc/telltale/data` yourself if you also want to
delete the query log and state.

## Notes

- The packages are unsigned. `apk add --allow-untrusted` is required.
- The service runs as root because it binds port 53.
- The web UI is plain HTTP on `:8053`; keep it on the LAN.
- New builds follow upstream releases: the [`upstream-watch`](../../.github/workflows/upstream-watch.yml)
  workflow dispatches a build for each new `paimonsoror/telltaledns` release.
- Build the package yourself with [`build-apk.sh`](build-apk.sh) and the OpenWrt 25.12
  SDK's `apk` tool; see that script for the exact metadata.
