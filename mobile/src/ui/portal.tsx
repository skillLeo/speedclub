import { useEffect, useRef, useState, useSyncExternalStore, type ComponentRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * A small portal: content drawn by the one `PortalHost` at the app root (mounted by `FlightLayer`), above every screen and
 * outside every clipping parent (a card's `overflow: hidden`, a FlashList cell). Positions are window coordinates; the host
 * subtracts its own window offset. Without a host (a unit test, a screen rendered alone) `Portal` draws its content in place.
 *
 * Not inside an RN Modal (Sheet, Dialog): a modal is its own native window above the root, so content portaled from it would
 * sit below it. Callers inside a modal render in place (`inPlace`).
 */
type Entry = { readonly key: number; readonly render: (origin: { x: number; y: number }) => ReactNode };

let entries: readonly Entry[] = [];
let nextKey = 0;
let hosts = 0;
const listeners = new Set<() => void>();

function publish(next: readonly Entry[]): void {
  entries = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getEntries = () => entries;
const getHosts = () => hosts;

const styles = StyleSheet.create({
  host: { ...StyleSheet.absoluteFill, pointerEvents: 'box-none' },
});

/** The drawing side; one at the root. */
export function PortalHost({ testID = 'portal.host' }: { testID?: string }) {
  const list = useSyncExternalStore(subscribe, getEntries, getEntries);
  const ref = useRef<ComponentRef<typeof View>>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  useEffect(() => {
    hosts += 1;
    for (const listener of listeners) listener();
    return () => {
      hosts -= 1;
      for (const listener of listeners) listener();
    };
  }, []);
  const measure = () => ref.current?.measureInWindow((x, y) => setOrigin((o) => (o.x === x && o.y === y ? o : { x, y })));
  useEffect(() => {
    if (list.length > 0) measure();
  }, [list.length]);
  return (
    <View ref={ref} style={styles.host} onLayout={measure} testID={testID}>
      {list.map((entry) => (
        <View key={entry.key} style={styles.host}>
          {entry.render(origin)}
        </View>
      ))}
    </View>
  );
}

/** True while a host is mounted, so a caller can choose between the portal and drawing in place. */
export function usePortalAvailable(): boolean {
  return useSyncExternalStore(subscribe, getHosts, getHosts) > 0;
}

export type PortalProps = {
  /** The content, given the host's window offset: place it at `rect.x - origin.x`, `rect.y - origin.y`. */
  children: (origin: { x: number; y: number }) => ReactNode;
};

/** Draws `children` in the root host while mounted. */
export function Portal({ children }: PortalProps) {
  const [key] = useState(() => (nextKey += 1));
  // Mount and every new render function: the host draws the latest content.
  useEffect(() => {
    const entry: Entry = { key, render: children };
    publish(entries.some((e) => e.key === key) ? entries.map((e) => (e.key === key ? entry : e)) : [...entries, entry]);
  }, [children, key]);
  useEffect(() => () => publish(entries.filter((e) => e.key !== key)), [key]);
  return null;
}
