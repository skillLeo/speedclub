import { useEffect, useState } from 'react';

/**
 * SM13 runs on the false → true change of `QrReveal.revealed` only. A code already in the cache would mount revealed and skip
 * the reveal, so the screen hands it over on the next frame: the card always reveals once when the page opens with it.
 */
export function useRevealOnce(ready: boolean): boolean {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(frame);
  }, [ready]);
  return ready && revealed;
}
