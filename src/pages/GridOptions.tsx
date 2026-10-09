import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import GridGuides from "@/components/GridGuides";
import { useElementWidth } from "@/hooks/use-element-width";
import { planFor } from "@/lib/gridBanner/compose";
import { FRAMER_IFRAME_HEIGHT, getGrid, gridConfigFromSearch, type Grid } from "@/lib/gridBanner/grid";
import { GRID_BANNER_OPTIONS } from "@/lib/gridBanner/options";

/**
 * Side-by-side review of the grid-aligned banner options. Each row rebuilds a
 * slice of the portfolio homepage at a simulated viewport width: the banner
 * iframe at its real size, the Projects row underneath, and the grid guides.
 */

const PRODUCTION_ORIGIN = "https://bubblebanner.vercel.app";
const PAGE_MARGIN = 20;
const MAX_CONTAINER = 1440;
const VIEWPORT_PRESETS = [1440, 1280, 1200, 1000, 810, 390];

const iframeWidthFor = (viewport: number) => Math.min(viewport, MAX_CONTAINER) - PAGE_MARGIN * 2;

interface Row {
  id: string;
  name: string;
  pitch: string;
  locks: string;
  embedPath: string;
  snapLines: (grid: Grid) => number[];
}

const LIVE_ROW: Row = {
  id: "live",
  name: "Live today",
  pitch: "What gregorybauwens.com shows right now. The big pill ends between grid lines.",
  locks: "Left and right margins only.",
  embedPath: "/embed",
  snapLines: (grid) => [0, grid.w],
};

const cardHeightFor = (grid: Grid) => Math.round((grid.cards[0][1] - grid.cards[0][0]) * 0.42);
const projectsRowHeight = (grid: Grid) => cardHeightFor(grid) + 64;

const ProjectsRow = ({ grid }: { grid: Grid }) => {
  const cards = grid.hasColumns ? grid.cards : grid.cards.slice(0, 1);
  const cardHeight = cardHeightFor(grid);
  return (
    <div className="relative border-t border-[rgba(209,209,209,0.92)]" style={{ height: projectsRowHeight(grid) }}>
      {grid.hasColumns && (
        <div
          className="absolute top-8 text-[26px] leading-none tracking-[-0.5px] text-[#050505]"
          style={{ left: PAGE_MARGIN }}
        >
          Projects
        </div>
      )}
      {cards.map(([left, right], i) => (
        <div
          key={i}
          className="absolute top-8 rounded-[2px] bg-[#F0F0F0]"
          style={{ left: PAGE_MARGIN + left, width: right - left, height: cardHeight }}
        />
      ))}
    </div>
  );
};

const OptionRow = ({
  row,
  viewport,
  showGuides,
  search,
  replayKey,
}: {
  row: Row;
  viewport: number;
  showGuides: boolean;
  search: string;
  replayKey: number;
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const available = useElementWidth(stageRef);
  const config = useMemo(() => gridConfigFromSearch(new URLSearchParams(search)), [search]);
  const iframeWidth = iframeWidthFor(viewport);
  const grid = getGrid(iframeWidth, config);
  const iframeHeight = FRAMER_IFRAME_HEIGHT[grid.breakpoint];
  const containerWidth = iframeWidth + PAGE_MARGIN * 2;
  const scale = available > 0 ? Math.min(1, available / containerWidth) : 1;
  const query = search ? `?${search}` : "";
  // The simulated page has no scrollbar, so the embed should not assume one either.
  const src = `${window.location.pathname}#${row.embedPath}?${search ? `${search}&` : ""}scrollbar=0`;
  const productionUrl = `${PRODUCTION_ORIGIN}/#${row.embedPath}${query}`;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(productionUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard can be blocked; the URL is still visible on hover.
    }
  };

  return (
    <section className="border-t border-[rgba(209,209,209,0.92)] py-8">
      <div className="mb-5 grid gap-x-10 gap-y-2 md:grid-cols-[minmax(0,27%)_minmax(0,1fr)_auto] md:items-baseline">
        <h2 className="text-[17px] font-medium text-[#050505]">{row.name}</h2>
        <div className="max-w-[60ch] text-[15px] leading-[22px] text-[#050505]">
          {row.pitch}
          <div className="mt-1 text-[13px] leading-[18px] text-[#878787]">Locks: {row.locks}</div>
        </div>
        <div className="flex gap-4 text-[13px] text-[#878787]">
          <a className="hover:text-[#050505]" href={`#${row.embedPath}${query ? `${query}&` : "?"}guides=1`} target="_blank" rel="noreferrer">
            Open ↗
          </a>
          <button className="hover:text-[#050505]" onClick={copy} title={productionUrl}>
            {copied ? "Copied" : "Copy embed URL"}
          </button>
        </div>
      </div>

      <div ref={stageRef} className="w-full overflow-hidden">
        <div style={{ height: (iframeHeight + projectsRowHeight(grid)) * scale }}>
          <div
            className="relative origin-top-left bg-[#FAFAFA]"
            style={{ width: containerWidth, transform: `scale(${scale})` }}
          >
            <iframe
              key={`${row.id}-${replayKey}`}
              title={row.name}
              src={src}
              className="block border-0"
              style={{ marginLeft: PAGE_MARGIN, width: iframeWidth, height: iframeHeight }}
            />
            <ProjectsRow grid={grid} />
            {showGuides && <GridGuides grid={grid} offsetX={PAGE_MARGIN} highlight={row.snapLines(grid)} />}
          </div>
        </div>
      </div>
    </section>
  );
};

const GridOptions = () => {
  const [params] = useSearchParams();
  const search = useMemo(() => {
    const forwarded = new URLSearchParams(params);
    forwarded.delete("vw");
    return forwarded.toString();
  }, [params]);
  const [viewport, setViewport] = useState(() => Number(params.get("vw")) || 1200);
  const [showGuides, setShowGuides] = useState(true);
  const [replayKey, setReplayKey] = useState(0);
  const grid = getGrid(iframeWidthFor(viewport), gridConfigFromSearch(new URLSearchParams(search)));

  const rows: Row[] = [
    LIVE_ROW,
    ...GRID_BANNER_OPTIONS.filter((option) => option.id !== "classic").map((option) => ({
      id: option.id,
      name: option.name,
      pitch: option.pitch,
      locks: option.locks,
      embedPath: `/embed-grid/${option.id}`,
      snapLines: (grid: Grid) => planFor(option, grid).snapLines,
    })),
  ];

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-[#050505] antialiased">
      <header className="sticky top-0 z-20 border-b border-[rgba(209,209,209,0.92)] bg-[rgba(250,250,250,0.94)] backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
          <div className="mr-auto">
            <div className="text-[17px] font-medium">Bubble banner on the grid</div>
            <div className="text-[13px] text-[#878787]">
              Viewport {viewport}px · iframe {Math.round(grid.w)}px · {grid.breakpoint}
              {grid.hasColumns && ` · content line at ${(grid.contentStart + PAGE_MARGIN).toFixed(1)}px`}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1 text-[13px]">
            {VIEWPORT_PRESETS.map((preset) => (
              <button
                key={preset}
                onClick={() => setViewport(preset)}
                className={`rounded-full px-3 py-1 tabular-nums transition-colors ${
                  viewport === preset ? "bg-[#050505] text-white" : "text-[#878787] hover:text-[#050505]"
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
          <input
            aria-label="Viewport width"
            type="range"
            min={360}
            max={1680}
            step={1}
            value={viewport}
            onChange={(e) => setViewport(Number(e.target.value))}
            className="w-40"
          />
          <label className="flex items-center gap-2 text-[13px] text-[#878787]">
            <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} />
            Guides
          </label>
          <button className="text-[13px] text-[#878787] hover:text-[#050505]" onClick={() => setReplayKey((k) => k + 1)}>
            Replay intro
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 pb-24">
        {rows.map((row) => (
          <OptionRow
            key={row.id}
            row={row}
            viewport={viewport}
            showGuides={showGuides}
            search={search}
            replayKey={replayKey}
          />
        ))}
      </main>
    </div>
  );
};

export default GridOptions;
