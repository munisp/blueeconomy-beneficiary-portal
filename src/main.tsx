import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./design-tokens.css";
import "./styles.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("portal root element is missing");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Minimal offline shell (cache-first static assets only; API/IdP traffic is
// never intercepted by the worker).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
