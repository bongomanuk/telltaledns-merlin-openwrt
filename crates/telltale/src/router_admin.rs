//! Router controls for the Merlin and OpenWrt builds: what dnsmasq is doing, where the
//! data lives, and the few actions the Router page offers.
//!
//! The process runs as root (it binds the API port and is started by the router's boot
//! script), so these actions use the router's own commands: `service restart_dnsmasq`
//! on Merlin, `/etc/init.d/dnsmasq restart` on OpenWrt. Nothing here is available on a
//! normal host; [`platform`] returns `other` there and the API says so.

use std::path::Path;
use std::process::{Command, Stdio};

use telltale_api::model::{RouterActionResult, RouterStatus};
use telltale_api::problem::Problem;

const MERLIN_SERVICES: &str = "/jffs/scripts/services-start";
const MERLIN_DNSMASQ_ADD: &str = "/jffs/configs/dnsmasq.conf.add";
const MERLIN_LEASES: &str = "/var/lib/misc/dnsmasq.leases";
const OPENWRT_LEASES: &str = "/tmp/dhcp.leases";
const OPENWRT_INIT: &str = "/etc/init.d/telltale";
/// The loopback listener dnsmasq forwards to.
const LISTEN: &str = "127.0.0.1#5354";
/// The plain servers dnsmasq falls back to when this process is down.
const FALLBACK: [&str; 2] = ["9.9.9.9", "1.1.1.1"];

/// `merlin`, `openwrt`, or `other`.
pub(crate) fn platform() -> &'static str {
    if Path::new(MERLIN_SERVICES).exists() {
        "merlin"
    } else if Path::new("/etc/rc.common").exists() && Path::new("/etc/config").is_dir() {
        "openwrt"
    } else {
        "other"
    }
}

/// The Router page's status.
pub(crate) fn status(data_dir: &str) -> RouterStatus {
    let platform = platform();
    let (uptime_secs, load1) = uptime_and_load();
    let (mem_total_kb, mem_free_kb) = memory_kb();
    let (data_free_kb, data_total_kb) = df_kb(Path::new(data_dir));
    let usb = usb_mount();
    RouterStatus {
        platform: platform.to_owned(),
        dnsmasq_running: process_running("dnsmasq"),
        dnsmasq_port: dnsmasq_port(platform),
        dhcp_leases: lease_count(platform),
        forwarding: forwarding(platform),
        data_dir: data_dir.to_owned(),
        usb_mount: usb.clone(),
        service: match platform {
            "merlin" => MERLIN_SERVICES.to_owned(),
            "openwrt" => "procd (/etc/init.d/telltale)".to_owned(),
            _ => String::new(),
        },
        device: device(platform),
        firmware: firmware(platform),
        uptime_secs,
        load1,
        mem_total_kb,
        mem_free_kb,
        data_free_kb,
        data_total_kb,
        usb_free_kb: usb.as_deref().map(|m| df_kb(Path::new(m)).0),
        ui_installed: (platform == "merlin").then(ui_installed),
        service_enabled: (platform == "openwrt").then(service_enabled),
    }
}

/// Runs a Router page control.
pub(crate) fn action(action: telltale_api::model::RouterAction) -> Result<RouterActionResult, Problem> {
    use telltale_api::model::RouterAction;

    match action {
        RouterAction::RestartDnsmasq => {
            restart_dnsmasq()?;
            Ok(done("dnsmasq restarted"))
        }
        RouterAction::RestartSelf => {
            restart_self()?;
            Ok(done("TelltaleDNS is restarting"))
        }
        RouterAction::EnableForwarding => {
            set_forwarding(true)?;
            restart_dnsmasq()?;
            Ok(done("dnsmasq now forwards public queries to TelltaleDNS"))
        }
        RouterAction::DisableForwarding => {
            set_forwarding(false)?;
            restart_dnsmasq()?;
            Ok(done("dnsmasq no longer forwards to TelltaleDNS"))
        }
        RouterAction::EnableUi => {
            if platform() != "merlin" {
                return Err(failed("only the Merlin web UI has this tab".into()));
            }
            run("/jffs/telltale/ui.sh", &["install"])?;
            Ok(done("TelltaleDNS tab added to the router web UI"))
        }
        RouterAction::DisableUi => {
            if platform() != "merlin" {
                return Err(failed("only the Merlin web UI has this tab".into()));
            }
            run("/jffs/telltale/ui.sh", &["remove"])?;
            Ok(done("TelltaleDNS tab removed from the router web UI"))
        }
        RouterAction::RebootRouter => {
            match platform() {
                "merlin" => run("service", &["reboot"]),
                "openwrt" => run("reboot", &[]),
                _ => Err(failed("no router controls on this host".into())),
            }?;
            Ok(done("the router is rebooting"))
        }
        RouterAction::EnableService => {
            if platform() != "openwrt" {
                return Err(failed("the boot script is /jffs/scripts/services-start here".into()));
            }
            uci("set", &["telltale.main.enabled=1"])?;
            let _ = uci("commit", &["telltale"]);
            run(OPENWRT_INIT, &["enable"])?;
            Ok(done("TelltaleDNS starts at boot"))
        }
        RouterAction::DisableService => {
            if platform() != "openwrt" {
                return Err(failed("the boot script is /jffs/scripts/services-start here".into()));
            }
            uci("set", &["telltale.main.enabled=0"])?;
            let _ = uci("commit", &["telltale"]);
            run(OPENWRT_INIT, &["disable"])?;
            Ok(done("TelltaleDNS no longer starts at boot"))
        }
    }
}

/// Uptime in seconds and the one-minute load average.
fn uptime_and_load() -> (u64, f32) {
    let uptime = std::fs::read_to_string("/proc/uptime")
        .ok()
        .and_then(|s| s.split_whitespace().next()?.parse::<f64>().ok())
        .unwrap_or(0.0);
    let load = std::fs::read_to_string("/proc/loadavg")
        .ok()
        .and_then(|s| s.split_whitespace().next()?.parse::<f32>().ok())
        .unwrap_or(0.0);
    (uptime as u64, load)
}

/// Total and available memory in kilobytes.
fn memory_kb() -> (u64, u64) {
    let Ok(text) = std::fs::read_to_string("/proc/meminfo") else {
        return (0, 0);
    };
    let field = |name: &str| {
        text.lines()
            .find(|l| l.starts_with(name))
            .and_then(|l| l.split_whitespace().nth(1)?.parse::<u64>().ok())
            .unwrap_or(0)
    };
    (field("MemTotal:"), field("MemAvailable:"))
}

/// Free and total kilobytes of the file system holding `path`.
fn df_kb(path: &Path) -> (u64, u64) {
    let Ok(out) = Command::new("df").arg("-k").arg(path).output() else {
        return (0, 0);
    };
    if !out.status.success() {
        return (0, 0);
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let Some(line) = text.lines().nth(1) else {
        return (0, 0);
    };
    let fields: Vec<&str> = line.split_whitespace().collect();
    let free = fields.get(3).and_then(|v| v.parse().ok()).unwrap_or(0);
    let total = fields.get(1).and_then(|v| v.parse().ok()).unwrap_or(0);
    (free, total)
}

fn device(platform: &str) -> String {
    match platform {
        "merlin" => nvram("productid"),
        "openwrt" => std::fs::read_to_string("/tmp/sysinfo/model")
            .map(|s| s.trim().to_owned())
            .unwrap_or_else(|_| "OpenWrt".to_owned()),
        _ => String::new(),
    }
}

fn firmware(platform: &str) -> String {
    match platform {
        "merlin" => {
            let build = nvram("buildno");
            let ext = nvram("extendno");
            if ext.is_empty() {
                build
            } else {
                format!("{build}-{ext}")
            }
        }
        "openwrt" => std::fs::read_to_string("/etc/openwrt_release")
            .ok()
            .and_then(|s| {
                s.lines()
                    .find(|l| l.starts_with("DISTRIB_RELEASE="))
                    .map(|l| l.trim_start_matches("DISTRIB_RELEASE=").trim_matches('\'').to_owned())
            })
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn nvram(key: &str) -> String {
    run_capture("nvram", &["get", key])
        .map(|s| s.trim().to_owned())
        .unwrap_or_default()
}

/// The Merlin web UI tab is installed (the page the menu names exists).
fn ui_installed() -> bool {
    let Ok(page) = std::fs::read_to_string("/jffs/telltale/ui-page") else {
        return false;
    };
    let page = page.trim();
    !page.is_empty() && Path::new("/www/user").join(page).exists()
}

/// OpenWrt's `/etc/config/telltale` enables the service.
fn service_enabled() -> bool {
    uci("get", &["telltale.main.enabled"])
        .map(|v| v.trim() == "1")
        .unwrap_or(false)
}

fn done(message: &str) -> RouterActionResult {
    RouterActionResult {
        ok: true,
        message: message.to_owned(),
    }
}

fn failed(message: String) -> Problem {
    Problem::unavailable(message)
}

/// True when a process with this name is running.
fn process_running(name: &str) -> bool {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return false;
    };
    entries.flatten().any(|e| {
        e.file_name()
            .to_str()
            .and_then(|n| n.parse::<u32>().ok())
            .is_some_and(|_| {
                std::fs::read_to_string(e.path().join("comm"))
                    .map(|c| c.trim() == name)
                    .unwrap_or(false)
            })
    })
}

/// The port dnsmasq serves DNS on.
fn dnsmasq_port(platform: &str) -> u16 {
    match platform {
        "merlin" => std::fs::read_to_string(MERLIN_DNSMASQ_ADD)
            .ok()
            .and_then(|s| {
                s.lines()
                    .filter_map(|l| l.strip_prefix("port="))
                    .filter_map(|p| p.trim().parse().ok())
                    .next_back()
            })
            .unwrap_or(53),
        "openwrt" => uci("get", &["dhcp.@dnsmasq[0].port"])
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(53),
        _ => 53,
    }
}

/// Leases in dnsmasq's lease file.
fn lease_count(platform: &str) -> usize {
    let path = match platform {
        "merlin" => MERLIN_LEASES,
        "openwrt" => OPENWRT_LEASES,
        _ => return 0,
    };
    std::fs::read_to_string(path)
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
        .unwrap_or(0)
}

/// dnsmasq sends public queries to this process.
fn forwarding(platform: &str) -> bool {
    match platform {
        "merlin" => std::fs::read_to_string(MERLIN_DNSMASQ_ADD)
            .map(|s| s.lines().any(|l| l.trim() == format!("server={LISTEN}")))
            .unwrap_or(false),
        "openwrt" => uci("get", &["dhcp.@dnsmasq[0].server"])
            .map(|s| s.lines().any(|l| l.trim() == LISTEN))
            .unwrap_or(false),
        _ => false,
    }
}

/// A mounted USB volume.
fn usb_mount() -> Option<String> {
    let mounts = std::fs::read_to_string("/proc/mounts").ok()?;
    mounts.lines().find_map(|line| {
        let mut f = line.split_whitespace();
        let dev = f.next()?;
        let mnt = f.next()?;
        let usb = dev.starts_with("/dev/sd") && (mnt.starts_with("/tmp/mnt/") || mnt.starts_with("/mnt/"));
        usb.then(|| mnt.to_owned())
    })
}

fn restart_dnsmasq() -> Result<(), Problem> {
    match platform() {
        "merlin" => run("service", &["restart_dnsmasq"]),
        "openwrt" => run("/etc/init.d/dnsmasq", &["restart"]),
        _ => Err(failed("no router controls on this host".into())),
    }
}

/// Restarts this process. Merlin has no service manager: the boot script starts it, so a
/// detached shell stops this process and runs the script again.
fn restart_self() -> Result<(), Problem> {
    match platform() {
        "merlin" => {
            let pid = std::process::id();
            let script = format!("sleep 2; kill {pid} 2>/dev/null; sleep 2; {MERLIN_SERVICES}");
            Command::new("sh")
                .args(["-c", &script])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| failed(format!("could not schedule the restart: {e}")))?;
            Ok(())
        }
        "openwrt" => run(OPENWRT_INIT, &["restart"]),
        _ => Err(failed("no router controls on this host".into())),
    }
}

/// Points dnsmasq at this process, or removes that.
fn set_forwarding(on: bool) -> Result<(), Problem> {
    match platform() {
        "merlin" => set_forwarding_merlin(on),
        "openwrt" => set_forwarding_openwrt(on),
        _ => Err(failed("no router controls on this host".into())),
    }
}

fn set_forwarding_merlin(on: bool) -> Result<(), Problem> {
    let path = Path::new(MERLIN_DNSMASQ_ADD);
    let mut lines: Vec<String> = std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(str::to_owned)
        .collect();
    let ours = |l: &str| {
        l == "no-resolv"
            || l == "strict-order"
            || l == format!("server={LISTEN}")
            || FALLBACK.iter().any(|s| l == format!("server={s}"))
    };
    lines.retain(|l| !ours(l) && l != "port=5354");
    if on {
        lines.push("no-resolv".into());
        lines.push("strict-order".into());
        lines.push(format!("server={LISTEN}"));
        for s in FALLBACK {
            lines.push(format!("server={s}"));
        }
    }
    write_lines(path, &lines)
}

fn set_forwarding_openwrt(on: bool) -> Result<(), Problem> {
    if on {
        uci("set", &["dhcp.@dnsmasq[0].noresolv=1"])?;
        uci("set", &["dhcp.@dnsmasq[0].strictorder=1"])?;
        let _ = uci("delete", &["dhcp.@dnsmasq[0].server"]);
        uci("add_list", &[&format!("dhcp.@dnsmasq[0].server={LISTEN}")])?;
        for s in FALLBACK {
            uci("add_list", &[&format!("dhcp.@dnsmasq[0].server={s}")])?;
        }
    } else {
        // Only our entries: other `server` lines belong to the user.
        for server in [LISTEN].iter().chain(FALLBACK.iter()) {
            let _ = uci("del_list", &[&format!("dhcp.@dnsmasq[0].server={server}")]);
        }
        uci("set", &["dhcp.@dnsmasq[0].noresolv=0"])?;
    }
    let _ = uci("commit", &["dhcp"]);
    Ok(())
}

fn write_lines(path: &Path, lines: &[String]) -> Result<(), Problem> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| failed(format!("could not create {}: {e}", dir.display())))?;
    }
    let mut text = lines.join("\n");
    text.push('\n');
    std::fs::write(path, text)
        .map_err(|e| failed(format!("could not write {}: {e}", path.display())))
}

fn uci(verb: &str, args: &[&str]) -> Result<String, Problem> {
    run_capture("uci", &[&["-q", verb][..], args].concat())
}

fn run(program: &str, args: &[&str]) -> Result<(), Problem> {
    let out = Command::new(program)
        .args(args)
        .output()
        .map_err(|e| failed(format!("could not run {program}: {e}")))?;
    if out.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_owned();
        Err(failed(if err.is_empty() {
            format!("{program} failed")
        } else {
            err
        }))
    }
}

fn run_capture(program: &str, args: &[&str]) -> Result<String, Problem> {
    let out = Command::new(program)
        .args(args)
        .output()
        .map_err(|e| failed(format!("could not run {program}: {e}")))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_owned();
        Err(failed(if err.is_empty() {
            format!("{program} failed")
        } else {
            err
        }))
    }
}
