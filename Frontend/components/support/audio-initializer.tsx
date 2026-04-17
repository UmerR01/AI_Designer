"use client";

import { useEffect, useRef } from "react";

/**
 * Shared AudioContext reference to avoid multiple instances.
 * Initialized on first user interaction (anywhere in the app).
 */
let sharedCtx: AudioContext | null = null;
export const getSharedSupportAudioCtx = () => sharedCtx;

export function AudioInitializer() {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;

    const unlock = () => {
      if (initialized.current) return;
      
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (ctx.state === "suspended") {
        ctx.resume().then(() => {
          sharedCtx = ctx;
          initialized.current = true;
          window.removeEventListener("mousedown", unlock);
          window.removeEventListener("keydown", unlock);
          window.removeEventListener("touchstart", unlock);
        });
      } else {
        sharedCtx = ctx;
        initialized.current = true;
        window.removeEventListener("mousedown", unlock);
        window.removeEventListener("keydown", unlock);
        window.removeEventListener("touchstart", unlock);
      }
    };

    window.addEventListener("mousedown", unlock);
    window.addEventListener("keydown", unlock);
    window.addEventListener("touchstart", unlock);

    return () => {
      window.removeEventListener("mousedown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, []);

  return null;
}
