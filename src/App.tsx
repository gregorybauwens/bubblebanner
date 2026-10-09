import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route } from "react-router-dom";
import { startIframePointerBridge } from "@/lib/iframePointerBridge";
import Index from "./pages/Index";
import Embed from "./pages/Embed";
import EmbedGrid from "./pages/EmbedGrid";
import GridOptions from "./pages/GridOptions";
import EmbedControls from "./pages/EmbedControls";
import Loader from "./pages/Loader";
import Typography from "./pages/Typography";
import EmbedTypography from "./pages/EmbedTypography";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => {
  useEffect(() => startIframePointerBridge(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <HashRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/embed" element={<Embed />} />
            {/* v2 hero banner: Column Snap, locked to the Framer page grid. /embed stays as v1. */}
            <Route path="/embed2" element={<EmbedGrid variant="column-snap" />} />
            <Route path="/embed-grid/:variant" element={<EmbedGrid />} />
            <Route path="/grid-options" element={<GridOptions />} />
            <Route path="/embed-controls" element={<EmbedControls />} />
            <Route path="/loader" element={<Loader />} />
            <Route path="/typography" element={<Typography />} />
            <Route path="/embed-typography" element={<EmbedTypography />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </HashRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
