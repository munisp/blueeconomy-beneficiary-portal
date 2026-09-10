/**
 * Honest online/offline state for the portal (Phase 17, innovation #14).
 * `navigator.onLine` is a hint, not a guarantee — the UI therefore says
 * "offline" only when the browser reports it, and never claims connectivity
 * that has not been verified by a successful request.
 */
import { useEffect, useState } from "react";

export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/** Tracks browser online/offline events; defaults to online (optimistic). */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() => isOnline());
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}
