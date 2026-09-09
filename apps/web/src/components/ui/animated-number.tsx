'use client';

import { useEffect, useRef, useState } from 'react';

const ANIMATION_DURATION_MS = 600;

const defaultFormat = (n: number) => new Intl.NumberFormat().format(Math.round(n));

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export interface AnimatedNumberProps {
  value: number | null;
  format?: (n: number) => string;
}

export function AnimatedNumber({ value, format = defaultFormat }: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value ?? 0);
  const fromRef = useRef(value ?? 0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (value === null) {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      return;
    }

    const from = fromRef.current;
    const to = value;
    const start = Date.now();

    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
    }

    if (from === to) {
      setDisplay(to);
      return;
    }

    const tick = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / ANIMATION_DURATION_MS, 1);
      const eased = easeOutCubic(progress);
      const current = from + (to - from) * eased;

      if (progress >= 1) {
        setDisplay(to);
        fromRef.current = to;
        frameRef.current = null;
        return;
      }

      setDisplay(current);
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  if (value === null) {
    return <span>N/A</span>;
  }

  return <span>{format(display)}</span>;
}
