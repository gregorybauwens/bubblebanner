import { useEffect } from "react";
import InteractiveTypeBanner from "@/components/InteractiveTypeBanner";

const DEFAULT_STOPS = [
  "#FFD166",
  "#FF9E64",
  "#FF6E91",
  "#D490D4",
  "#8ABFFF",
  "#A5F3FC",
];

const EmbedTypography = () => {
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = "transparent";
    return () => {
      document.body.style.background = prev;
    };
  }, []);

  return (
    <div className="min-h-screen bg-transparent flex items-center justify-center p-0">
      <div className="w-full mx-auto">
        <InteractiveTypeBanner
          colorStops={DEFAULT_STOPS}
          persistControls={false}
        />
      </div>
    </div>
  );
};

export default EmbedTypography;
