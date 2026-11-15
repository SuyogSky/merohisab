/**
 * MeroHisab — Application Bootstrap & Main Controller (v3 Audited)
 */
import { getState, subscribe, hydrateFromIndexedDB, TAB_ID, computeProfileInitials } from "./core/state.js";
import { initNavigation, renderCurrentView } from "./components/navigation.js";
import { STORAGE_KEYS } from "./core/constants.js";
import { checkPersistenceStatus } from "./utils/storage-persistence.js";

export function updateSidebarProfile(state = getState()) {
  if (typeof document === "undefined") return;
  const s = state || getState() || {};
  const settings = s.settings || {};
  const userName = (settings.profile?.displayName || settings.userName || "").trim() || "MeroHisab User";
  const userRole = (settings.userRole || "").trim() || "Personal Ledger";
  const initials = computeProfileInitials(userName);

  const nameEl = document.getElementById("sidebar-user-name") || document.querySelector(".user-name");
  const roleEl = document.getElementById("sidebar-user-role") || document.querySelector(".user-role");
  const avatarEl = document.getElementById("sidebar-user-avatar") || document.querySelector(".user-avatar");

  if (nameEl) {
    nameEl.textContent = userName;
    nameEl.title = userName;
  }
  if (roleEl) {
    roleEl.textContent = userRole;
  }
  if (avatarEl) {
    avatarEl.textContent = initials;
  }
}

async function bootstrap() {
  try {
    await hydrateFromIndexedDB();
  } catch (err) {
    console.error("[Bootstrap] Hydration failed, falling back to local state:", err);
  }
  const state = getState();
  const theme = state.settings?.theme || "dark";
  document.documentElement.setAttribute("data-theme", theme);

  updateSidebarProfile(state);
  initNavigation();

  subscribe((latestState) => {
    updateSidebarProfile(latestState);
    renderCurrentView();
  });

  // 4. Multi-Tab Synchronization with loop prevention
  if (typeof window !== "undefined") {
    window.addEventListener("storage", async (e) => {
      if (e.key === STORAGE_KEYS.APP_DATA || e.key === "MERO_HISAB_DATA_V2") {
        try {
          await hydrateFromIndexedDB();
          renderCurrentView();
        } catch (err) {
          console.error("[StorageSync] Rehydration error:", err);
        }
      }
    });

    if (typeof BroadcastChannel !== "undefined") {
      try {
        const channel = new BroadcastChannel("merohisab_sync");
        channel.onmessage = async (event) => {
          if (!event.data || event.data.tabId === TAB_ID) return;
          const currentRev = getState()?.revision || 0;
          if (event.data.revision && event.data.revision <= currentRev) return;
          try {
            await hydrateFromIndexedDB();
            renderCurrentView();
          } catch (err) {
            console.error("[BroadcastSync] Rehydration error:", err);
          }
        };
      } catch {}
    }
  }

  // 5. Inspect and initialize storage persistence status
  checkPersistenceStatus().then(status => {
    if (status === "granted") {
      console.log("[Storage] Browser persistent storage active (eviction protected).");
    } else {
      console.log(`[Storage] Browser storage persistence status: ${status}.`);
    }
  }).catch(() => {});

  // 6. Progressive Web App Service Worker Registration for Offline Reliability
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof window !== "undefined" && window.location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").then(reg => {
      console.log("[PWA] Service Worker registered with scope:", reg.scope);
    }).catch(err => {
      console.warn("[PWA] Service Worker registration failed:", err);
    });
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
}
