<script lang="ts">
  // Live connections per device, from the router's conntrack table, with the bytes each
  // flow has carried. Complements the DNS view: this is traffic, not questions.
  import { api, type TrafficRow } from '../lib/api';
  import { poll } from '../lib/poll';
  import { bytes, num } from '../lib/format';
  import ErrorNote from '../lib/components/ErrorNote.svelte';

  let rows = $state<TrafficRow[]>([]);
  let error = $state<unknown>(null);
  $effect(() =>
    poll(async () => {
      try {
        rows = await api.traffic();
        error = null;
      } catch (e) {
        error = e;
      }
    }, 10_000),
  );
  const total = $derived(rows.reduce((n, r) => n + r.bytes, 0));
</script>

<div class="page">
  <h1>Traffic</h1>
  <ErrorNote {error} />
  <p class="muted">
    Live connections per device, from the router's connection tracking, {bytes(total)} across
    {rows.length} devices. Byte counts start when connection accounting was enabled, so a flow
    that began earlier shows fewer bytes.
  </p>

  {#if rows.length === 0}
    <p class="empty">No connections yet.</p>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Device</th><th class="num">Connections</th><th class="num">Bytes</th><th>Top destinations</th></tr>
        </thead>
        <tbody>
          {#each rows as r (r.client)}
            <tr>
              <td>
                <strong>{r.name ?? r.client}</strong>
                <div class="muted small mono">{r.client}</div>
              </td>
              <td class="num">{num(r.connections)}</td>
              <td class="num">{bytes(r.bytes)}</td>
              <td class="small">
                {#each r.peers as p (`${p.peer}:${p.port}`)}
                  <div><span class="mono">{p.peer}:{p.port}</span> <span class="muted">{bytes(p.bytes)}</span></div>
                {/each}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
