interface Props {
  arcs: string[];
  inner: string[];
  center: number;
  label: string;
  size?: number;
}

const CX = 150;
const CY = 150;
const STONE = "#F3E2C4";
const DIM = "#3B3227";

function point(radius: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)];
}

function arcPath(radius: number, start: number, end: number): string {
  const [x0, y0] = point(radius, start);
  const [x1, y1] = point(radius, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${radius} ${radius} 0 ${large} 1 ${x1} ${y1}`;
}

// The instrument face from the workshop mockup. Ticks and the dashed orbit are
// decoration. Colored arcs and the center number are the live session counts
// passed in — an idle workspace is a dim ring reading 00.
export default function StatusRing({ arcs, inner, center, label, size = 150 }: Props) {
  const ticks = Array.from({ length: 72 }, (_, i) => {
    const deg = i * 5;
    const [x1, y1] = point(i % 6 ? 128 : 121, deg);
    const [x2, y2] = point(134, deg);
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={STONE} strokeOpacity={0.55} />;
  });

  const outer = arcs.length ? arcs : [];
  const step = outer.length ? 360 / outer.length : 360;
  const innerStep = inner.length ? 360 / inner.length : 360;
  const labelText = center.toString().padStart(2, "0");

  return (
    <svg className="status-ring" width={size} height={size} viewBox="0 0 300 300" role="img" aria-label={`${labelText} ${label}`}>
      <g className="ring-spin">{ticks}</g>
      <circle cx={CX} cy={CY} r={142} fill="none" stroke={STONE} strokeOpacity={0.3} />
      {outer.length === 0 && (
        <circle cx={CX} cy={CY} r={102} fill="none" stroke={DIM} strokeWidth={16} />
      )}
      {outer.map((color, i) => (
        <path
          key={`arc-${i}`}
          d={arcPath(102, -90 + i * step + 4, -90 + (i + 1) * step - 4)}
          stroke={color}
          strokeWidth={16}
          fill="none"
          style={color === DIM ? undefined : { filter: `drop-shadow(0 0 6px ${color})` }}
        />
      ))}
      <g className="ring-spin-reverse">
        {inner.map((color, i) => (
          <path
            key={`in-${i}`}
            d={arcPath(74, -90 + i * innerStep + 3, -90 + (i + 1) * innerStep - 3)}
            stroke={color}
            strokeWidth={7}
            fill="none"
            strokeOpacity={color === DIM ? 0.45 : 0.9}
          />
        ))}
      </g>
      <g className="ring-breathe">
        <circle cx={CX} cy={CY} r={54} fill="#140E07" stroke={STONE} strokeWidth={2} />
      </g>
      <circle cx={CX} cy={CY} r={43} fill="none" stroke={STONE} strokeOpacity={0.45} strokeDasharray="3 5" className="ring-spin-reverse" />
      <text x={CX} y={CY + 8} textAnchor="middle" fill="#F6EEDF" fontFamily="Chakra Petch, sans-serif" fontSize={34} fontWeight={600}>
        {labelText}
      </text>
      <text x={CX} y={CY + 28} textAnchor="middle" fill={STONE} fontFamily="Geist Mono, ui-monospace, monospace" fontSize={9} letterSpacing={3}>
        {label}
      </text>
    </svg>
  );
}
