<script lang="ts">
  // Instant lockdown: one switch that blocks whole groups now, until a deadline. It is a
  // manual policy, separate from the weekly schedules.
  import { api, type LockdownStatus } from '../lib/api';
  import ErrorNote from '../lib/components/ErrorNote.svelte';

  let status = $state<LockdownStatus | null>(null);
  let groups = $state<string[]>([]);
  let picked = $state<string[]>([]);
  let minutes = $state(60);
  let error = $state<unknown>(null);
  let message = $state('');
  let busy = $state(false);

  async function load() {
    try {
      const [s, g] = await Promise.all([api.lockdown(), api.groups()]);
      status = s;
      groups = g.items.map((x) => x.name);
      if (!picked.length) {
        picked = s.configuredGroups.length ? [...s.configuredGroups] : [...groups];
      }
      minutes = s.minutes || 60;
      error = null;
    } catch (e) {
      error = e;
    }
  }
  $effect(() => {
    void load();
  });

  const active = $derived(status?.active ?? []);
  const locked = $derived(active.length > 0);

  function remaining(until: number): string {
    const secs = Math.max(0, until - Math.floor(Date.now() / 1000));
    const h = Math.floor(secs / 3600);
    const m = Math.ceil((secs % 3600) / 60);
    return h ? `${h} h ${m} min` : `${m} min`;
  }

  async function set(enabled: boolean) {
    busy = true;
    message = '';
    try {
      status = await api.setLockdown({
        enabled,
        groups: enabled ? picked : undefined,
        minutes: enabled ? minutes : undefined,
      });
      message = enabled ? 'Locked. Devices in those groups are blocked now.' : 'Unlocked.';
      error = null;
    } catch (e) {
      error = e;
    } finally {
      busy = false;
    }
  }

  function toggleGroup(name: string) {
    picked = picked.includes(name) ? picked.filter((g) => g !== name) : [...picked, name];
  }
</script>

<div class="page">
  <h1>Lockdown</h1>
  <ErrorNote {error} />

  <p class="muted">
    A switch for the moment. While it is on, the chosen groups are blocked, whatever the
    lists and schedules say. Quick allow rules still work, and it turns itself off at the
    deadline. Nothing is saved to the config: a reboot clears it.
  </p>

  {#if status}
    <section class="card">
      <h2>Now</h2>
      {#if locked}
        <p><span class="badge bad">locked</span></p>
        <ul>
          {#each active as a (a.group)}
            <li><strong>{a.group}</strong> until {new Date(a.untilUnixSeconds * 1000).toLocaleTimeString()} ({remaining(a.untilUnixSeconds)} left)</li>
          {/each}
        </ul>
        <div class="row">
          <button class="danger" disabled={busy} onclick={() => set(false)}>Unlock now</button>
        </div>
      {:else}
        <p><span class="badge ok">off</span> No group is locked.</p>
      {/if}
      {#if message}<div class="notice ok">{message}</div>{/if}
    </section>

    <section class="card">
      <h2>Lock</h2>
      <p class="muted">Pick the groups to block and how long.</p>
      <div class="row" style="flex-wrap: wrap; gap: 6px 14px;">
        {#each groups as g (g)}
          <label class="row" style="gap: 6px;">
            <input type="checkbox" checked={picked.includes(g)} onchange={() => toggleGroup(g)} />
            {g}
          </label>
        {/each}
      </div>
      <label class="field" style="max-width: 220px; margin-top: 12px;">
        Minutes
        <input type="number" min="1" max="1440" bind:value={minutes} />
      </label>
      <div class="row" style="margin-top: 12px;">
        <button class="danger" disabled={busy || picked.length === 0} onclick={() => set(true)}>
          {busy ? 'Working…' : 'Lock these groups'}
        </button>
      </div>
      {#if picked.length === 0}
        <p class="muted small">Pick at least one group.</p>
      {/if}
    </section>

    <p class="muted small">
      The dashboard has the same switch, using the groups and minutes in the config file
      (<code>[lockdown]</code>). Use this page when you want to choose them each time.
    </p>
  {/if}
</div>
