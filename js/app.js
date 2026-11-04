/**
 * MeroHisab — Application Bootstrap & Main Controller (v3 Audited)
 */
import { getState, subscribe, hydrateFromIndexedDB } from "./core/state.js";
import { initNavigation, renderCurrentView } from "./components/navigation.js";

async function bootstrap() {
  const initialState = getState();
  const activeTheme = initialState.settings?.theme || "dark";
  document.documentElement.setAttribute("data-theme", activeTheme);

  initNavigation();

  subscribe(() => {
    renderCurrentView();
  });

  // Reconcile IndexedDB & LocalStorage asynchronously on boot
  await hydrateFromIndexedDB();

  // Request browser permission to prevent eviction under disk pressure
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(isPersisted => {
      if (isPersisted) {
        console.log("[Storage] Browser granted PERSISTENT storage guarantee.");
      } else {
        console.warn("[Storage] Storage is subject to OS eviction. Regular JSON exports recommended.");
      }
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
