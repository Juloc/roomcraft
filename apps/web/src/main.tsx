import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@roomcraft/ui/styles.css";
import "./styles.css";
import { AppRoot } from "./AppRoot";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found.");

createRoot(root).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
