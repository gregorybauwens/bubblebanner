import InteractiveHeroBanner from "@/components/InteractiveHeroBanner";

const SUNSET_TIDE_STOPS = [
  "#F0D0BD",
  "#E6A882",
  "#E19B48",
  "#E58642",
  "#C8553D",
  "#6F1D1B",
];

const SUNSET_TIDE_CONTROLS = {
  hoverStrength: 1.2,
  hoverRadius: 0.2,
  clickStrength: 1,
  spring: 1.2,
  damping: 2.0,
  timeScale: 1,
  shardSpread: 1.1,
  settleTime: 0.3,
  returnSpring: 2.8,
  settleDamping: 2.0,
  explosionForce: 0.9,
  explosionSpin: 1.2,
};

const Embed = () => {
  return (
    <div className="min-h-screen bg-transparent flex items-center justify-center p-0">
      <div className="w-full max-w-[1312px] mx-auto">
        <InteractiveHeroBanner
          colorStops={SUNSET_TIDE_STOPS}
          initialControls={SUNSET_TIDE_CONTROLS}
          persistControls={false}
        />
      </div>
    </div>
  );
};

export default Embed;
