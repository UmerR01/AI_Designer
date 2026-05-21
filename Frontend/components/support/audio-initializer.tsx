"use client";

import { useEffect, useRef } from "react";

/**
 * Shared AudioContext reference to avoid multiple instances.
 * Initialized on first user interaction (anywhere in the app).
 */
export const getSharedSupportAudioCtx = (): AudioContext | null => {
  if (typeof window !== "undefined") {
    return (window as any).__designerSupportAudioCtx || null;
  }
  return null;
};

export function generateDualToneWavUri(freq1: number, freq2: number, durationSeconds: number): string {
  const sampleRate = 22050;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.round(sampleRate * durationSeconds);
  const subchunk2Size = numSamples * numChannels * (bitsPerSample / 8);
  const chunkSize = 36 + subchunk2Size;

  const buffer = new ArrayBuffer(44 + subchunk2Size);
  const view = new DataView(buffer);

  // RIFF identifier
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, chunkSize, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // format subchunk identifier
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);

  // data subchunk identifier
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, subchunk2Size, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = 0.5 * (Math.sin(2 * Math.PI * freq1 * t) + Math.sin(2 * Math.PI * freq2 * t));
    const val = Math.max(-32768, Math.min(32767, sample * 32767));
    view.setInt16(offset, val, true);
    offset += 2;
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = typeof window !== "undefined" ? window.btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
  return `data:audio/wav;base64,${base64}`;
}

export function AudioInitializer() {
  const initialized = useRef(false);

  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).__designerSupportAudioCtx) {
      initialized.current = true;
      return;
    }

    if (initialized.current) return;

    const unlock = () => {
      if (initialized.current) return;
      
      try {
        // 1. Initialize Web Audio API
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        (window as any).__designerSupportAudioCtx = ctx;

        const playSilentTone = () => {
          try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = 0; // silent
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(0);
            osc.stop(0.05);
          } catch {}
        };

        // 2. Play silent HTML5 Audio sound to unlock standard Audio
        const wavUri = generateDualToneWavUri(440, 480, 0.01);
        const audio = new Audio(wavUri);
        audio.volume = 0;
        audio.play().then(() => {
          if (ctx.state === "suspended") {
            ctx.resume().then(() => {
              playSilentTone();
              initialized.current = true;
              window.removeEventListener("mousedown", unlock);
              window.removeEventListener("keydown", unlock);
              window.removeEventListener("touchstart", unlock);
            }).catch(() => {
              // HTML5 audio succeeded, so mark initialized
              initialized.current = true;
              window.removeEventListener("mousedown", unlock);
              window.removeEventListener("keydown", unlock);
              window.removeEventListener("touchstart", unlock);
            });
          } else {
            playSilentTone();
            initialized.current = true;
            window.removeEventListener("mousedown", unlock);
            window.removeEventListener("keydown", unlock);
            window.removeEventListener("touchstart", unlock);
          }
        }).catch(() => {
          // If HTML5 Audio fails, fallback to Web Audio API check
          if (ctx.state === "suspended") {
            ctx.resume().then(() => {
              playSilentTone();
              initialized.current = true;
              window.removeEventListener("mousedown", unlock);
              window.removeEventListener("keydown", unlock);
              window.removeEventListener("touchstart", unlock);
            }).catch(() => {});
          } else {
            playSilentTone();
            initialized.current = true;
            window.removeEventListener("mousedown", unlock);
            window.removeEventListener("keydown", unlock);
            window.removeEventListener("touchstart", unlock);
          }
        });
      } catch (e) {
        console.error("Failed to initialize AudioContext in AudioInitializer", e);
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

