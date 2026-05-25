"use client";

import { useEffect, useRef, useCallback } from "react";

const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "1x00000000000000000000AA";

type Props = {
  onSuccess: (token: string) => void;
  onError?: () => void;
  theme?: "dark" | "light" | "auto";
};

let scriptLoaded = false;
let scriptLoading = false;
const waiters: (() => void)[] = [];

function loadScript(): Promise<void> {
  if (scriptLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (scriptLoading) {
      waiters.push(resolve);
      return;
    }
    scriptLoading = true;
    const s = document.createElement("script");
    s.src = TURNSTILE_SCRIPT_URL;
    s.async = true;
    s.onload = () => {
      scriptLoaded = true;
      scriptLoading = false;
      resolve();
      waiters.forEach((fn) => fn());
      waiters.length = 0;
    };
    s.onerror = (err) => {
      scriptLoading = false;
      reject(err);
    };
    document.head.appendChild(s);
  });
}

export function TurnstileWidget({ onSuccess, onError, theme = "dark" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const render = useCallback(() => {
    const el = containerRef.current;
    if (!el || widgetIdRef.current !== null) return;
    const w = (window as any).turnstile;
    if (!w) return;

    widgetIdRef.current = w.render(el, {
      sitekey: SITE_KEY,
      theme,
      callback: (token: string) => onSuccessRef.current(token),
      "error-callback": () => onError?.(),
    });
  }, [theme, onError]);

  useEffect(() => {
    loadScript().then(render).catch(() => {});
    return () => {
      if (widgetIdRef.current !== null) {
        try {
          (window as any).turnstile?.remove(widgetIdRef.current);
        } catch {}
        widgetIdRef.current = null;
      }
    };
  }, [render]);

  return <div ref={containerRef} className="flex justify-center my-2" />;
}
