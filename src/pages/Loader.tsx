import { useState, useEffect } from "react";
import InteractiveHeroBanner from "@/components/InteractiveHeroBanner";

const AQUA_MIST_STOPS = [
  "#262248",
  "#213569",
  "#31778C",
  "#5BC0BE",
  "#9EE493",
  "#F6F740",
];

// settleTime is very high so pieces never reassemble during the animation
const LOADER_CONTROLS = {
  hoverStrength: 0,
  hoverRadius: 0,
  clickStrength: 1,
  spring: 1.2,
  damping: 1.5,
  timeScale: 1,
  shardSpread: 0.9,
  settleTime: 999,
  floatStrength: 1.2,
  floatDrag: 0.4,
  floatDurationMs: 9999,
  returnSpring: 1.4,
  settleDamping: 1.8,
  explosionForce: 2.4,
  explosionSpin: 3.0,
  explosionDurationMs: 1200,
  fractureStaggerMsMax: 60,
  wallRestitution: 0.65,
  wallFriction: 0.18,
  wallSpinDamping: 0.08,
};

type Phase = "enter" | "jitter" | "explode" | "fade" | "done";

// Timeline (ms) — pieces stay scattered, overlay just fades out
const T = {
  jitter: 500,
  explode: 1100,
  fade: 2300,
  done: 2900,
};

export default function Loader() {
  const [phase, setPhase] = useState<Phase>("enter");
  const [triggerExplode, setTriggerExplode] = useState(false);

  useEffect(() => {
    document.body.style.background = "#141414";
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";

    const timers = [
      setTimeout(() => setPhase("jitter"), T.jitter),
      setTimeout(() => {
        setPhase("explode");
        setTriggerExplode(true);
      }, T.explode),
      setTimeout(() => setPhase("fade"), T.fade),
      setTimeout(() => {
        setPhase("done");
        window.parent.postMessage("loader-done", "*");
      }, T.done),
    ];

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
        @keyframes bannerJitter {
          0%,  100% { transform: translate(0px,    0px)   rotate(0deg); }
          8%         { transform: translate(-4px,  -3px)  rotate(-0.4deg); }
          16%        { transform: translate(5px,    2px)  rotate(0.5deg); }
          24%        { transform: translate(-6px,   3px)  rotate(-0.6deg); }
          32%        { transform: translate(6px,   -2px)  rotate(0.6deg); }
          40%        { transform: translate(-3px,   5px)  rotate(-0.3deg); }
          48%        { transform: translate(4px,   -5px)  rotate(0.4deg); }
          56%        { transform: translate(-7px,   2px)  rotate(-0.7deg); }
          64%        { transform: translate(7px,   -3px)  rotate(0.7deg); }
          72%        { transform: translate(-5px,  -4px)  rotate(-0.5deg); }
          80%        { transform: translate(5px,    4px)  rotate(0.5deg); }
          88%        { transform: translate(-3px,  -6px)  rotate(-0.3deg); }
        }
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
          backgroundColor: "#141414",
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
            maxWidth: "1440px",
            padding: "0 64px",
            boxSizing: "border-box",
            animation:
              phase === "enter"
                ? "bannerEnter 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards"
                : phase === "jitter"
                ? "bannerJitter 0.12s ease-in-out infinite"
                : "none",
          }}
        >
          <InteractiveHeroBanner
            colorStops={AQUA_MIST_STOPS}
            initialControls={LOADER_CONTROLS}
            persistControls={false}
            triggerExplode={triggerExplode}
          />
        </div>
      </div>
    </>
  );
}
