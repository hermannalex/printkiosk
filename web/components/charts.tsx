/** Server-rendered SVG charts; colors come from the CSS tokens so both themes work. */

type DayPoint = { day: string; value: number };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exponent = Math.pow(10, Math.floor(Math.log10(value)));
  const fraction = value / exponent;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * exponent;
}

export function DailyBars({
  points,
  format,
  label,
}: {
  points: DayPoint[];
  format: (value: number) => string;
  label: string;
}) {
  const width = 720;
  const height = 220;
  const left = 64;
  const bottom = 26;
  const top = 10;
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const plotW = width - left - 8;
  const plotH = height - top - bottom;
  const step = plotW / Math.max(points.length, 1);
  const barW = Math.max(2, step * 0.66);
  const ticks = [0, 0.5, 1].map((t) => t * max);
  const labelEvery = Math.ceil(points.length / 8);

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {ticks.map((tick) => {
        const y = top + plotH - (tick / max) * plotH;
        return (
          <g key={tick}>
            <line className="grid" x1={left} x2={width - 8} y1={y} y2={y} />
            <text x={left - 8} y={y + 4} textAnchor="end">{format(tick)}</text>
          </g>
        );
      })}
      {points.map((point, index) => {
        const h = (point.value / max) * plotH;
        const x = left + index * step + (step - barW) / 2;
        return (
          <g key={point.day}>
            <rect className="bar" x={x} y={top + plotH - h} width={barW} height={Math.max(h, point.value > 0 ? 1 : 0)} rx={2}>
              <title>{`${point.day.split("-").reverse().join("/")}: ${format(point.value)}`}</title>
            </rect>
            {index % labelEvery === 0 && (
              <text x={x + barW / 2} y={height - 8} textAnchor="middle">
                {point.day.slice(8, 10)}/{point.day.slice(5, 7)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function HourBars({ counts }: { counts: number[] }) {
  const width = 720;
  const height = 150;
  const bottom = 22;
  const top = 8;
  const max = niceMax(Math.max(0, ...counts));
  const step = width / 24;
  const plotH = height - top - bottom;
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Impressões por hora do dia">
      <line className="grid" x1={0} x2={width} y1={top + plotH} y2={top + plotH} />
      {counts.map((count, hour) => {
        const h = (count / max) * plotH;
        return (
          <g key={hour}>
            <rect className="bar" x={hour * step + step * 0.15} y={top + plotH - h} width={step * 0.7} height={h} rx={2}>
              <title>{`${hour}h: ${count} impressões`}</title>
            </rect>
            {hour % 3 === 0 && (
              <text x={hour * step + step / 2} y={height - 6} textAnchor="middle">{hour}h</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
