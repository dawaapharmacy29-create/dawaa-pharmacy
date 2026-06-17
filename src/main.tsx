import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles/dawaa-theme.css";
import "./styles/dawaa-design-system.css";
import App from "./App.tsx";
import { initOfflineQueueAutoSync } from "@/lib/offlineQueue";
import { installRuntimeSafetyGuards } from "@/lib/runtimeSafety";

installRuntimeSafetyGuards();
initOfflineQueueAutoSync();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
