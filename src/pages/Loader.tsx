import { useState, useEffect } from "react";
import InteractiveHeroBanner from "@/components/InteractiveHeroBanner";
import type { Controls } from "@/components/InteractiveHeroBanner";

const AQUA_MIST_STOPS = [
  "#262248",
  "#213569",
  "#31778C",
  "#5BC0BE",
  "#9EE493",
  "#F6F740",
];

// Start gentle — escalated via liveControls steps below
const LOADER_CONTROLS: Partial<Controls> = {
  hoverStrength: 0,
  hoverRadius: 0,
  clickStrength: 1,
  spring: 1.2,
  damping: 1.5,
  timeScale: 0.5,
  shardSpread: 1.0,
  settleTime: 999,
  floatStrength: 1.2,
  floatDrag: 0.4,
  floatDurationMs: 9999,
  returnSpring: 1.4,
  settleDamping: 1.8,
  explosionForce: 1.5,
  explosionSpin: 2.0,
  explosionDurationMs: 2000,
  fractureStaggerMsMax: 40,
  wallRestitution: 0.82,
  wallFriction: 0.04,
  wallSpinDamping: 0.02,
  disableWalls: false,
};

// Escalation timeline — each step sets liveControls then re-triggers explosion
const STEPS: { t: number; liveControls: Partial<Controls> }[] = [
  { t: 500,  liveControls: { explosionForce: 1.5,  timeScale: 0.5, disableWalls: false, explosionDurationMs: 2000 } },
  { t: 1100, liveControls: { explosionForce: 2.5,  timeScale: 0.7, disableWalls: false, explosionDurationMs: 2000 } },
  { t: 1700, liveControls: { explosionForce: 4.0,  timeScale: 0.9, disableWalls: false, explosionDurationMs: 2000 } },
  { t: 2300, liveControls: { explosionForce: 6.5,  timeScale: 1.1, disableWalls: false, explosionDurationMs: 2000 } },
  // Final blast: massive force, walls off, long duration so pieces keep flying through the fade
  { t: 2900, liveControls: { explosionForce: 35.0, timeScale: 2.0, disableWalls: true,  explosionDurationMs: 8000 } },
];

const T_FADE = 3500;
const T_DONE = 4500;

type Phase = "enter" | "explode" | "fade" | "done";

export default function Loader() {
  const [phase, setPhase] = useState<Phase>("enter");
  const [triggerExplode, setTriggerExplode] = useState(false);
  const [liveControls, setLiveControls] = useState<Partial<Controls>>({});

  useEffect(() => {
    document.body.style.background = "hsl(var(--background))";
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";

    const timers: ReturnType<typeof setTimeout>[] = [];

    // Escalation steps — each sets new physics then re-fires explosion
    STEPS.forEach(({ t, liveControls: stepControls }) => {
      timers.push(
        setTimeout(() => {
          setPhase("explode");
          setLiveControls(stepControls);
          setTriggerExplode(false);
          setTimeout(() => setTriggerExplode(true), 50);
        }, t)
      );
    });

    timers.push(setTimeout(() => setPhase("fade"), T_FADE));
    timers.push(
      setTimeout(() => {
        setPhase("done");
        window.parent.postMessage("loader-done", "*");
      }, T_DONE)
    );

    return () => {
      timers.forEach(clearTimeout);
      document.body.style.background = "";
      document.body.style.overflow = "";
    };
  }, []);

  const isFading = phase === "fade" || phase === "done";

  return (
    <>
      <style>{`
        @keyframes bannerEnter {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>

      {/* Full-screen overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "hsl(var(--background))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: isFading ? "opacity 0.6s ease" : "none",
          opacity: phase === "done" ? 0 : 1,
          pointerEvents: phase === "done" ? "none" : "auto",
          zIndex: 9999,
        }}
      >
        {/* Banner wrapper */}
        <div
          style={{
            width: "100%",
            animation:
              phase === "enter"
                ? "bannerEnter 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards"
                : "none",
          }}
        >
          <InteractiveHeroBanner
            colorStops={AQUA_MIST_STOPS}
            initialControls={LOADER_CONTROLS}
            persistControls={false}
            triggerExplode={triggerExplode}
            fillViewport={true}
            liveControls={liveControls}
          />
        </div>
      </div>
    </>
  );
}
