import InteractiveHeroBanner, { ControlSlider, PRESET_INFO, type ControlPanelProps } from '@/components/InteractiveHeroBanner';

const ControlPanel = ({
  controls,
  updateControl,
  onReset,
  isPaused,
  setIsPaused
}: ControlPanelProps) => (
  <div className="mt-6 p-4 rounded-xl text-xs" style={{
    background: 'rgba(15, 15, 15, 0.9)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)'
  }}>
    <div className="flex flex-wrap gap-4 items-start">
      {/* Hover Controls */}
      <div className="min-w-[140px] flex-1">
        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Hover</label>
        <div className="space-y-1">
          <ControlSlider label="Strength" value={controls.hoverStrength} onChange={v => updateControl('hoverStrength', v)} min={0} max={3} />
          <ControlSlider label="Radius" value={controls.hoverRadius} onChange={v => updateControl('hoverRadius', v)} min={0.1} max={1} />
        </div>
      </div>

      {/* Physics Controls */}
      <div className="min-w-[140px] flex-1">
        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Physics</label>
        <div className="space-y-1">
          <ControlSlider label="Spring" value={controls.spring} onChange={v => updateControl('spring', v)} min={0.1} max={2} />
          <ControlSlider label="Damping" value={controls.damping} onChange={v => updateControl('damping', v)} min={0.1} max={2} />
        </div>
      </div>

      {/* Shatter controls */}
      <div className="min-w-[140px] flex-1">
        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Shatter</label>
        <div className="space-y-1">
          <ControlSlider label="Spread" value={controls.shardSpread} onChange={v => updateControl('shardSpread', v)} min={0.1} max={3} />
          <ControlSlider label="Force" value={controls.explosionForce} onChange={v => updateControl('explosionForce', v)} min={0.3} max={3} />
          <ControlSlider label="Spin" value={controls.explosionSpin} onChange={v => updateControl('explosionSpin', v)} min={0} max={3} />
        </div>
      </div>

      {/* Settle controls */}
      <div className="min-w-[140px] flex-1">
        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Settle</label>
        <div className="space-y-1">
          <ControlSlider label="Delay" value={controls.settleTime} onChange={v => updateControl('settleTime', v)} min={0} max={5} />
          <ControlSlider label="Speed" value={controls.returnSpring} onChange={v => updateControl('returnSpring', v)} min={0.5} max={5} />
          <ControlSlider label="Ease" value={controls.settleDamping} onChange={v => updateControl('settleDamping', v)} min={0} max={2} />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-1.5 min-w-[70px]">
        <button onClick={onReset} className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] uppercase tracking-wider transition-colors">
          Reset
        </button>
        <button onClick={() => setIsPaused(!isPaused)} className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] uppercase tracking-wider transition-colors">
          {isPaused ? 'Play' : 'Pause'}
        </button>
      </div>
    </div>
  </div>
);

const Index = () => {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-[1312px]">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-light tracking-tight text-foreground mb-2">
            Interactive Hero Banner
          </h1>
          <p className="text-sm text-muted-foreground">
            Click on shapes to shatter them. Click fragments to break them further. Wait to see them spring back.
          </p>
        </div>

        {/* Banner with external controls */}
        <InteractiveHeroBanner renderControls={props => <ControlPanel {...props} />} />
      </div>
    </div>
  );
};

export default Index;