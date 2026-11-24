import { useCallback, useEffect, useRef, useState } from 'react';

import { STORY_CARD_MS } from './model';

export type PlayerOptions = {
  total: number;
  initialIndex: number;
  /** Opens paused (a QA link to one card, so the matrix holds it). */
  startPaused: boolean;
  /** WCAG 2.2.2: no auto-advance while VoiceOver or TalkBack runs. */
  screenReader: boolean;
  /** Something else holds the story: the share sheet is busy, the screen is not on top. */
  blocked: boolean;
};

export type Player = {
  index: number;
  /** Paused by the member (button, Space). */
  paused: boolean;
  /** Held by the finger. */
  held: boolean;
  /** The clock runs: auto-advance is due after the rest of the card's time. */
  running: boolean;
  next: () => void;
  previous: () => void;
  goTo: (index: number) => void;
  togglePause: () => void;
  setHeld: (held: boolean) => void;
};

/**
 * The story's clock (contract §6, spike §8): one card every STORY_CARD_MS, paused while held, paused by the member, while a screen
 * reader runs or while something holds it; a pause keeps what the card has had, so it resumes where it stopped. The last card (the
 * share card) stays: the story never closes itself.
 */
export function usePlayer({ total, initialIndex, startPaused, screenReader, blocked }: PlayerOptions): Player {
  const [index, setIndex] = useState(() => Math.min(Math.max(initialIndex, 0), Math.max(total - 1, 0)));
  const [paused, setPaused] = useState(startPaused);
  const [held, setHeld] = useState(false);
  // What the card `index` has had of its time before the running stretch, so a pause resumes where it stopped.
  const clock = useRef({ index, spent: 0 });
  const last = index >= total - 1;
  const running = total > 0 && !last && !paused && !held && !screenReader && !blocked;

  const goTo = useCallback((target: number) => setIndex(Math.min(Math.max(target, 0), Math.max(total - 1, 0))), [total]);
  const next = useCallback(() => setIndex((current) => Math.min(current + 1, Math.max(total - 1, 0))), [total]);
  const previous = useCallback(() => setIndex((current) => Math.max(current - 1, 0)), []);
  const togglePause = useCallback(() => setPaused((value) => !value), []);

  useEffect(() => {
    if (!running) return undefined;
    if (clock.current.index !== index) clock.current = { index, spent: 0 };
    const start = Date.now();
    const timer = setTimeout(next, Math.max(0, STORY_CARD_MS - clock.current.spent));
    return () => {
      clearTimeout(timer);
      if (clock.current.index === index) clock.current.spent += Date.now() - start;
    };
  }, [running, index, next]);

  return { index, paused, held, running, next, previous, goTo, togglePause, setHeld };
}
