export default function FlywheelDiagram() {
  const muted = "hsl(var(--muted-foreground))";
  const border = "hsl(var(--border))";

  return (
    <div className="flex justify-center w-full overflow-visible">
      <svg
        viewBox="0 0 360 260"
        className="w-full max-w-md"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker id="flywheel-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
            <path d="M0,0 L0,8 L8,4 z" fill={muted} />
          </marker>
        </defs>

        {/* Center: AI decisioning loop */}
        <text x="180" y="128" textAnchor="middle" fontSize="12" fontWeight="600" fill={muted}>
          AI decisioning loop
        </text>

        {/* Top: Nexus */}
        <rect x="140" y="8" width="80" height="36" rx="8" fill="#8b5cf6" fillOpacity="0.15" stroke="#8b5cf6" strokeWidth="2" />
        <text x="180" y="30" textAnchor="middle" fontSize="11" fontWeight="700" fill="#8b5cf6">Nexus</text>

        {/* Right: Marketing automation platform */}
        <rect x="268" y="88" width="84" height="36" rx="8" fill="#f97316" fillOpacity="0.15" stroke="#f97316" strokeWidth="2" />
        <text x="310" y="105" textAnchor="middle" fontSize="9" fontWeight="600" fill="#f97316">Marketing</text>
        <text x="310" y="116" textAnchor="middle" fontSize="9" fontWeight="600" fill="#f97316">automation</text>

        {/* Bottom: Identified customers */}
        <rect x="140" y="216" width="80" height="36" rx="8" fill="#22c55e" fillOpacity="0.15" stroke="#22c55e" strokeWidth="2" />
        <text x="180" y="236" textAnchor="middle" fontSize="10" fontWeight="600" fill="#22c55e">Identified</text>
        <text x="180" y="247" textAnchor="middle" fontSize="10" fontWeight="600" fill="#22c55e">customers</text>

        {/* Left: Warehouse or CDP */}
        <rect x="8" y="88" width="84" height="36" rx="8" fill="#a855f7" fillOpacity="0.15" stroke="#a855f7" strokeWidth="2" />
        <text x="50" y="105" textAnchor="middle" fontSize="9" fontWeight="600" fill="#a855f7">Warehouse</text>
        <text x="50" y="116" textAnchor="middle" fontSize="9" fontWeight="600" fill="#a855f7">or CDP</text>

        {/* Arrows with labels */}
        {/* Nexus → Marketing automation */}
        <path d="M 180 44 L 180 70 L 268 106" fill="none" stroke={border} strokeWidth="1.5" markerEnd="url(#flywheel-arrow)" />
        <text x="200" y="75" fontSize="8" fill={muted}>Daily customer-level</text>
        <text x="200" y="84" fontSize="8" fill={muted}>decisions</text>

        {/* Marketing automation → Identified customers */}
        <path d="M 310 124 L 310 170 L 180 216" fill="none" stroke={border} strokeWidth="1.5" markerEnd="url(#flywheel-arrow)" />
        <text x="280" y="155" fontSize="8" fill={muted}>Communications</text>

        {/* Identified customers → Warehouse or CDP */}
        <path d="M 180 216 L 50 124" fill="none" stroke={border} strokeWidth="1.5" markerEnd="url(#flywheel-arrow)" />
        <text x="100" y="185" fontSize="8" fill={muted}>Interactions</text>

        {/* Warehouse or CDP → Nexus */}
        <path d="M 50 106 L 50 70 L 140 44" fill="none" stroke={border} strokeWidth="1.5" markerEnd="url(#flywheel-arrow)" />
        <text x="50" y="55" fontSize="8" fill={muted}>First-party data</text>
        <text x="50" y="64" fontSize="8" fill={muted}>(daily feed)</text>
      </svg>
    </div>
  );
}
