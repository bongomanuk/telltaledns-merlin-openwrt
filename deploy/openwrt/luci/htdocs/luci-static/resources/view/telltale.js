'use strict';
'require view';
'require fs';
'require uci';
'require ui';

function act(cmd) {
	return fs.exec_direct('/etc/init.d/telltale', [ cmd ]).then(function () {
		ui.addNotification(null, E('p', {}, _('TelltaleDNS: %s requested.').format(cmd)));
		window.setTimeout(function () { window.location.reload(); }, 1200);
	}).catch(function (e) {
		ui.addNotification(null, E('p', {}, _('Action failed: %s').format(e)), 'error');
	});
}

return view.extend({
	load: function () {
		return Promise.all([
			uci.load('telltale'),
			L.resolveDefault(fs.exec('/etc/init.d/telltale', [ 'running' ]), {})
		]);
	},

	render: function (data) {
		var running = data[1] && data[1].code === 0;
		var enabled = uci.get('telltale', 'main', 'enabled') === '1';
		var config = uci.get('telltale', 'main', 'config') || '/etc/telltale/telltale.toml';
		var url = 'http://' + window.location.hostname + ':8053/';

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('TelltaleDNS')),
			E('div', { 'class': 'cbi-section' }, [
				E('p', {}, [ _('Service: '), E('strong', {}, running ? _('running') : _('stopped')) ]),
				E('p', {}, [ _('Enabled at boot: '), E('strong', {}, enabled ? _('yes') : _('no')) ]),
				E('p', {}, [ _('Config: '), E('code', {}, config) ]),
				E('p', {}, [ E('a', { 'href': url, 'target': '_blank', 'rel': 'noopener' }, _('Open the TelltaleDNS dashboard')) ]),
				E('div', { 'class': 'cbi-page-actions' }, [
					E('button', { 'class': 'cbi-button cbi-button-action', 'click': ui.createHandlerFn(this, function () { return act('start'); }) }, _('Start')),
					E('button', { 'class': 'cbi-button cbi-button-reset', 'click': ui.createHandlerFn(this, function () { return act('stop'); }) }, _('Stop')),
					E('button', { 'class': 'cbi-button cbi-button-apply', 'click': ui.createHandlerFn(this, function () { return act('restart'); }) }, _('Restart'))
				]),
				E('p', { 'class': 'cbi-section-descr' }, [
					_('Start and stop the resolver here; enable or disable it at boot in '),
					E('a', { 'href': L.url('admin/system/startup') }, _('System → Startup')),
					'.'
				])
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
