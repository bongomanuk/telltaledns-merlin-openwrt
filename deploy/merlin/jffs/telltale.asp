<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<html xmlns:v>
<head>
<meta http-equiv="X-UA-Compatible" content="IE=Edge"/>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<meta HTTP-EQUIV="Pragma" CONTENT="no-cache">
<meta HTTP-EQUIV="Expires" CONTENT="-1">
<link rel="shortcut icon" href="/images/favicon.png">
<link rel="icon" href="/images/favicon.png">
<title>TelltaleDNS</title>
<link rel="stylesheet" type="text/css" href="/index_style.css">
<link rel="stylesheet" type="text/css" href="/form_style.css">
<script type="text/javascript" src="/js/jquery.js"></script>
<script type="text/javascript" src="/help.js"></script>
<script type="text/javascript" src="/state.js"></script>
<script type="text/javascript" src="/js/httpApi.js"></script>
<script type="text/javascript" src="/client_function.js"></script>
<style type="text/css">
  .tt-value { font-family: Consolas, Monaco, monospace; }
  .tt-ok { color: #1a7f37; font-weight: bold; }
  .tt-bad { color: #c62828; font-weight: bold; }
  .tt-frame {
    width: 100%;
    height: calc(100vh - 210px);
    min-height: 520px;
    border: 0;
    background: #fff;
    border-radius: 3px;
  }
  .tt-status { width: 100%; margin-top: 8px; }
  .tt-status th, .tt-status td { padding: 4px 8px; }
</style>
<script type="text/javascript">
var appBase = 'http://' + location.hostname + ':8053/';
// ui.sh replaces the marker below with the install's token.
var uiToken = '__UI_TOKEN__';
var appLogin = appBase + 'api/v1/auth/ui-login?json=true&token=' + uiToken;

function initial() {
  show_menu();
  var frame = document.getElementById('app');
  // No token (an older install): open the dashboard and sign in there. The test is
  // split so the installer's replacement cannot match it.
  if (uiToken === '__UI_' + 'TOKEN__') {
    frame.src = appBase;
  } else {
    // The cookie is set from this page, a first-party context. Setting it from the
    // frame itself is rejected as a third-party cookie by Chrome.
    fetch(appLogin, { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.cookie) {
          document.cookie = 'telltale_session=' + d.cookie + '; path=/; SameSite=Strict';
        }
      })
      .catch(function () {})
      .then(function () { frame.src = appBase; });
  }
  refresh();
  setInterval(refresh, 10000);
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

function setText(id, text, cls) {
  var el = document.getElementById(id);
  el.textContent = text;
  if (cls) el.className = 'tt-value ' + cls;
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
    setText('state', 'running', 'tt-ok');
    setText('version', version ? version[1] : 'unknown');
    setText('uptime', uptime ? formatUptime(parseFloat(uptime[1])) : 'unknown');
    setText('queries', String(total));
    setText('blocked', blocked ? blocked[1] : '0');
  };
  req.onerror = down;
  req.ontimeout = down;
  req.send();
}

function down() {
  setText('state', 'not running', 'tt-bad');
  setText('version', 'unknown');
  setText('uptime', 'unknown');
  setText('queries', 'unknown');
  setText('blocked', 'unknown');
}
</script>
</head>
<body onload="initial();" onunLoad="return unload_body();" class="bg">
<div id="TopBanner"></div>
<div id="Loading" class="popup_bg"></div>
<table class="content" align="center" cellpadding="0" cellspacing="0">
<tr>
<td width="17">&nbsp;</td>
<td valign="top" width="202">
<div id="mainMenu"></div>
<div id="subMenu"></div>
</td>
<td valign="top">
<div id="tabMenu" class="submenuBlock"></div>
<table width="100%" border="0" align="left" cellpadding="0" cellspacing="0">
<tr>
<td align="left" valign="top">
<iframe id="app" class="tt-frame" src="about:blank" title="TelltaleDNS"></iframe>

<table class="FormTable tt-status" cellpadding="0" cellspacing="0">
  <tr>
    <th>Status</th>
    <td><span id="state" class="tt-value">checking...</span></td>
    <th>Version</th>
    <td><span id="version" class="tt-value">-</span></td>
    <th>Uptime</th>
    <td><span id="uptime" class="tt-value">-</span></td>
    <th>Queries</th>
    <td><span id="queries" class="tt-value">-</span></td>
    <th>Blocked</th>
    <td><span id="blocked" class="tt-value">-</span></td>
  </tr>
</table>
</td>
</tr>
</table>
</td>
<td width="10" align="center" valign="top">&nbsp;</td>
</tr>
</table>
<div id="footer"></div>
</body>
</html>
