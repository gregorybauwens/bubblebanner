import { useEffect } from "react";
import InteractiveHeroBanner from "@/components/InteractiveHeroBanner";

const RAINBOW_STOPS = [
  "#FF5F6D",
  "#FFC371",
  "#FDEB71",
  "#C0F2D8",
  "#8EC5FC",
  "#E0C3FC",
];

const RAINBOW_CONTROLS = {
  hoverStrength: 1.2,
  hoverRadius: 0.2,
  clickStrength: 1,
  spring: 1.2,
  damping: 1.5,
  timeScale: 1,
  shardSpread: 0.6,
  settleTime: 1.9,
  floatStrength: 0.9,
  floatDrag: 0.6,
  floatDurationMs: 200,
  returnSpring: 1.1,
  settleDamping: 2.0,
  explosionForce: 1.8,
  explosionSpin: 2.2,
  explosionDurationMs: 1300,
  fractureStaggerMsMax: 80,
  wallRestitution: 0.7,
  wallFriction: 0.2,
  wallSpinDamping: 0.1,
};

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
          colorStops={RAINBOW_STOPS}
          initialControls={RAINBOW_CONTROLS}
          persistControls={false}
        />
      </div>
    </div>
  );
};

export default Embed;
