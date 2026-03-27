import { useEffect } from "react";
import InteractiveHeroBanner, { DEFAULT_CONTROLS } from "@/components/InteractiveHeroBanner";

const HAZE_STOPS = [
  "#FFD166",
  "#FF9E64",
  "#FF6E91",
  "#D490D4",
  "#8ABFFF",
  "#A5F3FC",
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
          colorStops={HAZE_STOPS}
          initialControls={DEFAULT_CONTROLS}
          persistControls={false}
        />
      </div>
    </div>
  );
};

export default Embed;
