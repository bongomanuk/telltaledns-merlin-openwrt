<script lang="ts">
  // Router controls for the Merlin and OpenWrt builds: what dnsmasq is doing, where the
  // data lives, and the few actions that are specific to a router (there is no service
  // manager or Docker to restart things for you).
  import { api, type RouterStatus, type RouterAction } from '../lib/api';
  import ErrorNote from '../lib/components/ErrorNote.svelte';

  let status = $state<RouterStatus | null>(null);
  let error = $state<unknown>(null);
  let busy = $state<RouterAction | null>(null);
  let message = $state('');

  async function load() {
    try {
      status = await api.routerStatus();
      error = null;
    } catch (e) {
      error = e;
    }
  }
  $effect(() => {
    void load();
  });

  async function run(action: RouterAction, question: string) {
    if (!confirm(question)) return;
    busy = action;
    message = '';
    try {
      const r = await api.routerAction(action);
      message = r.message;
      error = null;
      if (action !== 'restart_self') await load();
    } catch (e) {
      error = e;
    } finally {
      busy = null;
    }
  }

  const platformName = (p: string) =>
    p === 'merlin' ? 'ASUS Merlin' : p === 'openwrt' ? 'OpenWrt' : 'this host';
</script>

<div class="page">
  <h1>Router</h1>
  <ErrorNote {error} />

  {#if status}
    {#if status.platform === 'other'}
      <div class="notice warn">
        This host is not a Merlin or OpenWrt router, so there are no router controls.
      </div>
    {:else}
      <p class="muted">
        TelltaleDNS runs on {platformName(status.platform)}. dnsmasq keeps port 53 for DHCP and
        the local names, so the LAN keeps resolving when this process is down.
      </p>

      <div class="grid-2">
        <section class="card">
          <h2>dnsmasq</h2>
          <p>
            {#if status.dnsmasqRunning}
              <span class="badge ok">running</span>
            {:else}
              <span class="badge bad">not running</span>
            {/if}
            on port <span class="mono">{status.dnsmasqPort}</span>
          </p>
          <p>
            {#if status.forwarding}
              <span class="badge ok">forwarding</span> public queries to TelltaleDNS
            {:else}
              <span class="badge">not forwarding</span> public queries to TelltaleDNS
            {/if}
          </p>
          <p class="muted">{status.dhcpLeases} DHCP leases read from the router.</p>
          <div class="row">
            <button
              class="primary"
              disabled={busy !== null}
              onclick={() => run('restart_dnsmasq', 'Restart dnsmasq? DNS stops for a few seconds.')}
            >
              {busy === 'restart_dnsmasq' ? 'Restarting…' : 'Restart dnsmasq'}
            </button>
            {#if status.forwarding}
              <button
                class="danger"
                disabled={busy !== null}
                onclick={() =>
                  run('disable_forwarding', 'Stop sending public queries to TelltaleDNS?')}
              >
                Stop forwarding
              </button>
            {:else}
              <button
                class="primary"
                disabled={busy !== null}
                onclick={() => run('enable_forwarding', 'Send dnsmasq\'s public queries to TelltaleDNS?')}
              >
                Start forwarding
              </button>
            {/if}
          </div>
        </section>

        <section class="card">
          <h2>TelltaleDNS</h2>
          <p>
            Started by <span class="mono">{status.service}</span>.
          </p>
          <p class="muted">
            Data and query log: <span class="mono">{status.dataDir}</span>
          </p>
          <p class="muted">
            {#if status.usbMount}
              USB volume: <span class="mono">{status.usbMount}</span>
            {:else}
              No USB volume mounted; the data is on the router's flash.
            {/if}
          </p>
          <div class="row">
            <button
              class="danger"
              disabled={busy !== null}
              onclick={() =>
                run('restart_self', 'Restart TelltaleDNS? The dashboard reconnects in a moment.')}
            >
              {busy === 'restart_self' ? 'Restarting…' : 'Restart TelltaleDNS'}
            </button>
          </div>
        </section>
      </div>

      {#if message}<div class="notice ok">{message}</div>{/if}
    {/if}
  {:else if !error}
    <p class="muted">Reading the router…</p>
  {/if}
</div>
