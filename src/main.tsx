import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { startAuth } from "@/auth/store";
import { startUserData } from "@/auth/userData";
import "./index.css";
import { App } from "./App";
import { ErrorBoundary } from "@/components/app/ErrorBoundary";
import { useEditorStore } from "./store/building";
import { startPersistence } from "./store/persist";
import { startPhotoSync } from "./projects/photoSync";
import { startAutoSave, startLeaveGuard } from "./projects/session";
import { startThreads } from "./projects/threads";
import { startFiles } from "./projects/files";
import { startInbox } from "./projects/inbox";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

startPersistence(useEditorStore);
startPhotoSync(useEditorStore);
startLeaveGuard();
startAutoSave();
startUserData();
startThreads();
startFiles();
startInbox();
void startAuth();
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
