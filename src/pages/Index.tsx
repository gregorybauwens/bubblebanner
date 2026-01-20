import InteractiveHeroBanner, { ControlSlider, DEFAULT_COLOR_STOPS, type ControlPanelProps } from "@/components/InteractiveHeroBanner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMemo, useState } from "react";
import { HexColorPicker } from "react-colorful";

const ControlPanel = ({
  controls,
  updateControl,
  onReset,
  isPaused,
  setIsPaused,
}: ControlPanelProps) => (
  <div
    className="mt-6 p-4 rounded-xl text-xs"
    style={{
      background: "rgba(15, 15, 15, 0.9)",
      backdropFilter: "blur(12px)",
      border: "1px solid rgba(255, 255, 255, 0.08)",
      boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
    }}
  >
    <div className="flex flex-wrap gap-4 items-start">
      {/* Hover Controls */}
      <div className="min-w-[180px] flex-1">
        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Hover</label>
        <div className="space-y-1">
          <ControlSlider label="Strength" value={controls.hoverStrength} onChange={(v) => updateControl("hoverStrength", v)} min={0} max={3} />
          <ControlSlider label="Radius" value={controls.hoverRadius} onChange={(v) => updateControl("hoverRadius", v)} min={0.1} max={1} />
        </div>
      </div>

      {/* Physics Controls */}
      <div className="min-w-[180px] flex-1">
        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Physics</label>
        <div className="space-y-1">
          <ControlSlider label="Spring" value={controls.spring} onChange={(v) => updateControl("spring", v)} min={0.1} max={2} />
          <ControlSlider label="Damping" value={controls.damping} onChange={(v) => updateControl("damping", v)} min={0.1} max={2} />
        </div>
      </div>

      {/* Shatter controls */}
      <div className="min-w-[180px] flex-1">
        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Shatter</label>
        <div className="space-y-1">
          <ControlSlider label="Spread" value={controls.shardSpread} onChange={(v) => updateControl("shardSpread", v)} min={0.1} max={3} />
          <ControlSlider label="Force" value={controls.explosionForce} onChange={(v) => updateControl("explosionForce", v)} min={0.3} max={3} />
          <ControlSlider label="Spin" value={controls.explosionSpin} onChange={(v) => updateControl("explosionSpin", v)} min={0} max={3} />
        </div>
      </div>

      {/* Settle controls */}
      <div className="min-w-[180px] flex-1">
        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Settle</label>
        <div className="space-y-1">
          <ControlSlider label="Delay" value={controls.settleTime} onChange={(v) => updateControl("settleTime", v)} min={0} max={5} />
          <ControlSlider label="Speed" value={controls.returnSpring} onChange={(v) => updateControl("returnSpring", v)} min={0.5} max={5} />
          <ControlSlider label="Ease" value={controls.settleDamping} onChange={(v) => updateControl("settleDamping", v)} min={0} max={2} />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-1.5 min-w-[90px]">
        <button onClick={onReset} className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] uppercase tracking-wider transition-colors">
          Reset
        </button>
        <button onClick={() => setIsPaused(!isPaused)} className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] uppercase tracking-wider transition-colors">
          {isPaused ? "Play" : "Pause"}
        </button>
      </div>
    </div>
  </div>
);

const Index = () => {
  const [colorStops, setColorStops] = useState<string[]>(DEFAULT_COLOR_STOPS);
  const [openPickerIndex, setOpenPickerIndex] = useState<number | null>(null);
  const normalizedStops = useMemo(
    () => colorStops.map((stop) => stop.trim().toUpperCase()),
    [colorStops]
  );
  const colorPresets = useMemo(
    () => [
      { name: "Original", stops: DEFAULT_COLOR_STOPS },
      { name: "Sunset", stops: ["#FFD166", "#FCA311", "#F77F00", "#F25C54", "#D62828", "#A4161A"] },
      { name: "Citrus", stops: ["#FFF3B0", "#FFD166", "#F4D35E", "#EE964B", "#F95738", "#EE6C4D"] },
      { name: "Ember", stops: ["#FFEA00", "#FFB703", "#FB8500", "#F48C06", "#E85D04", "#9D0208"] },
      { name: "Coral", stops: ["#FFE5D9", "#FFCAD4", "#F4ACB7", "#F08080", "#E85D75", "#D1495B"] },
      { name: "Ocean", stops: ["#E0FBFC", "#98C1D9", "#3D5A80", "#2E4F6E", "#1B3A57", "#0B132B"] },
    ],
    []
  );

  return (
    <div className="min-h-screen bg-transparent flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-[1312px]">
        <InteractiveHeroBanner
          colorStops={normalizedStops}
          renderControls={(props) => <ControlPanel {...props} />}
        />
        <div
          className="mt-4 p-4 rounded-xl text-xs"
          style={{
            background: "rgba(15, 15, 15, 0.9)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
          }}
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500">Presets</span>
              {colorPresets.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => setColorStops(preset.stops)}
                  className="px-2 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] uppercase tracking-wider transition-colors"
                >
                  {preset.name}
                </button>
              ))}
              <button
                onClick={() => setColorStops([...normalizedStops].reverse())}
                className="px-2 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] uppercase tracking-wider transition-colors"
              >
                Reverse
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500">Colors</span>
            {normalizedStops.map((stop, index) => (
              <Popover
                key={`${stop}-${index}`}
                open={openPickerIndex === index}
                onOpenChange={(open) => setOpenPickerIndex(open ? index : null)}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-md border border-white/10 bg-transparent px-2 py-1 hover:border-white/30"
                  >
                    <span
                      className="h-6 w-6 rounded border border-white/10"
                      style={{ backgroundColor: stop }}
                    />
                    <span className="text-[10px] text-neutral-400">{stop}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  sideOffset={8}
                  className="w-60 p-3"
                >
                  <div className="space-y-3">
                    <HexColorPicker
                      color={stop}
                      onChange={(value) => {
                        const next = [...normalizedStops];
                        next[index] = value.toUpperCase();
                        setColorStops(next);
                      }}
                    />
                    <input
                      value={stop}
                      onChange={(event) => {
                        const value = event.target.value.toUpperCase();
                        if (!/^#([0-9A-F]{0,6})$/.test(value)) return;
                        const next = [...normalizedStops];
                        next[index] = value;
                        setColorStops(next);
                      }}
                      className="w-full rounded-md border border-white/10 bg-transparent px-2 py-1 text-[11px] text-neutral-200"
                    />
                  </div>
                </PopoverContent>
              </Popover>
            ))}
            <button
              onClick={() => setColorStops(DEFAULT_COLOR_STOPS)}
              className="ml-auto px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] uppercase tracking-wider transition-colors"
            >
              Reset Colors
            </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;