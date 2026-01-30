import InteractiveHeroBanner from "@/components/InteractiveHeroBanner";

const COPPER_STOPS = [
  "#FFF1E6",
  "#FFD7BA",
  "#FFB48F",
  "#F28F3B",
  "#C8553D",
  "#6F1D1B",
];

const COPPER_CONTROLS = {
  hoverStrength: 1.2,
  hoverRadius: 0.2,
  clickStrength: 1,
  spring: 1.2,
  damping: 1.5,
  timeScale: 1,
  shardSpread: 1.7,
  settleTime: 1.9,
  floatStrength: 0.9,
  floatDrag: 0.6,
  floatDurationMs: 200,
  returnSpring: 1.1,
  settleDamping: 2.0,
  explosionForce: 1.4,
  explosionSpin: 1.2,
  explosionDurationMs: 1450,
  fractureStaggerMsMax: 20,
  wallRestitution: 0.2,
  wallFriction: 0.2,
  wallSpinDamping: 0.1,
};

const Embed = () => {
  return (
    <div className="min-h-screen bg-transparent flex items-center justify-center p-0">
      <div className="w-full max-w-[1312px] mx-auto">
        <InteractiveHeroBanner
          colorStops={COPPER_STOPS}
          initialControls={COPPER_CONTROLS}
          persistControls={false}
        />
      </div>
    </div>
  );
};

export default Embed;
