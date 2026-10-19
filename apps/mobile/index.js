import { registerRootComponent } from "expo";
import App from "./src/App";

// Expo managed-workflow entry point. `App.tsx` owns providers + navigation;
// keep this file free of logic (ADR-001).
registerRootComponent(App);
