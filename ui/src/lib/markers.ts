// REQ: OBS-033 (GitHub issue #39) — which change markers a time chart draws, and where.

/**
 * How far ahead of this browser's clock a marker may be and still be drawn: the server stamps a
 * change or a note with its own clock, and the two can differ by a little.
 */
export const CLOCK_SKEW_S = 60;

/**
 * The markers a chart draws: those from the chart's start to the end of its data, or to now when
 * that is later.
 *
 * A chart's data ends at its last bucket, which is only as new as the last load. A change made
 * since (a note saved just after the minute turned) has no bucket yet, and used to be left off until
 * the next poll, up to 15 seconds later, so a saved note looked unsaved. The chart's window runs to
 * now, so such a marker belongs on it at once: the caller draws it at the right edge.
 *
 * `nowS` is the end of the chart's window in Unix seconds. Every chart that takes markers ends
 * now (the dashboard's ranges, the Cache page's last hour, the budget burn-down), so that is
 * `Date.now() / 1000`; a chart that ended in the past would pass its own end.
 */
export function visibleMarkers<T extends { time: number }>(markers: T[], from: number, dataEnd: number, nowS: number): T[] {
  const to = Math.max(dataEnd, nowS + CLOCK_SKEW_S);
  return markers.filter((m) => m.time >= from && m.time < to);
}

/** Past this many markers in view, those within 8 px of each other share one button, with a count. */
export const MAX_SINGLE = 40;

/** One marker button: the markers it stands for, the whole pixel it is drawn at, and its column. */
export interface MarkerColumn<T> {
  /** The column (`x / 8`, or `x` up to `MAX_SINGLE`, rounded): unique, so the chart keys its buttons by it (REQ: API-005). */
  k: number;
  /** Where the button is drawn: the rounded position of its first marker. */
  x: number;
  marks: T[];
}

/**
 * REQ: OBS-033 — a chart's markers as buttons: one per pixel column, or past `MAX_SINGLE` one per 8 px; `xOf` is a marker's
 * position across the plot in CSS pixels. Sorted by position. A button is drawn at its first marker (the caller passes them
 * newest first), so two neighbouring 8-px columns can be drawn at the same pixel (11.6 and 12.1 are columns 1 and 2, both
 * drawn at 12): the column, not the pixel, tells two buttons apart.
 */
export function markerColumns<T>(marks: T[], xOf: (m: T) => number): MarkerColumn<T>[] {
  const col = marks.length > MAX_SINGLE ? 8 : 1;
  const cols = new Map<number, MarkerColumn<T>>();
  for (const m of marks) {
    const x = xOf(m);
    const k = Math.round(x / col);
    const c = cols.get(k);
    if (c) c.marks.push(m);
    else cols.set(k, { k, x: Math.round(x), marks: [m] });
  }
  return [...cols.values()].sort((a, b) => a.x - b.x);
}
