import type { Grid } from "@/lib/gridBanner/grid";

interface GridGuidesProps {
  grid: Grid;
  /** Horizontal offset of grid x = 0 inside the positioned parent. */
  offsetX?: number;
  /** Lines to draw at full strength. Defaults to the margins, label column and content line. */
  highlight?: number[];
}

const key = (x: number) => x.toFixed(2);

/** Cyan guide lines like Framer's, on every vertical grid line. */
const GridGuides = ({ grid, offsetX = 0, highlight }: GridGuidesProps) => {
  const strong = new Set((highlight ?? [0, grid.columnEnd, grid.contentStart, grid.w]).map(key));

  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      {grid.lines.map((x) => (
        <div
          key={x}
          className="absolute inset-y-0 w-px"
          style={{
            left: offsetX + x - 0.5,
            background: strong.has(key(x)) ? "rgba(0, 190, 240, 0.9)" : "rgba(0, 190, 240, 0.3)",
          }}
        />
      ))}
    </div>
  );
};

export default GridGuides;
