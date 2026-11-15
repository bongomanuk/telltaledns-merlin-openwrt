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

## Which routers are supported

Check the router itself, because the CPU model is not the whole story (some 64-bit
SoCs run a 32-bit userland):

```sh
uname -m
```

| `uname -m` | Binary | Typical Merlin models |
|---|---|---|
| `armv7l` | `telltale-armv7-linux` | **RT-AX95Q / ZenWiFi XT8**, RT-AX58U, RT-AX82U, RT-AX92U, TUF-AX3000, TUF-AX5400 |
| `aarch64` | `telltale-aarch64-linux` | RT-AX86U, RT-AX88U, GT-AX11000, RT-AX68U, GT-AX6000, GT-AXE11000, RT-AX89X, ZenWiFi Pro XT12, GT-BE98 |

If your model is not listed, run `uname -m` and use the matching binary. If it prints
anything else (`mips`, `armv6l`, ...) there is no build for it — older MIPS routers
(RT-N66U, the original RT-AC66U) are **not supported**.

Requirements:

- **Asuswrt-Merlin**, not stock Asuswrt. The installer below uses `/jffs/scripts`,
  which stock firmware does not run reliably.
- **JFFS custom scripts and configs** enabled:
  *Administration → System → Enable JFFS custom scripts and configs = Yes*.
- **SSH** enabled (*Administration → System → Enable SSH = LAN only*).
- Enough space in `/jffs` (or on a mounted USB drive). Check with `df -h /jffs`.
  The binary is about 15 MB; the query log grows over time, so either keep the
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

## Install (option A, on the router)

The examples use `admin@192.168.1.1`; use your router's address and login name.

### 1. Copy the binary

Download the workflow artifact (or the release asset if you built a tag) on your
computer, unzip it, then copy the right file to the router:

```sh
unzip telltale-merlin-*.zip
ssh admin@192.168.1.1 'mkdir -p /jffs/telltale'
scp telltale-armv7-linux admin@192.168.1.1:/jffs/telltale/telltale
ssh admin@192.168.1.1 'chmod +x /jffs/telltale/telltale && /jffs/telltale/telltale --version'
```

If `scp` is not available on the router, copy the file to a USB stick and `cp` it,
or use `wget` on the router from a URL you control. Verify it with
`sha256sum /jffs/telltale/telltale` against `SHA256SUMS`.

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

**Update:** download the new binary, `killall telltale`, replace
`/jffs/telltale/telltale`, and run `/jffs/scripts/services-start` again. Keep the
config and `data/` directory. `telltale self-update` is not wired to this fork's
builds (and they are unsigned), so update manually.

**Uninstall:**

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
