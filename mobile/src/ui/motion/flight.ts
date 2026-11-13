import { useSyncExternalStore, type ComponentRef, type ReactNode } from 'react';
import type { View } from 'react-native';

import type { SpringToken } from '@/theme/tokens.generated';

import { flightRectAt, type Rect } from './math';

/**
 * Flights: a clone of a view that travels from a source rect to a destination rect above everything, then disappears and
 * leaves the real destination in its place. The engine behind SM4 (card → detail, HeroExpand) and SM12 (composer → bubble).
 * One `FlightLayer` at the root draws them; rects are window coordinates (`measureInWindow`).
 *
 * Not supported into or out of an RN `Modal` (Sheet, Dialog, the `(modals)` routes): a modal is its own native window above the
 * root, so the root layer draws below it and window rects do not line up. Flights stay between screens of the main stacks.
 */
export type Flight = {
  readonly id: string;
  readonly from: Rect;
  readonly to: Rect;
  /** The clone's content, laid out at the destination size. */
  readonly render: () => ReactNode;
  readonly token: SpringToken;
  /** Corner radius on screen at the start and at the end (hero: 12 → 0). */
  readonly radiusFrom: number;
  readonly radiusTo: number;
  /** Called once the clone has landed; the destination shows itself then. */
  readonly onLand?: () => void;
};

type Measurable = Pick<ComponentRef<typeof View>, 'measureInWindow'>;

let flights: readonly Flight[] = [];
const listeners = new Set<() => void>();
/** The progress (0 → 1, may overshoot) of each clone on screen, written by the layer, for a reverse that takes over mid-air. */
const live = new Map<string, () => number>();

function publish(next: readonly Flight[]): void {
  flights = next;
  for (const listener of listeners) listener();
}

/**
 * Starts a flight. A running one with the same id is replaced; a caller that reverses it (back during an expand) starts the
 * new flight from where the clone is now (`flightRectNow`), so the clone turns around instead of jumping.
 */
export function startFlight(flight: Flight): void {
  publish([...flights.filter((f) => f.id !== flight.id), flight]);
}

/** Ends a flight: the layer removes the clone. */
export function endFlight(id: string): void {
  live.delete(id);
  if (flights.some((f) => f.id === id)) publish(flights.filter((f) => f.id !== id));
}

/** The layer reports a clone's progress reader while it flies (null when it lands or unmounts). */
export function reportProgress(id: string, read: (() => number) | null): void {
  if (read) live.set(id, read);
  else live.delete(id);
}

/** The window rect of the clone of `id` right now, or null when none is flying. */
export function flightRectNow(id: string): Rect | null {
  const flight = flights.find((f) => f.id === id);
  const read = live.get(id);
  if (!flight || !read) return null;
  return flightRectAt(flight.from, flight.to, read());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getFlights = () => flights;

export function useFlights(): readonly Flight[] {
  return useSyncExternalStore(subscribe, getFlights, getFlights);
}

/** A view's rect in window coordinates, or null when it is not laid out (unmounted, zero size). */
export function measureRect(node: Measurable | null | undefined): Promise<Rect | null> {
  return new Promise((resolve) => {
    if (!node) {
      resolve(null);
      return;
    }
    node.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height } : null));
  });
}

/* ------------------------------------------------------------------ pending hand-over between source and target */

type Pending = {
  readonly from: Rect;
  readonly render: () => ReactNode;
  readonly token: SpringToken;
  readonly radiusFrom: number;
  readonly radiusTo: number;
  /** When the source began it: a hand-over no target took within `PENDING_TTL_MS` is stale. */
  readonly startedAt: number;
  /** The source it left from; its unmount drops the hand-over. */
  readonly source?: FlightHandle;
};

/** A target mounts within a navigation (well under a second); a hand-over older than this belongs to no flight any more. */
export const PENDING_TTL_MS = 1000;

const pending = new Map<string, Pending>();

/**
 * A source or target of an id: its node to measure, a switch for its own visibility while a clone stands in for it, and a fade
 * for the reduced-motion way back (effect.fast).
 */
export type FlightHandle = {
  readonly node: Measurable;
  readonly setVisible: (visible: boolean) => void;
  readonly fadeOut?: () => void;
};

const sources = new Map<string, FlightHandle>();
const targets = new Map<string, FlightHandle>();

/**
 * A source registers itself, so a flight can find where it starts and a reverse flight where to land. The same id may be
 * registered twice (one hero in two tab stacks): the later one wins, and an unregister removes only its own handle.
 */
export function registerSource(id: string, handle: FlightHandle): void {
  sources.set(id, handle);
}

export function unregisterSource(id: string, handle: FlightHandle): void {
  if (sources.get(id) === handle) sources.delete(id);
  const waiting = pending.get(id);
  if (waiting?.source === handle) pending.delete(id);
}

export function registerTarget(id: string, handle: FlightHandle): void {
  targets.set(id, handle);
}

export function unregisterTarget(id: string, handle: FlightHandle): void {
  if (targets.get(id) === handle) targets.delete(id);
}

/** The source side: remember where the flight starts. The target picks it up when it lays out (`takePending`). */
export function beginFlight(
  id: string,
  from: Rect,
  render: () => ReactNode,
  token: SpringToken,
  radiusFrom: number,
  radiusTo: number,
  source?: FlightHandle,
  now: number = Date.now(),
): void {
  pending.set(id, { from, render, token, radiusFrom, radiusTo, startedAt: now, source });
}

function fresh(id: string, now: number): Pending | undefined {
  const found = pending.get(id);
  if (found && now - found.startedAt > PENDING_TTL_MS) {
    pending.delete(id);
    return undefined;
  }
  return found;
}

export function takePending(id: string, now: number = Date.now()): Pending | undefined {
  const found = fresh(id, now);
  pending.delete(id);
  return found;
}

export function hasPending(id: string, now: number = Date.now()): boolean {
  return fresh(id, now) !== undefined;
}

/** The registered source and target of an id. */
export function handlesOf(id: string): { source?: FlightHandle; target?: FlightHandle } {
  return { source: sources.get(id), target: targets.get(id) };
}

/** Test seam. */
export function __resetFlightsForTests(): void {
  flights = [];
  live.clear();
  pending.clear();
  sources.clear();
  targets.clear();
  for (const listener of listeners) listener();
}
