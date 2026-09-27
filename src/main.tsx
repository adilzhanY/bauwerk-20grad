import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { useEditorStore } from "./store/building";
import { startPersistence } from "./store/persist";
import { applyLinkImport } from "./lib/linkImport";
import { useRouter } from "./app/router";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

startPersistence(useEditorStore);
// A building handed over from the lod2 viewer arrives in the link.
const linkNotice = applyLinkImport(useEditorStore.getState().language, (building) => {
  useEditorStore.getState().loadBuilding(building);
});
// A building arriving by link opens in the editor.
if (linkNotice) useRouter.getState().navigate({ page: "editor" }, { replace: true });

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App linkNotice={linkNotice} />
    </ErrorBoundary>
  </StrictMode>,
);
