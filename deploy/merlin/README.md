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

### `armv7l` (32-bit ARM)

| Merlin firmware | Routers |
|---|---|
| Asuswrt-Merlin | **RT-AX95Q / ZenWiFi XT8** (this fork's reference router), RT-AX58U, RT-BE58_GO, RT-BE92U, RT-AX56U (end of support) |
| GNUton's Merlin fork | RT-AX58U v2, RT-AX82U v1/v2, RT-AX92U, RT-AX5400, TUF-AX3000 v1/v2, TUF-AX5400 v1, DSL-AX82U, DSL-AX5400, RT-AXE95Q / ZenWiFi ET8 |

### `aarch64` (64-bit ARM)

| Merlin firmware | Routers |
|---|---|
| Asuswrt-Merlin | RT-AX86U, RT-AX86U Pro, RT-AX88U, RT-AX88U Pro, RT-AX68U, GT-AX11000, GT-AX11000 Pro, GT-AXE11000, GT-AX6000, GT-AXE16000, ZenWiFi Pro XT12, RT-BE86U, RT-BE88U, RT-BE96U, GT-BE19000AI, RT-AC86U (end of support), GT-AC2900 (end of support) |
| GNUton's Merlin fork | GT-BE98, GT-BE98 Pro, GT-BE25000 |

### Not supported

| Routers | Why |
|---|---|
| RT-N66U, RT-AC66U (original), RT-N16 | MIPS; there is no MIPS build |
| RT-AC56U, RT-AC66U B1, RT-AC68U, RT-AC87U, RT-AC3200, RT-AC88U, RT-AC3100, RT-AC5300 | 32-bit ARM, but the firmware runs Linux 2.6.36; this build needs Linux 3.2+ |
| anything not running Asuswrt-Merlin | the install below uses `/jffs/scripts`, which stock Asuswrt does not run reliably |

If your model is missing or you are unsure, use `uname -m`: `armv7l` and `aarch64`
are the only two answers that work. `uname -r` shows the kernel; if it starts with
`2.6.36`, the binary will not run.

## No guarantee

These are this fork's own builds. There is no guarantee that they work on your
router, that they survive a firmware update, or that they are free of bugs. A
resolver that owns port 53 can take the whole LAN offline while it is broken.
Keep an SSH session open, know the undo steps, and do not install this on a
router you cannot reach physically.

Requirements:

- **Asuswrt-Merlin**, not stock Asuswrt. The installer below uses `/jffs/scripts`,
  which stock firmware does not run reliably.
- **JFFS custom scripts and configs** enabled:
  *Administration → System → Enable JFFS custom scripts and configs = Yes*.
- **SSH** enabled (*Administration → System → Enable SSH = LAN only*).
- Enough space in `/jffs` (or on a mounted USB drive). Check with `df -h /jffs`.
  The binary is about 30 MB; the query log writes constantly, so a USB drive is
  the better home for `data_dir` (see below).

## Where the traffic goes

The router's dnsmasq runs DHCP and DNS, and keeps port 53. TelltaleDNS listens on
`127.0.0.1:5354`, where only dnsmasq can reach it.

1. A device asks the router (`192.168.1.1:53`).
2. dnsmasq answers its own names itself: DHCP hostnames, `home.lan`, `router.asus.com`.
3. Anything else is forwarded to TelltaleDNS on `127.0.0.1:5354`, with the device's MAC
   address added by dnsmasq (`add-mac`).
4. TelltaleDNS filters the name and resolves it over DNS over TLS.
5. If TelltaleDNS is not running, dnsmasq sends the query to `9.9.9.9` or `1.1.1.1`, so
   the LAN keeps working.

TelltaleDNS reads the MAC from the forwarded query and looks it up in the dnsmasq lease
file (`[clients] trust_edns_mac_from`), so per-device rules and statistics see the device,
not the router. Without `add-mac` every query would look like it came from the router.

The installer writes those dnsmasq lines and restarts dnsmasq. It is idempotent and
removes a `port=5354` line left by an older setup. Pass `--no-dns` to leave dnsmasq alone.

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

Point dnsmasq at it, then start the service:

```sh
add=/jffs/configs/dnsmasq.conf.add
touch "$add"
for line in no-resolv strict-order add-mac 'server=127.0.0.1#5354' 'server=9.9.9.9' 'server=1.1.1.1'; do
    grep -qx "$line" "$add" || echo "$line" >> "$add"
done
service restart_dnsmasq
/opt/etc/init.d/S99telltale start
```

The starter config listens on `127.0.0.1:5354` and reads
`/var/lib/misc/dnsmasq.leases` for device names. dnsmasq keeps port 53 and its
local names; if TelltaleDNS is down, dnsmasq falls back to `9.9.9.9` and
`1.1.1.1`.

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

## Flash-friendly bundle (recommended without Entware)

The raw binary is about 28 MB. On a 47 MB JFFS partition that leaves little room
for the query log and updates. The release also ships a bundle with the binary
gzip-compressed to about 14 MB and a small launcher that unpacks it into `/tmp`
at start:

```sh
cd /tmp
tar xzf telltale-<version>-merlin-armv7.tar.gz
cd telltale-<version>-merlin-armv7
./install.sh
```

The installer:

- checks `uname -m` and accepts only `armv7l` and `aarch64`;
- installs `/jffs/telltale/telltale.gz`, a `/jffs/telltale/telltale` launcher, and the config, keeping a timestamped backup of an existing config;
- puts `data_dir` on the first mounted USB volume, inside a small ext4 image (`<volume>/telltale.ext4`, mounted at `/tmp/mnt/telltale`). The image keeps SQLite off Asus's NTFS driver, which hangs under database load; the drive only sees one large file. With no USB volume it uses `/tmp/telltale-data`, which is RAM, so nothing is written to the router's flash at runtime. Re-run the installer after plugging a drive in;
- waits up to a minute for that volume at boot, then uses `/tmp/telltale-data` if it never appears;
- appends a `# telltale` block to `/jffs/scripts/services-start` without overwriting other entries;
- prints the next steps. It does not change dnsmasq or start the service.

The USB drive must be a filesystem the router can mount. Asuswrt-Merlin 388 reads
ext2/ext3/ext4 and NTFS; it does not read exFAT. Check the mount with `df -h`
before running the installer.

By default it also adds a **TelltaleDNS entry** to the router's main menu.
Asuswrt has no add-on menu API: the installer copies a small page into
`/www/user` and bind-mounts a patched `menuTree.js`. `/www` is rebuilt at boot and
after a firmware update, and the `services-start` hook re-applies the tab. Pass
`--no-ui` to skip it, or remove it later with:

```sh
/jffs/telltale/ui.sh remove
```

The tab opens `http://<router>:8053/`; the dashboard works with or without it.

The bundle config uses two UDP workers, a 16 MiB response cache, a 2 MB blocklist,
and a 4 MiB query log. The binary is unpacked to `/tmp` (RAM) at start, so the
install takes about 20 MB of the JFFS partition instead of about 34 MB.

The installer also points dnsmasq at TelltaleDNS and restarts it (`--no-dns`
skips that).

### DNS protection

Settings, Router has a **DNS protection** switch. It redirects every LAN client's UDP and
TCP port 53 to dnsmasq, refuses DoT on port 853, and blocks the usual DoH hostnames
(`dns.google`, `mozilla.cloudflare-dns.com`, and similar) by name. The rules live in
`/jffs/telltale/dns-guard.sh`, are called from `/jffs/scripts/firewall-start`, and are
re-applied at every firewall restart, so they survive a reboot. It is the answer to a TV or
console that ignores DHCP DNS and asks 8.8.8.8 directly.

### The database and the USB drive

SQLite does not belong on Asus's NTFS driver: it can hang the kernel under load, with ping
still answering and SSH and the web UI frozen. The installer keeps the database in a 2 GB
ext4 image on the volume (`<volume>/telltale.ext4`, mounted at `/tmp/mnt/telltale`), so
`tntfs` only handles one large file. Turn the DLNA server off (`nvram set dms_enable=0`) if
you do not use it, because it indexes the whole volume at boot. If hangs continue with the
image in place, try the other USB port or another drive.

### Flash wear

The installer writes about 16 MB to `/jffs` once: the compressed binary, the config, the
web UI page and the boot hook. After that the process writes only to `data_dir`: the
database, the query log and the blocklists. On a USB drive that is the stick. With no USB
drive it is `/tmp/telltale-data`, which is RAM, and it is lost on reboot. The router's own
syslog (`/jffs/syslog.log`) is a firmware setting; turn it off under
Administration, System if you want to cut that down too.

Then follow steps 3 and 4 of the manual install below for the first run and the setup
token.

## Manual install (no Entware)

Use this if you do not want Entware, or want to control every file yourself. The examples use `admin@192.168.1.1`; use your router's address and login name.

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
# The database, query log and blocklists. Point this at a USB drive
# (/tmp/mnt/<label>/telltale/data). /tmp is RAM: nothing persists, and the
# router's flash is never written.
data_dir = "/tmp/telltale-data"

# The web UI and API (the UI is embedded in the binary).
[api]
listen = "0.0.0.0:8053"

# Only dnsmasq talks to this listener; dnsmasq keeps port 53 for the LAN.
[[listen]]
proto = "udp"
addr = "127.0.0.1:5354"

[[listen]]
proto = "tcp"
addr = "127.0.0.1:5354"

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

# Device names from the router's DHCP leases.
[[router]]
name = "dnsmasq"
type = "dnsmasq"
url = "file:///var/lib/misc/dnsmasq.leases"
interval_secs = 60

# Device names from dnsmasq's EDNS MAC option (dnsmasq needs `add-mac`).
[clients]
neighbor_table = true
trust_edns_mac_from = ["127.0.0.1/32"]

# Optional: keep the query log small and reduce flash writes.
[telemetry.qlog]
retention_days = 7
# enabled = false          # no query log at all (dashboard history is then empty)
# fsync = false            # fewer flash syncs (default is false)
```

The `[[listen]]` entries above keep TelltaleDNS on loopback port 5354, behind
dnsmasq. Do not change them to port 53 unless you also move dnsmasq off 53.

Check the file before starting:

```sh
/jffs/telltale/telltale config check /jffs/telltale/telltale.toml
```

### 3. Point dnsmasq at TelltaleDNS

```sh
mkdir -p /jffs/configs
add=/jffs/configs/dnsmasq.conf.add
touch "$add"
for line in no-resolv strict-order add-mac 'server=127.0.0.1#5354' 'server=9.9.9.9' 'server=1.1.1.1'; do
    grep -qx "$line" "$add" || echo "$line" >> "$add"
done
service restart_dnsmasq
```

dnsmasq keeps port 53, DHCP and the local names. Public queries go to
TelltaleDNS first; the plain servers answer when it is down. Remove those lines
and restart dnsmasq to go back to the firmware's DNS.

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
        >>/tmp/telltale.log 2>&1 &
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
# stop using TelltaleDNS for public queries:
sed -i '/^no-resolv$/d;/^strict-order$/d;/^add-mac$/d;/^server=127.0.0.1#5354$/d' /jffs/configs/dnsmasq.conf.add
service restart_dnsmasq
```

## Notes and limits

- dnsmasq stays on port 53 and owns DHCP; TelltaleDNS listens on loopback 5354.
- About 15 MB idle memory; blocklists are held in a compact in-memory index.
- Nothing is written to the router's flash while it runs: `data_dir` is on the USB
  drive, or in `/tmp` (RAM) without one. Install writes the compressed binary, the config
  and the boot hook once.
- The web UI is plain HTTP on `:8053`. It is LAN-only unless you expose it; do not
  forward that port from the WAN.
- These binaries are this fork's own builds. They are not minisign-signed like the
  upstream releases, so `self-update` will refuse them; that is expected.
