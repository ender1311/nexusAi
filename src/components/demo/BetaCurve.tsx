export type BetaCurveProps = {
  alpha: number;
  beta: number;
  sample: number;
  highlight: boolean;
};

export default function BetaCurve({ alpha, beta, sample, highlight }: BetaCurveProps) {
  const mode = (alpha - 1) / (alpha + beta - 2);
  const sigma = 1 / Math.sqrt(alpha + beta);

  const points: string[] = [];
  for (let i = 0; i <= 100; i++) {
    const x = i / 100;
    const z = (x - mode) / sigma;
    const y = Math.exp(-0.5 * z * z);
    const px = 10 + i * 1.4;
    const py = 55 - y * 48;
    points.push(`${px},${py}`);
  }
  const polyline = points.join(" ");
  const sampleX = 10 + sample * 140;

  return (
    <svg
      width="160"
      height="64"
      className={`rounded border ${highlight ? "border-[#57a16c] bg-[#57a16c]/5" : "border-border bg-muted/30"}`}
    >
      <polyline
        points={polyline}
        fill="none"
        stroke={highlight ? "#57a16c" : "hsl(var(--muted-foreground))"}
        strokeWidth="2"
      />
      <line
        x1={sampleX}
        y1="8"
        x2={sampleX}
        y2="56"
        stroke={highlight ? "#57a16c" : "hsl(var(--muted-foreground))"}
        strokeWidth="1.5"
        strokeDasharray="3,2"
      />
      <text x={sampleX + 3} y="16" fontSize="8" fill={highlight ? "#57a16c" : "hsl(var(--muted-foreground))"}>
        {sample.toFixed(2)}
      </text>
    </svg>
  );
}
