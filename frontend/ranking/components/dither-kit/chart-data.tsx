import type { ChartConfig } from "./chart-context";

/** The same chart data in the accessibility tree, without changing its layout. */
export function ChartData({
  data,
  config,
  labelKey,
  label,
  activeIndex,
}: {
  data: object[];
  config: ChartConfig;
  labelKey?: string;
  label: string;
  activeIndex: number | null;
}) {
  const keys = Object.keys(config);
  const rows = data as Record<string, unknown>[];
  const name = (row: Record<string, unknown>, index: number) =>
    String((labelKey && row[labelKey]) ?? index + 1);
  const value = (raw: unknown) =>
    raw == null || (typeof raw === "number" && !Number.isFinite(raw))
      ? "Not tested"
      : String(raw);
  const active = activeIndex === null ? null : rows[activeIndex];
  return (
    <div className="sr-only">
      <p>
        Use the arrow keys to inspect values, Home or End to jump, and Escape to
        clear the selection.
      </p>
      <span aria-live="polite" aria-atomic="true">
        {active &&
          `${name(active, activeIndex!)}. ${keys.map((key) => `${config[key].label ?? key}: ${value(active[key])}`).join(". ")}`}
      </span>
      <table>
        <caption>{label} data</caption>
        <thead>
          <tr>
            <th scope="col">{labelKey ?? "Point"}</th>
            {keys.map((key) => (
              <th key={key} scope="col">
                {config[key].label ?? key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <th scope="row">{name(row, index)}</th>
              {keys.map((key) => (
                <td key={key}>{value(row[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function chartKeyboardIndex(
  key: string,
  index: number | null,
  count: number,
): number | null | undefined {
  if (!count) return undefined;
  if (key === "Escape") return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight" || key === "ArrowDown")
    return Math.min(count - 1, (index ?? -1) + 1);
  if (key === "ArrowLeft" || key === "ArrowUp")
    return Math.max(0, (index ?? 1) - 1);
  return undefined;
}
