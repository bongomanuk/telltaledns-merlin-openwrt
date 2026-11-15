# TelltaleDNS on ASUS Merlin (Asuswrt-Merlin) routers

This fork publishes static ARM binaries for Asuswrt-Merlin routers. They are single
musl-linked files: no Entware, no extra libraries, no Docker. The web UI is compiled
into the binary.

The `merlin-binaries` GitHub Actions workflow builds them
(`.github/workflows/merlin-binaries.yml`). Run it from
**Actions → merlin-binaries → Run workflow**, or push a `v*` tag. The
`telltale-merlin-<run>` artifact contains:

| File | Use it on |
|---|---|
| `telltale-armv7-linux` | 32-bit ARM Merlin routers (including the RT-AX95Q / ZenWiFi XT8) |
| `telltale-aarch64-linux` | 64-bit ARM Merlin routers |
| `telltale-x86_64-linux` | a normal Linux PC, for testing |
| `SHA256SUMS` | checksums for the three files |

The same binaries are also published as an **Entware/opkg feed** by the
[`merlin-feed`](../.github/workflows/merlin-feed.yml) workflow:
`https://bongomanuk.github.io/telltaledns-merlin-openwrt/entware` (packages for `armv7-3.2` and
`aarch64-3.10`). See [Install from the opkg feed](#install-from-the-opkg-feed-recommended-needs-entware)
below.

## Which routers are supported

Check the router itself, because the CPU model is not the whole story (some 64-bit
SoCs run a 32-bit userland, and some newer "BE" models use 32-bit Broadcom SoCs):

```sh
uname -m
```

| `uname -m` | Binary |
|---|---|
| `armv7l` | `telltale-armv7-linux` |
| `aarch64` | `telltale-aarch64-linux` |

### `armv7l` — 32-bit ARM

| Merlin firmware | Routers |
|---|---|
| Asuswrt-Merlin | **RT-AX95Q / ZenWiFi XT8** (this fork's reference router), RT-AX58U, RT-BE58_GO, RT-BE92U, RT-AX56U (end of support) |
| GNUton's Merlin fork | RT-AX58U v2, RT-AX82U v1/v2, RT-AX92U, RT-AX5400, TUF-AX3000 v1/v2, TUF-AX5400 v1, DSL-AX82U, DSL-AX5400, RT-AXE95Q / ZenWiFi ET8 |

### `aarch64` — 64-bit ARM

| Merlin firmware | Routers |
|---|---|
| Asuswrt-Merlin | RT-AX86U, RT-AX86U Pro, RT-AX88U, RT-AX88U Pro, RT-AX68U, GT-AX11000, GT-AX11000 Pro, GT-AXE11000, GT-AX6000, GT-AXE16000, ZenWiFi Pro XT12, RT-BE86U, RT-BE88U, RT-BE96U, GT-BE19000AI, RT-AC86U (end of support), GT-AC2900 (end of support) |
| GNUton's Merlin fork | GT-BE98, GT-BE98 Pro, GT-BE25000 |

### Not supported

| Routers | Why |
|---|---|
| RT-N66U, RT-AC66U (original), RT-N16 | MIPS — there is no MIPS build |
| RT-AC56U, RT-AC66U B1, RT-AC68U, RT-AC87U, RT-AC3200, RT-AC88U, RT-AC3100, RT-AC5300 | 32-bit ARM, but the firmware runs Linux 2.6.36; this build needs Linux 3.2+ |
| anything not running Asuswrt-Merlin | the install below uses `/jffs/scripts`, which stock Asuswrt does not run reliably |

If your model is missing or you are unsure, use `uname -m`: `armv7l` and `aarch64`
are the only two answers that work. `uname -r` shows the kernel; if it starts with
`2.6.36`, the binary will not run.

Requirements:

- **Asuswrt-Merlin**, not stock Asuswrt. The installer below uses `/jffs/scripts`,
  which stock firmware does not run reliably.
- **JFFS custom scripts and configs** enabled:
  *Administration → System → Enable JFFS custom scripts and configs = Yes*.
- **SSH** enabled (*Administration → System → Enable SSH = LAN only*).
- Enough space in `/jffs` (or on a mounted USB drive). Check with `df -h /jffs`.
  The binary is about 30 MB; the query log grows over time, so either keep the
  retention short (see below) or put `data_dir` on a USB drive.

## The port 53 problem (read this first)

The router's `dnsmasq` owns UDP/TCP port 53 and also runs DHCP. TelltaleDNS needs
port 53 to be your LAN resolver. You have three choices:

**A. Replace dnsmasq's DNS with TelltaleDNS (runs on the router, recommended if you
want it on the router).** Keep dnsmasq for DHCP, but turn its DNS off with
`port=0`. TelltaleDNS then binds port 53. This is the method below.

**B. Keep dnsmasq and forward to TelltaleDNS on another port.** TelltaleDNS loses
per-device attribution, because every query now arrives from the router. It can be
made to work with dnsmasq's `add-mac` and TelltaleDNS's `[clients]
trust_edns_mac_from`, but that is a more advanced setup.

**C. Run TelltaleDNS on a separate Raspberry Pi** and leave the router alone. This
is the least risky option overall; point the router's DHCP DNS at the Pi.

> **Warning for option A:** while dnsmasq's DNS is off, the LAN has no DNS unless
> TelltaleDNS is running. Keep an SSH session open (to the router's IP) while you
> test, so you can undo it if TelltaleDNS does not start. To undo, remove the
> `port=0` line and run `service restart_dnsmasq`.

## Install from the opkg feed (recommended, needs Entware)

If Entware is already installed (typically by `amtm` on a USB drive), this is the
cleanest route: the binary goes to `/opt`, the data and query log stay on the USB
drive, and updates come through `opkg`.

Add the feed once and install:

```sh
echo 'src/gz telltale https://bongomanuk.github.io/telltaledns-merlin-openwrt/entware' >> /opt/etc/opkg/customfeeds.conf
opkg update
opkg install telltale
```

The package installs:

| Path | What |
|---|---|
| `/opt/sbin/telltale` | the static binary |
| `/opt/etc/telltale/telltale.toml` | starter config (a conffile, so your edits survive upgrades) |
| `/opt/etc/init.d/S99telltale` | Entware start/stop script |
| `/opt/var/lib/telltale` | data and query log (created by `postinst`) |

`dnsmasq` still owns port 53. Free it **before** starting the service (and keep an
SSH session open; see the warning above):

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

Update and remove:

```sh
opkg update && opkg upgrade telltale
# ...
/opt/etc/init.d/S99telltale stop
opkg remove telltale        # config and data are kept
```

The feed is unsigned, and it carries only `armv7-3.2` and `aarch64-3.10` packages.
If `opkg` says the architecture is unsupported, your Entware is on the old 2.6.36
feed; this build cannot run on that kernel anyway.

## Manual install (no Entware)

Use this if you do not want Entware. The examples use `admin@192.168.1.1`; use your
router's address and login name.

### 1. Get the binary onto the router

Download the `telltale-merlin-<run>.zip` artifact from the workflow run (or the
release asset, if you built a `v*` tag) on your computer, unzip it, and check the
checksums:

```sh
unzip telltale-merlin-*.zip
sha256sum -c SHA256SUMS
```

Pick the file for `uname -m` (above), then copy it to the router:

```sh
ssh admin@192.168.1.1 'mkdir -p /jffs/telltale'
scp telltale-armv7-linux admin@192.168.1.1:/jffs/telltale/telltale
ssh admin@192.168.1.1 'chmod +x /jffs/telltale/telltale && /jffs/telltale/telltale --version'
```

No `scp`? Either copy the file to a USB stick, mount it on the router, and `cp` it:

```sh
cp /tmp/mnt/<usb-label>/telltale-armv7-linux /jffs/telltale/telltale
```

or download it on the router from a URL you control:

```sh
wget -O /jffs/telltale/telltale 'http://<your-host>/telltale-armv7-linux'
chmod +x /jffs/telltale/telltale
sha256sum /jffs/telltale/telltale    # compare with SHA256SUMS
```

### 2. Write the config

`/jffs/telltale/telltale.toml`:

```toml
config_version = 1

[node]
# On the router's flash. Use e.g. /tmp/mnt/<usb-label>/telltale for a USB drive.
data_dir = "/jffs/telltale/data"

# The web UI and API (the UI is embedded in the binary).
[api]
listen = "0.0.0.0:8053"

# Encrypted (DNS over TLS) upstreams; the Mozilla roots are built into the binary,
# so no CA bundle is needed on the router.
[[upstream]]
name = "cloudflare"
url = "tls://1.1.1.1:853"
tls_server_name = "cloudflare-dns.com"

[[upstream]]
name = "quad9"
url = "tls://9.9.9.9:853"
tls_server_name = "dns.quad9.net"

[[upstream_group]]
name = "default"
members = ["cloudflare", "quad9"]
strategy = "fastest"

# Optional: keep the query log small and reduce flash writes.
[telemetry.qlog]
retention_days = 7
# enabled = false          # no query log at all (dashboard history is then empty)
# fsync = false            # fewer flash syncs (default is false)
```

The default DNS listeners are UDP and TCP on port 53, IPv4 and IPv6. If IPv6 is
disabled on the router and TelltaleDNS complains about binding `[::]:53`, replace
that default with explicit IPv4 listeners:

```toml
[[listen]]
proto = "udp"
addr = "0.0.0.0:53"

[[listen]]
proto = "tcp"
addr = "0.0.0.0:53"
```

Check the file before starting:

```sh
/jffs/telltale/telltale config check /jffs/telltale/telltale.toml
```

### 3. Free port 53 (option A)

```sh
mkdir -p /jffs/configs
grep -qx 'port=0' /jffs/configs/dnsmasq.conf.add 2>/dev/null || echo 'port=0' >> /jffs/configs/dnsmasq.conf.add
service restart_dnsmasq
```

`port=0` disables dnsmasq's DNS server but keeps DHCP running.

### 4. First run and the admin account

Run it in the foreground first, so you can see the log:

```sh
/jffs/telltale/telltale run -c /jffs/telltale/telltale.toml
```

While it is running, in another SSH session, print the one-time setup token:

```sh
/jffs/telltale/telltale auth setup-token -c /jffs/telltale/telltale.toml
```

Open `http://192.168.1.1:8053/`, enter the token, and create the first admin. (You
can also create the first admin from `TELLTALE_BOOTSTRAP_ADMIN_USER` and
`TELLTALE_BOOTSTRAP_ADMIN_PASSWORD`; see `docs/running.md`.)

Once the UI works and clients resolve, stop the foreground process with `Ctrl-C`.

### 5. Start it at boot

Create `/jffs/scripts/services-start` (with Unix line endings) and make it
executable:

```sh
#!/bin/sh
# TelltaleDNS
if [ -x /jffs/telltale/telltale ]; then
    /jffs/telltale/telltale run -c /jffs/telltale/telltale.toml \
        >>/jffs/telltale/telltale.log 2>&1 &
fi
```

```sh
chmod +x /jffs/scripts/services-start
```

The log file grows; use `/tmp/telltale.log` if you would rather keep it in RAM.
Start it now without rebooting:

```sh
/jffs/scripts/services-start
```

### 6. Test

```sh
nslookup example.com 192.168.1.1
```

Then point a client (or the router's DHCP DNS setting) at the router and check
**Clients** and **Queries** in the web UI. DHCP still comes from dnsmasq, so leases
and reservations are unchanged.

## Updating and uninstalling

**opkg install:**

```sh
opkg update && opkg upgrade telltale
# remove (config and data are kept):
/opt/etc/init.d/S99telltale stop
opkg remove telltale
```

**Manual install:** download the new binary, `killall telltale`, replace
`/jffs/telltale/telltale`, and run `/jffs/scripts/services-start` again. Keep the
config and `data/` directory. `telltale self-update` is not wired to this fork's
builds (and they are unsigned), so update manually.

**Manual uninstall:**

```sh
killall telltale
rm -f /jffs/scripts/services-start
rm -rf /jffs/telltale
# restore dnsmasq's DNS:
sed -i '/^port=0$/d' /jffs/configs/dnsmasq.conf.add
service restart_dnsmasq
```

## Notes and limits

- Runs as root because it binds port 53; the router's boot scripts are root anyway.
- About 15 MB idle memory; blocklists are held in a compact in-memory index.
- Writing the query log to `/jffs` wears the router's flash. Keep
  `retention_days` low, set `enabled = false`, or put `data_dir` on a USB drive.
- The web UI is plain HTTP on `:8053`. It is LAN-only unless you expose it; do not
  forward that port from the WAN.
- These binaries are this fork's own builds. They are not minisign-signed like the
  upstream releases, so `self-update` will refuse them; that is expected.
