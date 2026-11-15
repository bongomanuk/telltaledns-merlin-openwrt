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
  .tt-head { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
  .tt-state { font-weight: bold; }
  .tt-ok { color: #1a7f37; }
  .tt-bad { color: #c62828; }
  .tt-frame { width: 100%; height: calc(100vh - 150px); min-height: 520px; border: 1px solid #ccc; background: #fff; }
  .tt-note { margin: 6px 0 10px; }
</style>
</head>
<body>
<div class="content">
  <div class="tt-head">
    <div class="formfonttitle">TelltaleDNS</div>
    <div class="tt-state"><span id="state">checking…</span></div>
    <div class="formfontdesc">
      <span id="summary"></span>
      <a href="#" onclick="openApp(); return false;">Open in a new tab</a>
    </div>
  </div>
  <p class="formfontdesc tt-note">
    dnsmasq keeps port 53 and sends public queries here, where they are filtered and resolved
    over DNS over TLS. The dashboard below is the full interface; sign in with your TelltaleDNS
    account. Restart and forwarding controls are under Settings, Router.
  </p>
  <iframe id="app" class="tt-frame" src="about:blank" title="TelltaleDNS"></iframe>
</div>

<script type="text/javascript">
var appUrl = 'http://' + location.hostname + ':8053/';

function openApp() {
  window.open(appUrl, '_blank');
}

document.getElementById('app').src = appUrl;

function setState(text, cls) {
  var el = document.getElementById('state');
  el.textContent = text;
  el.className = 'tt-state ' + cls;
}

function refresh() {
  var req = new XMLHttpRequest();
  req.open('GET', 'http://' + location.hostname + ':9153/metrics', true);
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
    setState('running', 'tt-ok');
    document.getElementById('summary').textContent =
      'version ' + (version ? version[1] : '?') +
      ' · up ' + (uptime ? formatUptime(parseFloat(uptime[1])) : '?') +
      ' · ' + total + ' queries · ' + (blocked ? blocked[1] : '0') + ' blocked';
  };
  req.onerror = down;
  req.ontimeout = down;
  req.send();
}

function down() {
  setState('not running', 'tt-bad');
  document.getElementById('summary').textContent =
    'The service is not answering. The tab still opens the dashboard once it is back.';
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

refresh();
setInterval(refresh, 10000);
</script>
</body>
</html>
