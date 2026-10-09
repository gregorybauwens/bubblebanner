import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import InteractiveHeroBanner, { DEFAULT_CONTROLS } from "@/components/InteractiveHeroBanner";
import GridGuides from "@/components/GridGuides";
import { useElementWidth } from "@/hooks/use-element-width";
import { composeBannerSvg, planFor } from "@/lib/gridBanner/compose";
import { getGrid, gridConfigFromSearch, measureScrollbarWidth } from "@/lib/gridBanner/grid";
import { getGridBannerOption } from "@/lib/gridBanner/options";

/**
 * Grid-aligned variant of /embed. The layout is rebuilt from the iframe's own
 * width, so shape edges stay on the Framer grid lines at every viewport.
 *
 *   /#/embed2                            the chosen option (Column Snap), for Framer
 *   /#/embed-grid/<option>               any option
 *   ?guides=1                            draw the grid on top
 *   ?scrollbar=0                         override the measured scrollbar width
 */
const EmbedGrid = ({ variant }: { variant?: string }) => {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const search = searchParams.toString();
  const option = getGridBannerOption(variant ?? params.variant);
  const config = useMemo(() => gridConfigFromSearch(new URLSearchParams(search)), [search]);
  const showGuides = searchParams.get("guides") === "1";
  const scrollbarParam = searchParams.get("scrollbar");
  const [measuredScrollbar] = useState(measureScrollbarWidth);
  const scrollbar = scrollbarParam !== null && Number.isFinite(Number(scrollbarParam)) ? Number(scrollbarParam) : measuredScrollbar;

  const frameRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(frameRef);
  const grid = useMemo(() => (width > 0 ? getGrid(width, config, scrollbar) : null), [width, config, scrollbar]);
  const svgMarkup = useMemo(() => (grid ? composeBannerSvg(option, grid) : null), [grid, option]);

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = "transparent";
    return () => {
      document.body.style.background = prev;
    };
  }, []);

  return (
    <div className="min-h-screen bg-transparent flex items-center justify-center overflow-visible">
      <div ref={frameRef} className="w-full max-w-[1440px] mx-auto overflow-visible">
        {svgMarkup && (
          <InteractiveHeroBanner
            svgMarkup={svgMarkup}
            initialControls={DEFAULT_CONTROLS}
            persistControls={false}
            introBounce
            introBounceDelayMs={0}
          />
        )}
      </div>
      {showGuides && grid && (
        <div className="pointer-events-none fixed inset-0">
          <div className="relative mx-auto h-full w-full max-w-[1440px]">
            <GridGuides grid={grid} highlight={planFor(option, grid).snapLines} />
          </div>
        </div>
      )}
    </div>
  );
};

export default EmbedGrid;
