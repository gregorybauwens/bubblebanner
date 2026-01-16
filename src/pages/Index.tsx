import InteractiveHeroBanner from '@/components/InteractiveHeroBanner';

const Index = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-50 to-stone-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-[1312px]">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-light tracking-tight text-neutral-800 mb-2">
            Interactive Hero Banner
          </h1>
          <p className="text-sm text-neutral-500">
            Click anywhere on the banner to trigger effects. Hover for subtle interactions.
          </p>
        </div>

        {/* Banner */}
        <InteractiveHeroBanner />

        {/* Instructions */}
        <div className="mt-8 text-center">
          <p className="text-xs text-neutral-400 max-w-xl mx-auto">
            Use the control panel to switch between presets and adjust parameters. 
            Try <strong>Bubble</strong> for organic effects, <strong>Voronoi Shatter</strong> for fracturing, 
            <strong> Magnetic Field</strong> for orbiting motion, or <strong>Wave Interference</strong> for scanning patterns.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Index;
