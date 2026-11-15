<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="-1">
<title>TelltaleDNS</title>
<link rel="stylesheet" href="/index_style.css">
<link rel="stylesheet" href="/form_style.css">
<style>
  .tt-value { font-family: Consolas, Monaco, monospace; }
  .tt-ok { color: #1a7f37; font-weight: bold; }
  .tt-bad { color: #c62828; font-weight: bold; }
  .tt-actions { margin-top: 12px; }
</style>
</head>
<body>
<div class="content">
  <div class="formfonttitle">TelltaleDNS</div>
  <p class="formfontdesc">
    The DNS resolver behind port 53: dnsmasq keeps DHCP and the local names and sends public
    queries here, where they are filtered and resolved over DNS over TLS.
  </p>

  <table width="100%" cellpadding="4" cellspacing="0" class="FormTable">
    <tr>
      <th width="30%">Status</th>
      <td><span id="status" class="tt-value">checking…</span></td>
    </tr>
    <tr>
      <th>Version</th>
      <td><span id="version" class="tt-value">–</span></td>
    </tr>
    <tr>
      <th>Uptime</th>
      <td><span id="uptime" class="tt-value">–</span></td>
    </tr>
    <tr>
      <th>Queries</th>
      <td><span id="queries" class="tt-value">–</span></td>
    </tr>
    <tr>
      <th>Blocked</th>
      <td><span id="blocked" class="tt-value">–</span></td>
    </tr>
    <tr>
      <th>Dashboard</th>
      <td>
        <input type="button" class="button_gen" value="Open TelltaleDNS" onclick="openApp()">
        <span class="formfontdesc">Sign in with your TelltaleDNS account.</span>
      </td>
    </tr>
  </table>

  <div class="tt-actions">
    <input type="button" class="button_gen" value="Refresh" onclick="refresh()">
  </div>

  <p class="formfontdesc">
    Restart and forwarding controls are in the dashboard under Settings, Router. This tab is
    re-applied by <span class="tt-value">/jffs/scripts/services-start</span> after a reboot or a
    firmware update.
  </p>
</div>

<script type="text/javascript">
function openApp() {
  window.open('http://' + location.hostname + ':8053/', '_blank');
}

function setText(id, text, cls) {
  var el = document.getElementById(id);
  el.textContent = text;
  if (cls) el.className = 'tt-value ' + cls;
}

function formatUptime(secs) {
  var d = Math.floor(secs / 86400);
  var h = Math.floor((secs % 86400) / 3600);
  var m = Math.floor((secs % 3600) / 60);
  if (d) return d + 'd ' + h + 'h';
  if (h) return h + 'h ' + m + 'm';
  if (m) return m + 'm';
  return Math.floor(secs) + 's';
}

function refresh() {
  var url = 'http://' + location.hostname + ':9153/metrics';
  var req = new XMLHttpRequest();
  req.open('GET', url, true);
  req.timeout = 5000;
  req.onload = function () {
    if (req.status !== 200) return down();
    var text = req.responseText || '';
    var version = /^telltale_build_info\{[^}]*version="([^"]+)"/m.exec(text);
    var uptime = /^telltale_uptime_seconds ([0-9.]+)/m.exec(text);
    var blocked = /^telltale_queries_total\{[^}]*status="blocked"[^}]*\} ([0-9]+)/m.exec(text);
    var total = 0;
    var re = /^telltale_queries_total\{[^}]*\} ([0-9]+)/gm;
    var m;
    while ((m = re.exec(text))) total += parseInt(m[1], 10) || 0;

    setText('status', 'running', 'tt-ok');
    setText('version', version ? version[1] : '–');
    setText('uptime', uptime ? formatUptime(parseFloat(uptime[1])) : '–');
    setText('queries', String(total));
    setText('blocked', blocked ? blocked[1] : '0');
  };
  req.onerror = down;
  req.ontimeout = down;
  req.send();
}

function down() {
  setText('status', 'not running', 'tt-bad');
  setText('version', '–');
  setText('uptime', '–');
  setText('queries', '–');
  setText('blocked', '–');
}

refresh();
setInterval(refresh, 10000);
</script>
</body>
</html>
