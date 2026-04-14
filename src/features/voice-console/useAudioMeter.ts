import { useEffect, useState } from "react";

const MIN_LEVEL = 0;
const MAX_LEVEL = 1;

function clamp(value: number): number {
  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, value));
}

export function useAudioMeter(stream: MediaStream | null, enabled: boolean): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!enabled || !stream) {
      setLevel(0);
      return;
    }

    let raf = 0;

    const AudioContextCtor =
      window.AudioContext ||
      (
        window as unknown as {
          webkitAudioContext: typeof AudioContext;
        }
      ).webkitAudioContext;

    const context = new AudioContextCtor();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.2;
    source.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);

    const frame = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const sample = (data[i]! - 128) / 128;
        sum += sample * sample;
      }

      const rms = Math.sqrt(sum / data.length);
      const normalized = clamp(rms * 6.2);
      setLevel((prev) => prev * 0.6 + normalized * 0.4);
      raf = requestAnimationFrame(frame);
    };

    void context.resume().catch(() => undefined);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      analyser.disconnect();
      setLevel(0);
      void context.close().catch(() => undefined);
    };
  }, [enabled, stream]);

  return level;
}
