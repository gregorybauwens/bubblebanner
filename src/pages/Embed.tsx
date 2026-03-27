import { useEffect } from "react";
import InteractiveHeroBanner, { DEFAULT_CONTROLS } from "@/components/InteractiveHeroBanner";

const GRAPE_MIST_III_CONTROLS = {
  ...DEFAULT_CONTROLS,
  hoverStrength: 1.6,
  hoverRadius: 0.2,
};

const GRAPE_MIST_III_STOPS = [
  "#D06E4D",
  "#C05454",
  "#BD6385",
  "#0BB8C0",
  "#078FCB",
  "#7174CA",
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
        />
      </div>
    </div>
  );
};

export default Embed;
