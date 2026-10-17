import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <MotionConfig reducedMotion="user">
    <TooltipProvider delayDuration={200} skipDelayDuration={300}>
      <App />
    </TooltipProvider>
  </MotionConfig>
);
