/**
 * The home hero's circuit-board illustration: a chip at the centre, traces running out to the lab's
 * focus areas. Drawn with the design tokens (styles in pages.css), decorative only, and still unless
 * the visitor allows motion — then a single signal pulse travels along one trace.
 */
const PINS = [0, 1, 2, 3, 4, 5, 6];

export function HeroCircuit() {
  return (
    <svg className="circuit" viewBox="0 0 460 400" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <g className="circuit__grid">
        {[60, 120, 180, 240, 300, 360, 420].map((x) => (
          <line key={`v${x}`} x1={x} y1={0} x2={x} y2={400} />
        ))}
        {[50, 100, 150, 200, 250, 300, 350].map((y) => (
          <line key={`h${y}`} x1={0} y1={y} x2={460} y2={y} />
        ))}
      </g>

      <g className="circuit__trace">
        <path d="M86 200H30" />
        <path d="M86 240H60V300H150" />
        <path d="M374 200H430" />
        <path d="M374 160H410V100H320V50" />
        <path d="M374 240H400V310H300" />
        <path d="M150 160H120V90H230V40" />
        <path className="circuit__signal" d="M150 160H120V90H230V40" />
      </g>

      <g className="circuit__node">
        <circle cx={30} cy={200} r={4} />
        <circle cx={150} cy={300} r={4} />
        <circle cx={430} cy={200} r={4} />
        <circle cx={320} cy={50} r={4} />
        <circle cx={300} cy={310} r={4} />
        <circle cx={230} cy={40} r={4} />
        <circle cx={120} cy={90} r={3} />
        <circle cx={410} cy={100} r={3} />
      </g>

      <g className="circuit__pins">
        {PINS.map((i) => {
          const p = 118 + i * 20;
          return (
            <g key={i}>
              <line x1={p} y1={128} x2={p} y2={112} />
              <line x1={p} y1={272} x2={p} y2={288} />
            </g>
          );
        })}
        {[0, 1, 2, 3, 4].map((i) => {
          const p = 152 + i * 24;
          return (
            <g key={i}>
              <line x1={90} y1={p} x2={106} y2={p} />
              <line x1={354} y1={p} x2={370} y2={p} />
            </g>
          );
        })}
      </g>

      <rect className="circuit__chip" x={106} y={128} width={248} height={144} rx={8} />
      <rect className="circuit__die" x={130} y={150} width={200} height={100} rx={4} />
      <text className="circuit__chip-text" x={230} y={206} textAnchor="middle">
        SCL
      </text>
      <text className="circuit__chip-sub" x={230} y={228} textAnchor="middle">
        SMART COMPUTING
      </text>

      <g className="circuit__labels">
        <text x={30} y={186} textAnchor="start">
          AI
        </text>
        <text x={150} y={324} textAnchor="middle">
          FPGA
        </text>
        <text x={430} y={186} textAnchor="end">
          ML
        </text>
        <text x={320} y={38} textAnchor="middle">
          SAT
        </text>
        <text x={300} y={334} textAnchor="middle">
          DATA
        </text>
        <text x={230} y={28} textAnchor="middle">
          DSP
        </text>
      </g>
    </svg>
  );
}
