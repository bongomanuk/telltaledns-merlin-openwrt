<script lang="ts">
  // REQ: FLT-010 (T9.7) — weekly schedules: during their windows a group blocks everything
  // (bedtime), applies extra lists, or blocks extra services. Groups follow a schedule by
  // naming it in their own `schedules` field.
  import { api } from '../lib/api';
  import ErrorNote from '../lib/components/ErrorNote.svelte';
  import HelpButton from '../lib/components/HelpButton.svelte';
  import ConfigEditor, { type Field } from '../lib/components/ConfigEditor.svelte';

  type Window = { days: string[]; start: string; end: string };
  let lists = $state<string[]>([]);
  let services = $state<{ id: string; name: string }[]>([]);
  let error = $state<unknown>(null);

  const windowText = (v: unknown) =>
    ((v as Window[] | undefined) ?? []).map((w) => `${w.days.join(',')} ${w.start}-${w.end}`).join('\n');
  function windowsFrom(s: string): Window[] {
    const out: Window[] = [];
    for (const line of s.split('\n').map((x) => x.trim()).filter(Boolean)) {
      const m = /^([a-z,]+)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/i.exec(line);
      if (!m) throw new Error(`"${line}": write the days and times like "weekdays 21:00-07:00"`);
      out.push({ days: m[1].toLowerCase().split(',').filter(Boolean), start: m[2], end: m[3] });
    }
    if (!out.length) throw new Error('Add at least one window, like "weekdays 21:00-07:00".');
    return out;
  }

  const fields = $derived<Field[]>([
    { key: 'action', label: 'During the windows', type: 'select', options: ['block_all', 'enable_lists', 'block_services'], initial: 'block_services',
      help: 'block_all: a bedtime (everything blocked except quick allow rules and local names). enable_lists: extra lists apply. block_services: extra services are blocked.' },
    { key: 'services', label: 'Services (block_services)', type: 'multi', options: services.map((s) => s.id),
      help: 'Block whole services during the windows: youtube, roblox, tiktok, discord, ...' },
    { key: 'window', label: 'Windows (one per line)', type: 'lines', placeholder: 'weekdays 21:00-07:00\nsat,sun 23:00-08:00',
      help: 'Days: mon … sun, weekdays, weekends, daily. An end before the start runs past midnight.',
      toText: windowText, fromText: windowsFrom },
    { key: 'lists', label: 'Lists (enable_lists)', type: 'multi', options: lists },
    { key: 'tz', label: 'Time zone', type: 'text', placeholder: 'Europe/London', advanced: true,
      help: 'IANA time zone. Default: the node\u2019s.' },
  ]);

  $effect(() => {
    api.lists().then((l) => (lists = l.items.map((x) => x.name))).catch((e) => (error = e));
    api.services().then((s) => (services = s.items)).catch((e) => (error = e));
  });
</script>

<div class="page">
  <h1>Schedules<HelpButton id="schedules" /></h1>
  <ErrorNote {error} />

  <p class="muted">
    A schedule has one action and one or more weekly windows. Turn it on for a device group in
    <strong>Groups → Schedules</strong>, so the window applies to those devices only.
  </p>
  <p class="muted">
    To block YouTube and Roblox for the whole network except a device, make a schedule that blocks
    those services, add it to the group every device uses, then put the exempt device in a group
    that does not name that schedule (or give it a quick allow rule).
  </p>

  <ConfigEditor kind="schedule" path="schedules" title="Manage schedules" noun="schedule" help="schedules" fields={fields}
    summary={(d) =>
      `${String(d.action ?? '')}: ${((d.window as Window[]) ?? []).map((w) => `${w.days.join(',')} ${w.start}-${w.end}`).join('; ')}`} />
</div>
