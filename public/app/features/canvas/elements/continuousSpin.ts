import { useRef } from 'react';

interface SpinState {
  rpm: number;
  phase: number;
  updatedAt: number;
}

/**
 * Returns animation styles that preserve the current rotation phase when RPM changes.
 * Updating CSS animation-duration normally restarts the animation timeline; a negative
 * animation delay restores the phase accumulated under the previous RPM.
 */
export function useContinuousSpinAnimation(rpm: number) {
  const state = useRef<SpinState>({ rpm, phase: 0, updatedAt: performance.now() });
  const now = performance.now();

  if (state.current.rpm !== rpm) {
    if (state.current.rpm !== 0) {
      state.current.phase += ((now - state.current.updatedAt) / 1000) * (Math.abs(state.current.rpm) / 60);
      state.current.phase %= 1;
    }

    state.current.rpm = rpm;
    state.current.updatedAt = now;
  }

  if (rpm === 0) {
    return {
      animation: 'none',
    };
  }

  const duration = 60 / Math.abs(rpm);
  return {
    animation: `spin ${duration}s linear infinite`,
    animationDelay: `${-state.current.phase * duration}s`,
  };
}
