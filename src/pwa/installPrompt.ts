/**
 * PWA install prompt (Phase 17, innovation #14).
 *
 * The `beforeinstallprompt` event is captured once and replayed on demand.
 * Honest states: when the browser never fires the event (already installed,
 * iOS Safari, or installability criteria unmet) no install button is shown —
 * we never fake an install affordance.
 */
import { useEffect, useState } from "react";

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallState =
  | { kind: "unavailable" }
  | { kind: "available"; prompt: () => Promise<"accepted" | "dismissed"> };

/**
 * React hook exposing the captured install prompt. Returns `unavailable`
 * until the browser fires `beforeinstallprompt`, and permanently after the
 * app is installed (`appinstalled`).
 */
export function useInstallPrompt(): InstallState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (deferred === null) {
    return { kind: "unavailable" };
  }
  return {
    kind: "available",
    prompt: async () => {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") {
        setDeferred(null);
      }
      return choice.outcome;
    },
  };
}
