import { qaEnabled } from '../lib/qa';

/**
 * `?dialog=<name>` outside production: the overlay a page opens on mount, so the visual matrix can photograph it (DQ-529), like the
 * gallery's `?dialog=`. With it, `?qaState=error` is meant for the overlay (its server-error state), not for the page.
 */
export function qaDialog(): string | null {
    if (!qaEnabled() || typeof window === 'undefined') return null;
    const name = new URLSearchParams(window.location.search).get('dialog');
    return name !== null && /^[a-z0-9-]{1,32}$/.test(name) ? name : null;
}
