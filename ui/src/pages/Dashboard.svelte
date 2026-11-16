<script lang="ts">
  // REQ: API-005 — dashboard: KPI tiles, queries over time by status, where time goes, top
  // lists, upstream share and health (`spec/07` §3).
  import { api, type S, type LockdownStatus } from '../lib/api';
  import { href } from '../lib/router.svelte';
  import { poll } from '../lib/poll';
  import { ms, num, pct, short } from '../lib/format';
  import Kpi from '../lib/components/Kpi.svelte';
  import Chart from '../lib/components/Chart.svelte';
  import Tip from '../lib/components/Tip.svelte';
  import Donut from '../lib/components/Donut.svelte';
  import ErrorNote from '../lib/components/ErrorNote.svelte';
  import BreakerBadge from '../lib/components/BreakerBadge.svelte';
  import ClientChip from '../lib/components/ClientChip.svelte';
  import HelpButton from '../lib/components/HelpButton.svelte';
  import SloCard from '../lib/components/SloCard.svelte';
  import DevicesByType from '../lib/components/DevicesByType.svelte';
  import ChangesControls from '../lib/components/ChangesControls.svelte';
  import LatencyHeatmap from '../lib/components/LatencyHeatmap.svelte';
  import { changes } from '../lib/annotations.svelte';
  import { currentMode } from '../lib/mode.svelte';

  // Instant lockdown: the one switch a parent reaches for.
  let lockdown = $state<LockdownStatus | null>(null);
  let lockdownBusy = $state(false);
  let lockdownError = $state<unknown>(null);
  const locked = $derived((lockdown?.active.length ?? 0) > 0);

  async function loadLockdown() {
    try {
      lockdown = await api.lockdown();
      lockdownError = null;
    } catch (e) {
      lockdownError = e;
    }
  }
  async function toggleLockdown() {
    if (!lockdown) return;
    lockdownBusy = true;
    try {
      lockdown = await api.setLockdown({
        enabled: !locked,
        groups: !locked && lockdown.configuredGroups.length ? lockdown.configuredGroups : undefined,
        minutes: !locked ? lockdown.minutes : undefined,
      });
      lockdownError = null;
    } catch (e) {
      lockdownError = e;
    } finally {
      lockdownBusy = false;
    }
  }
  $effect(() => {
    void loadLockdown();
  });

  const ranges = [
    { id: '15m', label: '15 min', from: '-15m', step: 'second' as const, summary: '-15m', secs: 900 },
    { id: '1h', label: '1 h', from: '-1h', step: 'minute' as const, summary: '-1h', secs: 3600 },
    { id: '24h', label: '24 h', from: '-24h', step: 'minute' as const, summary: '-24h', secs: 86400 },
    { id: '48h', label: '48 h', from: '-48h', step: 'minute' as const, summary: '-48h', secs: 172800 },
    { id: '7d', label: '7 d', from: '-7d', step: 'hour' as const, summary: '-7d', secs: 604800 },
    { id: '30d', label: '30 d', from: '-30d', step: 'hour' as const, summary: '-30d', secs: 2592000 },
  ];
  let range = $state(ranges[2]);

  let summary = $state<S['Summary'] | null>(null);
  // T6.8 — the previous period of the same length, for the tiles' change.
  let previous = $state<S['Summary'] | null>(null);
  let buckets = $state<S['TimeBucket'][]>([]);
  let topDomains = $state<S['TopItem'][]>([]);
  let topBlocked = $state<S['TopItem'][]>([]);
  let topClients = $state<S['TopItem'][]>([]);
  let upstreams = $state<S['UpstreamInfo'][]>([]);
  let stages = $state<S['LatencyRow'][]>([]);
  let byPath = $state<S['LatencyRow'][]>([]);
  // REQ: OBS-016 — the objectives (their own window, not the dashboard's range). The card,
  // like traffic by group, where time goes, upstreams, and upstream exchanges, is technical
  // detail: Advanced view only (owner, 2026-10-09). Burning budgets still reach everyone through the health icon
  // and alerts.
  let slo = $state<S['SloStatus'] | null>(null);
  const advanced = $derived(currentMode() === 'advanced');
  // What each "Where time goes" row means (path/transport, or a wait stage).
  const paths: Record<string, string> = {
    cache:
      'Answered from the cache: a repeat question, no upstream asked. Includes answers whose cached copy had just expired and was given at once while it was refreshed in the background. Usually well under a millisecond.',
    upstream:
      'Not in the cache: asked an upstream resolver and waited for it. Also counts stale answers served because the upstream was slow or failing, and SERVFAIL. Usually the slowest path.',
    local: 'Answered from names on your network (local records), without asking anyone.',
    synthesized:
      "Answered without looking anything up: blocked names, refused or rate-limited queries, malformed ones, and special names (like Firefox's DNS-over-HTTPS canary).",
  };
  const protos: Record<string, string> = {
    udp: 'plain DNS over UDP, what most devices use',
    tcp: 'plain DNS over TCP, for large answers and some tools',
    dot: 'DNS over TLS (port 853), e.g. Android Private DNS',
    doh: 'DNS over HTTPS, e.g. browsers or Apple devices with a profile',
  };
  const pathTip = (key: string) => {
    if (key.startsWith('wait: ')) {
      const what = key.slice(6);
      return what === 'upstream'
        ? "Of the upstream path above: the time spent waiting for upstream resolvers (the rest is this node's own work)."
        : `Time spent waiting for ${what} when it answered.`;
    }
    const [path, proto] = key.split('/');
    const p = paths[path] ?? 'Answers that took this path.';
    return proto && protos[proto] ? `${p} Over ${protos[proto]}.` : p;
  };
  let groups = $state<S['GroupInfo'][]>([]);
  // ADR-050 — the top lists for one kind of device ('' = everyone).
  let group = $state('');
  const groupColor = (n: string) => groups.find((g) => g.name === n)?.color ?? 'var(--muted)';
  // REQ: CLU-002 — the whole cluster ('' ), one node (`node:<id>`), or one site's nodes
  // (`site:<name>`). Remembered in this browser only.
  let nodes = $state<S['ClusterView']['nodes']>([]);
  let scope = $state(remembered());
  function remembered(): string {
    try {
      return localStorage.getItem(KEY) === 'legacy';
    } catch {
      return false;
    }
  }
  let legacy = $state(stored());
  $effect(() => {
    const v = route.params.get('view');
    if (v !== 'legacy' && v !== 'new') return;
    legacy = v === 'legacy';
    try {
      if (legacy) localStorage.setItem(KEY, 'legacy');
      else localStorage.removeItem(KEY);
    } catch {
      // Private windows and blocked storage: the choice lasts until the page is reloaded.
    }
  });
</script>

<div class="page">
  <div class="page-head">
    <h1>Dashboard<HelpButton id="how-it-works" /></h1>
    <!-- The view controls, one group: on a narrow screen they wrap together below the heading. -->
    <div class="head-controls">
      {#if nodes.length > 1}
        <!-- REQ: CLU-002 — every node together, or one node (or site) at a time. -->
        <label class="pill-field">
          Showing
          <select bind:value={scope} aria-label="Nodes">
            <option value="">every node</option>
            {#each nodes as n (n.nodeId)}<option value={`node:${n.nodeId}`}>{nodeLabel(n)}</option>{/each}
            {#each podSites as s (s)}<option value={`site:${s}`}>site {s} (all its nodes)</option>{/each}
          </select>
        </label>
      {/if}
      {#if groups.length > 1}
        <label class="pill-field">
          Top lists for
          <select bind:value={group} aria-label="Group">
            <option value="">every device</option>
            {#each groups as g (g.name)}<option value={g.name}>{g.name}</option>{/each}
          </select>
        </label>
      {/if}
      <div class="seg" role="group" aria-label="Time range">
        {#each ranges as r (r.id)}
          <button aria-pressed={range.id === r.id} onclick={() => (range = r)}>{r.label}</button>
        {/each}
      </div>
      <ChangesControls />
    </div>
  </div>
  <ChangesControls part="body" {advanced} />

  <ErrorNote {error} />
  <section class="card" class:wide={true} data-testid="lockdown">
    <div class="row" style="justify-content: space-between; align-items: center;">
      <div>
        <h2 style="margin: 0;">Lockdown</h2>
        <p class="muted small" style="margin: 4px 0 0;">
          {#if locked}
            Blocking {lockdown?.active.map((a) => a.group).join(', ')} until
            {new Date((lockdown?.active[0]?.untilUnixSeconds ?? 0) * 1000).toLocaleTimeString()}.
          {:else}
            Block the configured groups now. Use the Lockdown page to pick them.
          {/if}
        </p>
      </div>
      <button class={locked ? 'danger' : 'primary'} disabled={lockdownBusy || !lockdown} onclick={toggleLockdown}>
        {locked ? 'Unlock' : 'Lock down'}
      </button>
    </div>
    <ErrorNote error={lockdownError} />
  </section>
  {#if summary?.missingNodes?.length}
    <!-- REQ: CLU-002 — a node that doesn't answer leaves partial totals, said plainly. -->
    <div class="notice warn small">
      Partial results: {summary.missingNodes.join(', ')} didn't answer, so these numbers cover the other cluster nodes.
    </div>
  {/if}

  <div class="kpis">
    <!-- More blocking or more queries isn't good or bad, so those changes stay neutral. -->
    <Kpi label="Queries" value={short(summary?.queries)} sub={`last ${range.label}${scope ? ` · ${scopeLabel}` : ''}`} delta={change(summary?.queries, previous?.queries)} spark={sparkTotal} sparkColor="--s-forwarded" />
    <Kpi label="Blocked" value={pct(summary?.blockedPercent)} sub={`${short(summary?.blocked)} queries`} tone="bad" delta={change(summary?.blockedPercent, previous?.blockedPercent)} spark={sparkBlocked} sparkColor="--s-blocked" ring={summary?.blockedPercent} />
    <Kpi label="Cache hits" value={pct(summary?.cacheHitPercent)} sub={cacheSub} tone="ok" delta={change(summary?.cacheHitPercent, previous?.cacheHitPercent)} good="up" spark={sparkCached} sparkColor="--s-cached" ring={summary?.cacheHitPercent} />
    <Kpi label="Upstream p90" value={ms(upstreamP90?.p90Ms)} sub={cacheP50 ? `cache p50 ${ms(cacheP50.p50Ms)}` : 'this hour'} delta={change(upstreamP90?.p90Ms, prevP90?.p90Ms)} good="down" />
    <Kpi label="Active clients" value={num(summary?.activeClients)} sub="this hour" delta={change(summary?.activeClients, previous?.activeClients)} />
    <Kpi label="NXDOMAIN / SERVFAIL" value={`${short(summary?.nxdomain)} / ${short(summary?.servfail)}`} sub={`last ${range.label}`} delta={change(summary?.servfail, previous?.servfail)} good="down" spark={sparkFailures} sparkColor="--s-blocked" />
  </div>

  {#if advanced}<SloCard {slo} />{/if}

  <div class="status-row">
    <Chart title="Queries by status" {times} series={statusSeries} stacked seconds={range.step === 'second'} markers={changes.markers} />
    <section class="card">
      <h2>Answers by status</h2>
      {#if statusParts.length === 0}
        <p class="empty">No answers in this range.</p>
      {:else}
        <Donut parts={statusParts} center={`answers · ${range.label}`} format={short} />
      {/if}
    </section>
  </div>

  <!-- Advanced view only (owner, 2026-10-09), like the Service level card above. -->
  {#if advanced && (groupSeries.length > 1 || (groupSeries.length === 1 && groupSeries[0].label !== 'default'))}
    <Chart title="Traffic by group" {times} series={groupSeries} stacked seconds={range.step === 'second'} markers={changes.markers} />
  {/if}
  <!-- REQ: OBS-025 — devices by what they look like (Advanced view). -->
  {#if advanced}<DevicesByType />{/if}

  {#if advanced}
  <div class="grid-2">
    <section class="card" class:wide={timeView === 'heatmap'}>
      <div class="card-head">
        <h2>Where time goes {#if timeView === 'table'}<span class="muted small">(this hour)</span>{/if}{#if timeView === 'heatmap'}<HelpButton id="latency-heatmap" />{:else}<HelpButton id="cache" />{/if}</h2>
        <div class="seg" role="group" aria-label="Where time goes as">
          <button type="button" aria-pressed={timeView === 'table'} onclick={() => (timeView = 'table')}>Percentiles</button>
          <button type="button" aria-pressed={timeView === 'heatmap'} onclick={() => (timeView = 'heatmap')} data-testid="time-heatmap-tab">Heatmap</button>
        </div>
      </div>
      {#if timeView === 'heatmap'}
        <LatencyHeatmap />
      {:else if byPath.length + stages.length === 0}
        <p class="empty">No answers yet this hour.</p>
      {:else}
        <div class="table-wrap">
          <table class="compact">
            <thead><tr><th>Path</th><th class="num">Answers</th><th class="num">p50</th><th class="num">p90</th><th class="num">p99</th><th class="num">max</th></tr></thead>
            <tbody>
              {#each [...byPath, ...stages.map((s) => ({ ...s, key: `wait: ${s.key}` }))] as r (r.key)}
                <tr>
                  <td><Tip text={pathTip(r.key)}>{r.key}</Tip></td>
                  <td class="num">{num(r.count)}</td>
                  <td class="num">{ms(r.p50Ms)}</td>
                  <td class="num">{ms(r.p90Ms)}</td>
                  <td class="num">{ms(r.p99Ms)}</td>
                  <td class="num">{ms(r.maxMs)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <section class="card">
      <div class="card-head"><h2>Upstreams{#if otherNode} <span class="muted small">(as this node sees them)</span>{/if}</h2><a href={href('/upstreams')} class="small">Details</a></div>
      {#if upstreams.length === 0}
        <p class="empty">No upstreams configured.</p>
      {:else}
        <ul class="bars">
          {#each upstreams as u (u.id)}
            <li>
              <div class="row">
                <strong>{u.name}</strong>
                <BreakerBadge value={u.breaker} />
                <span class="spacer"></span>
                <span class="muted small">{pct(totalUpstream ? (u.requests / totalUpstream) * 100 : 0, 0)} · {ms(u.latencyEwmaMs)}</span>
              </div>
              <div class="bar"><span style:width={`${totalUpstream ? (u.requests / totalUpstream) * 100 : 0}%`}></span></div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>

    <Chart title="Upstream exchanges" {times} series={upstreamSeries} height={160} bars seconds={range.step === 'second'} markers={changes.markers} />
  {/if}

  <div class="grid-3">
    {#each [
      { title: 'Top domains', items: topDomains, link: (k: string) => href('/queries', { name: k, match: 'exact' }) },
      { title: 'Top blocked', items: topBlocked, link: (k: string) => href('/queries', { name: k, match: 'exact', status: 'blocked' }) },
      { title: 'Top clients', items: topClients, link: (k: string) => href('/queries', { client: k }) },
    ] as t (t.title)}
      <section class="card">
        {#if t.title === 'Top domains'}
          <div class="card-head">
            <h2>{t.title} <span class="muted small">(this hour)</span><HelpButton id="internal-names" /></h2>
            <div class="seg" role="group" aria-label="Top domains on the internet or internal">
              <button type="button" aria-pressed={domainsView === 'internet'} onclick={() => { domainsView = 'internet'; void load(); }}>Internet</button>
              <button type="button" aria-pressed={domainsView === 'internal'} onclick={() => { domainsView = 'internal'; void load(); }} data-testid="domains-internal-tab">Internal</button>
            </div>
          </div>
        {:else}
          <h2>{t.title} <span class="muted small">(this hour)</span></h2>
        {/if}
        {#if t.items.length === 0}
          <p class="empty">Nothing yet.</p>
        {:else}
          <ol class="bars">
            {#each t.items as i (i.key)}
              <li>
                <div class="row">
                  {#if t.title === 'Top clients'}
                    <span class="name"><ClientChip ip={i.key} name={i.name} onchanged={() => void load()} /></span>
                    <!-- ADR-050 — the groups whose settings apply to the device. -->
                    {#each i.groups ?? [] as g (g)}<span class="group-chip small" style:--gc={groupColor(g)}>{g}</span>{/each}
                  {:else}
                    <a class="name" href={t.link(i.key)}>{i.key}</a>
                  {/if}
                  <span class="spacer"></span>
                  <span class="num small">{num(i.count)}</span>
                </div>
                <div class="bar"><span style:width={`${(i.count / maxTop(t.items)) * 100}%`}></span></div>
              </li>
            {/each}
          </ol>
        {/if}
      </section>
    {/each}
  </div>
</div>

<style>
  .switch-back {
    margin: 18px 0 0;
  }
</style>
