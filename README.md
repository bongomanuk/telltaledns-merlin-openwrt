# TelltaleDNS

[![CI](https://github.com/paimonsoror/telltaledns/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/paimonsoror/telltaledns/actions/workflows/ci.yml?query=branch%3Amain)
[![Release](https://img.shields.io/github/v/release/paimonsoror/telltaledns?sort=semver)](https://github.com/paimonsoror/telltaledns/releases/latest)
[![License: Apache-2.0 OR MIT](https://img.shields.io/badge/license-Apache--2.0%20OR%20MIT-blue.svg)](#license)
[![Dependabot](https://img.shields.io/badge/dependabot-enabled-025e8c?logo=dependabot)](https://github.com/paimonsoror/telltaledns/pulls?q=is%3Apr+author%3Aapp%2Fdependabot)

**See every question. Answer on your terms.**

> **This fork is proudly not built by Claude.** The Merlin support here — the static ARM builds, the `merlin-binaries` workflow, and the install guide — is not. See [Not built with Claude](#not-built-with-claude).

Every connection on your network starts with a DNS lookup. TelltaleDNS answers it in microseconds, filters it by your rules per device, and shows you exactly who asked, what they asked, and why it answered the way it did. It runs on a Raspberry Pi, in Kubernetes, or on both as one cluster that keeps answering even when parts of it fail.

> A *telltale* is the strip of yarn sailors tie to a sail to see what the wind is really doing. DNS is your network's telltale: it reveals what every device is up to.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/dashboard-dark.jpg">
    <img alt="The TelltaleDNS dashboard: queries, blocked share, cache hits, upstream latency, and active clients; queries by status over 15 minutes and answers by status; and the top domains, blocked names, and devices with their groups" src="docs/images/dashboard-light.jpg" width="900">
  </picture>
  <br>
  <sub>The dashboard on a demo network. Every device, name, and address in it is made up.</sub>
</p>

## Mission
Give everyone who runs a home or small network an honest, real-time view of what their devices are doing, and full control over it, without trading away speed, footprint, or reliability.

- **See:** every query is attributed to a device, explained, and timed per stage.
- **Decide:** your rules per device and group, enforced instantly at no performance cost.
- **Never fail:** DNS keeps answering from its last good config, whatever happens to the control plane.
- **Run anywhere:** the same artifact on a Pi, in a cluster, or both at once.

## What it does
- **Every answer explained.** The query log ties each query to a named device, times every stage, and says why it was answered that way. Names come from your router, from what devices announce over mDNS, or from the UI, and TelltaleDNS recognizes what each device is (a Roku player, a camera, a thermostat) from its maker and the names it asks for.
- **Your rules, per device.** Blocklists, groups for each network or VLAN, schedules, safe search, blocked services, rewrites, and quick rules. Before you save a change, see what it would have done to yesterday's real traffic.
- **Encrypted both ways.** DoT, DoH, and DoQ for your devices and to your upstreams, DNSSEC validation, and full recursion when you'd rather not forward at all.
- **Watch it work.** A dashboard for the whole cluster, one node, or one site. A heatmap of when your network asks, a flow from each group to its answers, answer times as a heatmap, every change marked on every chart, and which devices and names spent the error budget. Compare nodes side by side, see a device's rhythm and its day, and put it all on a wall display. Device anomalies and alerts; Prometheus metrics, OpenTelemetry, dnstap, and event sinks for your SIEM.
- **One cluster, many places.** A Pi and Kubernetes nodes share one config and one management plane. A witness lets a replica take over automatically, and the config can live in Git. Changes can reach a few canary nodes first and roll back by themselves if those start failing, and maintenance mode takes a node out of service without dropped queries or false alarms.
- **Private by design.** Privacy levels decide how much of each query is kept, from everything to counters only, and every change lands in an audit log.
- **Ready for agents.** A documented REST API with OpenAPI, `telltale ctl` for the shell, and MCP tools with plans and approval for AI agents.
- **Small and fast.** One static binary in an image of about 13 MiB, for amd64, arm64, and 32-bit Pi OS. It idles at about 14 MiB of memory, holds a million blocked names in 60 MiB, and sends 99.999 % of cached and blocked answers within 250 µs of the query arriving, under load from another machine ([measurements](docs/v1-gate.md)).
- **Verifiable.** Images are signed with cosign, each release binary carries its dependency list and an SBOM, and two builds of the same commit are identical ([how to check](docs/running.md#versions-and-updates)).

## Quick start
On a Raspberry Pi or any Linux host with Docker:
```sh
mkdir telltale && cd telltale
curl -fsSLO https://raw.githubusercontent.com/paimonsoror/telltaledns/main/deploy/compose/compose.yaml
curl -fsSLO https://raw.githubusercontent.com/paimonsoror/telltaledns/main/deploy/compose/telltale.toml
docker compose up -d
docker compose exec telltale telltale auth setup-token     # then open http://<host>:8053/
```
Kubernetes (Helm), a native systemd install, clustering, and moving from Pi-hole or Technitium are covered in [`docs/running.md`](docs/running.md).

### ASUS Merlin routers
This fork builds static ARM binaries for Asuswrt-Merlin routers with the [`merlin-binaries`](.github/workflows/merlin-binaries.yml) Actions workflow — 32-bit ARMv7 and 64-bit ARM64, with the web UI embedded, no Entware and no extra libraries. Run it from **Actions → merlin-binaries → Run workflow** (or push a `v*` tag) and download the `telltale-merlin-<run>` artifact. **Your router's `uname -m` is the authority**: `armv7l` → `telltale-armv7-linux`, `aarch64` → `telltale-aarch64-linux`.

**Supported routers** (Asuswrt-Merlin, by the binary they need; the GNUton Merlin fork adds the models marked ★):

| `uname -m` | Binary | Routers |
|---|---|---|
| `armv7l` | `telltale-armv7-linux` | **RT-AX95Q / ZenWiFi XT8**, RT-AX58U / RT-AX58U v2 ★, RT-AX82U ★ (v1/v2), RT-AX92U ★, RT-AX5400 ★, TUF-AX3000 ★ (v1/v2), TUF-AX5400 ★ (v1), DSL-AX82U / DSL-AX5400 ★, RT-AXE95Q / ZenWiFi ET8 ★, RT-BE58_GO, RT-BE92U, RT-AX56U (end of support) |
| `aarch64` | `telltale-aarch64-linux` | RT-AX86U / RT-AX86U Pro, RT-AX88U / RT-AX88U Pro, RT-AX68U, GT-AX11000 / GT-AX11000 Pro, GT-AXE11000, GT-AX6000, GT-AXE16000, ZenWiFi Pro XT12, RT-BE86U, RT-BE88U, RT-BE96U, GT-BE98 ★ / GT-BE98 Pro, GT-BE25000 ★, GT-BE19000AI, RT-AC86U (end of support), GT-AC2900 (end of support) |

**Not supported:**

| Routers | Why |
|---|---|
| RT-N66U, RT-AC66U (original), RT-N16 | MIPS; there is no MIPS build |
| RT-AC56U, RT-AC66U B1, RT-AC68U, RT-AC87U, RT-AC3200, RT-AC88U, RT-AC3100, RT-AC5300 | 32-bit ARM, but the firmware runs Linux 2.6.36; this build needs Linux 3.2+ |
| anything not running Asuswrt-Merlin | the installer uses `/jffs/scripts`, which stock Asuswrt does not run reliably |

If a model is missing or you are unsure, run `uname -m` on the router and use the matching file. `armv7l` and `aarch64` are the only two answers that work.

**Getting it onto the router**

1. **Download** the `telltale-merlin-<run>.zip` artifact from the Actions run (or the release asset for a `v*` tag) and unzip it on your computer. Check the file against `SHA256SUMS`.
2. **Enable** on the router: *Administration → System → Enable JFFS custom scripts and configs = Yes*, and *Enable SSH = LAN only*.
3. **Copy** the right binary:
   ```sh
   ssh admin@192.168.1.1 'mkdir -p /jffs/telltale'
   scp telltale-armv7-linux admin@192.168.1.1:/jffs/telltale/telltale
   ssh admin@192.168.1.1 'chmod +x /jffs/telltale/telltale && /jffs/telltale/telltale --version'
   ```
   No `scp`? Put the file on a USB stick and `cp` it, or `wget` it on the router from a URL you control. Verify with `sha256sum /jffs/telltale/telltale` against `SHA256SUMS`.
4. **Configure and start it** — the router's `dnsmasq` already owns port 53, so this step matters. The full guide, config and a boot-time `/jffs/scripts/services-start` script are in [`deploy/merlin/README.md`](deploy/merlin/README.md).


**Status:** pre-1.0. Tagged [releases](https://github.com/paimonsoror/telltaledns/releases) are stable (`latest`), and `edge` is built from every commit on `main`. Releases before 1.0 can still change configuration keys and APIs, and their notes call out every such change; the [roadmap](spec/10-roadmap-and-tasks.md) shows what's next. Project site: **https://paimonsoror.github.io/telltaledns/**

| Read this | If you want |
|---|---|
| [FAQ](https://paimonsoror.github.io/telltaledns/faq.html) | Quick answers to what people ask most: replacing other setups, root-server resolving, blocking categories, per-device encrypted DNS, clusters |
| [`EXECUTIVE-SUMMARY.md`](EXECUTIVE-SUMMARY.md) | What TelltaleDNS is built around, and the projects that inspired it |
| [`docs/analysis.md`](docs/analysis.md) | Design notes: what we learned from Pi-hole and Technitium |
| [`spec/`](spec/00-overview.md) | The build specification (requirements, architecture, ADRs, roadmap) |
| [`AGENTS.md`](AGENTS.md) | Instructions for the agent or developer implementing it |

## Spec index
0. [Overview](spec/00-overview.md): vision, goals, release-gate metrics
1. [Requirements](spec/01-requirements.md): numbered P0/P1/P2 contract
2. [Architecture](spec/02-architecture.md): roles, crates, threading, data flow
3. [Resolution pipeline](spec/03-resolution-pipeline.md): listeners, cache, DNSSEC, recursion
4. [Upstreams](spec/04-upstreams.md): protocols, presets, strategies, custom plugins
5. [Filtering](spec/05-filtering.md): list syntax, FST/DFA snapshots, groups, schedules
6. [Observability](spec/06-observability.md): QueryEvent, metrics, query-log store, analytics
7. [API and UI](spec/07-api-and-ui.md)
8. [Deployment, config, security](spec/08-deployment-config-security.md): Helm, Pi, auth (local + OIDC)
9. [Testing and benchmarks](spec/09-testing-and-benchmarks.md)
10. [Roadmap and tasks](spec/10-roadmap-and-tasks.md)
11. [Decisions (ADRs)](spec/11-decisions.md)
12. [Clustering and HA](spec/12-clustering-and-ha.md)
13. [Agent API and MCP](spec/13-agent-api-and-mcp.md)

## Contributors
Thank you to everyone who helps make TelltaleDNS better, whether by reporting what they found running it for real, writing code, or improving the docs:

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/gregpakes"><img src="https://avatars.githubusercontent.com/u/102243?v=4?s=100" width="100px;" alt="Greg Pakes"/><br /><sub><b>Greg Pakes</b></sub></a><br /><a href="https://github.com/paimonsoror/telltaledns/commits?author=gregpakes" title="Code">💻</a> <a href="https://github.com/paimonsoror/telltaledns/issues?q=author%3Agregpakes" title="Bug reports">🐛</a> <a href="https://github.com/paimonsoror/telltaledns/commits?author=gregpakes" title="Tests">⚠️</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/JohnDepon"><img src="https://avatars.githubusercontent.com/u/44707713?v=4?s=100" width="100px;" alt="John Depon"/><br /><sub><b>John Depon</b></sub></a><br /><a href="https://github.com/paimonsoror/telltaledns/commits?author=JohnDepon" title="Code">💻</a> <a href="https://github.com/paimonsoror/telltaledns/commits?author=JohnDepon" title="Tests">⚠️</a> <a href="https://github.com/paimonsoror/telltaledns/commits?author=JohnDepon" title="Documentation">📖</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind are welcome: [open an issue](https://github.com/paimonsoror/telltaledns/issues) or a pull request.

### Not built with Claude
**This fork is proudly not built by Claude.** The upstream project is developed with [Claude Code](https://claude.com/claude-code), and its history carries `Co-Authored-By: Claude` trailers. This fork's own work — the static ARMv7/ARM64 builds, the `merlin-binaries` workflow, and the Merlin install guide — was not.

## License
Licensed under either of [Apache License 2.0](LICENSE-APACHE) or [MIT](LICENSE-MIT), at your option.
