<script lang="ts">
  // REQ: FLT-010 (T9.7) — weekly schedules: during their windows a group blocks everything
  // (bedtime), applies extra lists, or blocks extra services. Groups follow a schedule by
  // naming it in their own `schedules` field.
  //
  // The editor is a form, not a text syntax: day buttons, time inputs, and the router's own
  // time zone unless another one is picked.
  import { api } from '../lib/api';
  import ErrorNote from '../lib/components/ErrorNote.svelte';
  import HelpButton from '../lib/components/HelpButton.svelte';

  type Window = { days: string[]; start: string; end: string };
  type Schedule = {
    name: string;
    action: string;
    services: string[];
    lists: string[];
    tz?: string;
    window: Window[];
  };

  const DAYS: { id: string; label: string }[] = [
    { id: 'mon', label: 'Mon' },
    { id: 'tue', label: 'Tue' },
    { id: 'wed', label: 'Wed' },
    { id: 'thu', label: 'Thu' },
    { id: 'fri', label: 'Fri' },
    { id: 'sat', label: 'Sat' },
    { id: 'sun', label: 'Sun' },
  ];
  const ZONES = [
    '', 'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Madrid', 'Europe/Paris',
    'Europe/Berlin', 'Europe/Amsterdam', 'Europe/Rome', 'Europe/Warsaw', 'Europe/Stockholm',
    'Europe/Helsinki', 'Europe/Athens', 'Europe/Moscow', 'America/New_York', 'America/Chicago',
    'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Kolkata',
    'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Singapore', 'Australia/Sydney', 'Pacific/Auckland',
    'UTC',
  ];

  let schedules = $state<Schedule[]>([]);
  let services = $state<{ id: string; name: string }[]>([]);
  let lists = $state<string[]>([]);
  let error = $state<unknown>(null);
  let message = $state('');
  let busy = $state(false);

  let name = $state('');
  let action = $state('block_services');
  let pickedServices = $state<string[]>([]);
  let pickedLists = $state<string[]>([]);
  let tz = $state('');
  let windows = $state<Window[]>([{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '21:00', end: '07:00' }]);
  const editing = $derived(schedules.some((s) => s.name === name));

  async function load() {
    try {
      const [entries, svc, l] = await Promise.all([api.configEntries('schedule'), api.services(), api.lists()]);
      schedules = entries.items
        .filter((e) => e.definition && e.source !== 'hidden')
        .map((e) => {
          const d = e.definition as Record<string, unknown>;
          return {
            name: e.name,
            action: String(d.action ?? 'block_services'),
            services: (d.services as string[]) ?? [],
            lists: (d.lists as string[]) ?? [],
            tz: (d.tz as string | undefined) ?? undefined,
            window: ((d.window as Window[]) ?? []).map((w) => ({ ...w })),
          };
        });
      services = svc.items.map((s) => ({ id: s.id, name: s.name }));
      lists = l.items.map((x) => x.name);
      error = null;
    } catch (e) {
      error = e;
    }
  }
  $effect(() => {
    void load();
  });

  function reset() {
    name = '';
    action = 'block_services';
    pickedServices = [];
    pickedLists = [];
    tz = '';
    windows = [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '21:00', end: '07:00' }];
    message = '';
  }

  function edit(s: Schedule) {
    name = s.name;
    action = s.action;
    pickedServices = [...s.services];
    pickedLists = [...s.lists];
    tz = s.tz ?? '';
    windows = s.window.map((w) => ({ days: [...w.days], start: w.start, end: w.end }));
    message = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function preset(kind: 'bedtime' | 'school' | 'weekend') {
    if (kind === 'bedtime') windows = [{ days: ['daily'], start: '21:00', end: '07:00' }];
    if (kind === 'school') windows = [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '15:30', end: '18:00' }];
    if (kind === 'weekend') windows = [{ days: ['sat', 'sun'], start: '09:00', end: '20:00' }];
  }

  function toggleDay(win: Window, day: string) {
    if (win.days.includes('daily')) win.days = [...DAYS.map((d) => d.id)];
    win.days = win.days.includes(day) ? win.days.filter((d) => d !== day) : [...win.days, day];
    if (win.days.length === 7) win.days = ['daily'];
  }

  function setDays(win: Window, days: string[]) {
    win.days = days;
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    message = '';
    try {
      const body: Record<string, unknown> = {
        action,
        window: windows.map((w) => ({ days: w.days, start: w.start, end: w.end })),
      };
      if (action === 'block_services') body.services = pickedServices;
      if (action === 'enable_lists') body.lists = pickedLists;
      if (tz) body.tz = tz;
      await api.putEntry('schedules', name.trim(), body);
      message = editing ? `Saved ${name}.` : `Added ${name}.`;
      await load();
    } catch (err) {
      error = err;
    } finally {
      busy = false;
    }
  }

  async function remove(s: Schedule) {
    if (!confirm(`Delete ${s.name}?`)) return;
    try {
      await api.deleteEntry('schedules', s.name);
      if (name === s.name) reset();
      await load();
    } catch (e) {
      error = e;
    }
  }

  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? id;
  const dayText = (w: Window) =>
    w.days.includes('daily') ? 'every day' : w.days.map((d) => DAYS.find((x) => x.id === d)?.label ?? d).join(', ');
</script>

<div class="page">
  <h1>Schedules<HelpButton id="schedules" /></h1>
  <ErrorNote {error} />

  <p class="muted">
    A schedule has an action and one or more windows. Turn it on for a device group in
    <strong>Groups → Schedules</strong>, so it applies to those devices only. The time zone is
    the router's unless you pick another.
  </p>

  <div class="grid-2">
    <section class="card">
      <h2>Saved schedules</h2>
      {#if schedules.length === 0}
        <p class="empty">None yet. Use the form to add one.</p>
      {:else}
        <table width="100%">
          <tbody>
            {#each schedules as s (s.name)}
              <tr>
                <td><strong>{s.name}</strong><div class="muted small">{s.action === 'block_all' ? 'blocks everything' : s.action === 'block_services' ? `blocks ${s.services.map(serviceName).join(', ') || 'no services'}` : `applies ${s.lists.join(', ')}`}</div></td>
                <td class="small">
                  {#each s.window as w, i (i)}
                    <div>{dayText(w)} {w.start} to {w.end}</div>
                  {/each}
                </td>
                <td class="num nowrap">
                  <button class="link small" onclick={() => edit(s)}>Edit</button>
                  <button class="link small" onclick={() => remove(s)}>Delete</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>

    <section class="card">
      <h2>{editing ? `Edit ${name}` : 'New schedule'}</h2>
      <form class="stack" onsubmit={save}>
        <label class="field">Name
          <input bind:value={name} placeholder="Bedtime" required />
        </label>

        <label class="field">During the windows
          <select bind:value={action}>
            <option value="block_all">Block everything (bedtime)</option>
            <option value="block_services">Block services</option>
            <option value="enable_lists">Apply extra lists</option>
          </select>
        </label>

        {#if action === 'block_services'}
          <div class="field">Services
            <div class="days">
              {#each services as s (s.id)}
                <label class="chip"><input type="checkbox" checked={pickedServices.includes(s.id)} onchange={() => (pickedServices = pickedServices.includes(s.id) ? pickedServices.filter((x) => x !== s.id) : [...pickedServices, s.id])} /> {s.name}</label>
              {/each}
            </div>
          </div>
        {:else if action === 'enable_lists'}
          <div class="field">Lists
            <div class="days">
              {#each lists as l (l)}
                <label class="chip"><input type="checkbox" checked={pickedLists.includes(l)} onchange={() => (pickedLists = pickedLists.includes(l) ? pickedLists.filter((x) => x !== l) : [...pickedLists, l])} /> {l}</label>
              {/each}
            </div>
          </div>
        {/if}

        <div class="field">Presets
          <div class="row">
            <button type="button" class="small" onclick={() => preset('bedtime')}>Bedtime, every night 21:00 to 07:00</button>
            <button type="button" class="small" onclick={() => preset('school')}>After school, Mon to Fri 15:30 to 18:00</button>
            <button type="button" class="small" onclick={() => preset('weekend')}>Weekend, Sat and Sun 09:00 to 20:00</button>
          </div>
        </div>

        {#each windows as w, i (i)}
          <div class="card window">
            <div class="row">
              <strong>Window {i + 1}</strong>
              <button type="button" class="link small" onclick={() => (windows = windows.filter((_, j) => j !== i))}>Remove</button>
            </div>
            <div class="days">
              {#each DAYS as d (d.id)}
                <button type="button" class="day" aria-pressed={w.days.includes(d.id) || w.days.includes('daily')} onclick={() => toggleDay(w, d.id)}>{d.label}</button>
              {/each}
            </div>
            <div class="row">
              <button type="button" class="link small" onclick={() => setDays(w, ['mon', 'tue', 'wed', 'thu', 'fri'])}>Weekdays</button>
              <button type="button" class="link small" onclick={() => setDays(w, ['sat', 'sun'])}>Weekend</button>
              <button type="button" class="link small" onclick={() => setDays(w, ['daily'])}>Every day</button>
            </div>
            <div class="row times">
              <label class="field">Starts <input type="time" bind:value={w.start} required /></label>
              <label class="field">Ends <input type="time" bind:value={w.end} required /></label>
              <span class="muted small">An end before the start runs past midnight.</span>
            </div>
          </div>
        {/each}
        <div class="row">
          <button type="button" onclick={() => (windows = [...windows, { days: ['sat', 'sun'], start: '09:00', end: '20:00' }])}>Add window</button>
        </div>

        <label class="field">Time zone
          <select bind:value={tz}>
            {#each ZONES as z (z)}
              <option value={z}>{z === '' ? "The router's time zone (default)" : z}</option>
            {/each}
          </select>
        </label>

        <div class="row">
          <button class="primary" type="submit" disabled={busy}>{busy ? 'Saving...' : editing ? 'Save' : 'Add schedule'}</button>
          {#if editing}<button type="button" onclick={reset}>New</button>{/if}
        </div>
        {#if message}<div class="notice ok">{message}</div>{/if}
      </form>
    </section>
  </div>
</div>

<style>
  .days {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 6px 0;
  }
  .day {
    padding: 4px 10px;
    border-radius: 999px;
  }
  .day[aria-pressed='true'] {
    background: var(--accent, #1a7f37);
    color: #fff;
    border-color: transparent;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border: 1px solid #ccc;
    border-radius: 999px;
    font-size: 13px;
  }
  .window {
    margin: 8px 0;
    padding: 10px;
  }
  .times {
    gap: 12px;
    flex-wrap: wrap;
    align-items: end;
  }
</style>
