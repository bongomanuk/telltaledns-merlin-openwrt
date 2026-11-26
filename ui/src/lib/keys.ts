// REQ: API-005 — keys for a list whose values can repeat, when a row must stay with its item (a button that acts at once):
// each value with how many times it came before it, after a NUL (`a`, `b`, `a` → `a\u00000`, `b\u00000`, `a\u00001`). A value
// listed once keeps its key wherever it moves, and a repeat stays unique: the count, after the last NUL, has no NUL in it.

export function occurrenceKeys(values: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return values.map((v) => {
    const n = seen.get(v) ?? 0;
    seen.set(v, n + 1);
    return `${v}\u0000${n}`;
  });
}
