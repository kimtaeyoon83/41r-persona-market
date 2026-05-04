interface PersonaVectorLike {
  test_style?: Record<string, number>;
  expertise?: Record<string, number>;
  feedback_pattern?: Record<string, number>;
  reliability?: Record<string, number>;
}

/**
 * 20-dimension persona radar. Flattens the four 5-dim buckets from the
 * persona vector into a single 20-axis polygon so the whole testing
 * profile is visible at a glance — the Hi-Fi design leans on this as
 * the signature visualization for a persona.
 *
 * Values are expected to be in [0, 1]. We normalize anything >1 on a
 * best-effort basis (quality_score often comes in on a 0..5 scale).
 */
export function PersonaRadar20({
  vector,
  size = 160,
  color = "var(--accent)",
  className,
}: {
  vector: PersonaVectorLike;
  size?: number;
  color?: string;
  className?: string;
}) {
  const axes = flattenVector(vector);
  const n = axes.length;
  if (n === 0) return null;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 10;

  const pts = axes.map((v, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * r * v.value, cy + Math.sin(a) * r * v.value] as const;
  });
  const path = "M" + pts.map((p) => p.join(",")).join(" L") + "Z";
  const grid = [0.25, 0.5, 0.75, 1];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
      {grid.map((g, i) => (
        <polygon
          key={i}
          points={Array.from({ length: n }, (_, k) => {
            const a = (k / n) * Math.PI * 2 - Math.PI / 2;
            return [cx + Math.cos(a) * r * g, cy + Math.sin(a) * r * g].join(",");
          }).join(" ")}
          fill="none"
          stroke="var(--line-1)"
          strokeOpacity={0.6}
        />
      ))}
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={cx + Math.cos(a) * r}
            y2={cy + Math.sin(a) * r}
            stroke="var(--line-1)"
            strokeOpacity={0.4}
          />
        );
      })}
      <path d={path} fill={color} fillOpacity={0.15} stroke={color} strokeWidth={1.5} />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={1.8} fill={color} />
      ))}
    </svg>
  );
}

/**
 * Take the first 5 entries from each of the 4 buckets in canonical order
 * so the 20 axes are deterministic across personas. quality_score is
 * rescaled if it's on a 0..5 scale.
 */
function flattenVector(v: PersonaVectorLike): Array<{ key: string; value: number }> {
  const buckets: Array<Record<string, number> | undefined> = [
    v.test_style,
    v.expertise,
    v.feedback_pattern,
    v.reliability,
  ];
  const axes: Array<{ key: string; value: number }> = [];
  for (const b of buckets) {
    if (!b) continue;
    const entries = Object.entries(b).slice(0, 5);
    for (const [key, raw] of entries) {
      let n = typeof raw === "number" ? raw : 0;
      // quality_score often arrives on 0..5 — normalize to 0..1
      if (key === "quality_score" && n > 1) n = n / 5;
      axes.push({ key, value: Math.max(0, Math.min(1, n)) });
    }
  }
  return axes;
}
