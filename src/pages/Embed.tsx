import { useEffect } from "react";
import InteractiveHeroBanner, { DEFAULT_CONTROLS } from "@/components/InteractiveHeroBanner";

const GRAPE_MIST_III_CONTROLS = {
  ...DEFAULT_CONTROLS,
  hoverStrength: 1.6,
  hoverRadius: 0.2,
};

const GRAPE_MIST_III_STOPS = [
  "#FAA16E",
  "#FAC26E",
  "#65C1CE",
  "#C76CDB",
  "#838383",
  "#E0DEDE",
];

const Embed = () => {
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = "transparent";
    return () => {
      document.body.style.background = prev;
    };
  }, []);

  return (
    <div className="min-h-screen bg-transparent flex items-center justify-center p-0">
      <div className="w-full max-w-[1312px] mx-auto">
        <InteractiveHeroBanner
          colorStops={GRAPE_MIST_III_STOPS}
          initialControls={GRAPE_MIST_III_CONTROLS}
          persistControls={false}
          introBounce
          introBounceDelayMs={0}
          introBounceDurationMs={920}
        />
      </div>
    </div>
  );
};

export default Embed;
