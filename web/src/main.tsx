import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "@web/App";
import "./styles.css";

const root = document.getElementById("root");

if (!root) throw new Error("Yachigravity Observatory root element is missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
