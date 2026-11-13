import { useEffect, useEffectEvent, useMemo, useRef, useState, type ComponentRef } from 'react';
import { View } from 'react-native';

import { createStyles, useTheme } from '@/theme';
import { useMotionPreference } from '@/ui/motion';

import { EventMapFrame, type EventMapProps, type MapPhase } from './EventMapFrame';
import {
  controllerUrl,
  MAP_TIMEOUT_MS,
  MAPLIBRE_SCRIPT,
  MAPLIBRE_STYLE,
  mapState,
  parseMapMessage,
  type MapState,
} from './mapConfig';
import { useMapConsent } from './mapConsent';
import { useMapAttribution } from './useMapAttribution';

type Handle = { apply: (state: MapState) => void; resize: () => void; destroy: () => void };
type MapWindow = Window & {
  maplibregl?: unknown;
  SpeedclubEventMap?: {
    mount: (lib: unknown, node: HTMLElement, state: MapState, send: (message: unknown) => void) => Handle;
  };
};

const useStyles = createStyles(() => ({ host: { flex: 1 } }));

const loaded = new Map<string, Promise<void>>();

/** One script or stylesheet per URL and page, with its integrity where the CDN serves it. */
function load(kind: 'script' | 'style', url: string, integrity?: string): Promise<void> {
  const known = loaded.get(url);
  if (known) return known;
  const promise = new Promise<void>((resolve, reject) => {
    const element =
      kind === 'script'
        ? Object.assign(document.createElement('script'), { src: url, async: true })
        : Object.assign(document.createElement('link'), { rel: 'stylesheet', href: url });
    if (integrity) {
      element.setAttribute('integrity', integrity);
      element.setAttribute('crossorigin', 'anonymous');
    }
    element.addEventListener('load', () => resolve());
    element.addEventListener('error', () => {
      loaded.delete(url);
      element.remove();
      reject(new Error(`load ${url}`));
    });
    document.head.appendChild(element);
  });
  loaded.set(url, promise);
  return promise;
}

/**
 * MapView on the member web (09 §5, ADR-411): the same MapLibre build and controller as the native WebView, mounted straight into
 * this View's node, so the page needs no frame and no inline script. Pins and selection go in through the controller's `apply`.
 */
export function EventMap(props: EventMapProps) {
  const {
    mode,
    height,
    center,
    zoom,
    pins,
    selectedId,
    exact,
    picked,
    label,
    onSelect,
    onView,
    onPick,
    onUnavailable,
    onReady,
    corner,
    style,
    testID,
  } = props;
  const styles = useStyles();
  const theme = useTheme();
  const motion = useMotionPreference();
  const attribution = useMapAttribution();
  const host = useRef<ComponentRef<typeof View>>(null);
  const handle = useRef<Handle | null>(null);
  // Every map waits for the reader's tap: "Karte anzeigen", or choosing EVT-01's map view (mapConsent.ts); a link never loads it.
  const consented = useMapConsent();
  const [phase, setPhase] = useState<MapPhase>('loading');
  const state = useMemo(
    () =>
      mapState(
        { mode, center, zoom, pins, selectedId, exact, picked, attribution },
        theme,
        motion.reduced || !motion.enabled,
      ),
    [attribution, center, exact, mode, motion.enabled, motion.reduced, picked, pins, selectedId, theme, zoom],
  );
  const latestState = useEffectEvent(() => state);
  const deliver = useEffectEvent((raw: unknown) => {
    const message = parseMapMessage(raw);
    if (!message) return;
    if (message.type === 'ready') setPhase('ready');
    else if (message.type === 'error') setPhase('failed');
    else if (message.type === 'select') onSelect?.(message.id);
    else if (message.type === 'view') onView?.(message.bbox);
    else if (message.type === 'pick') onPick?.({ lat: message.lat, lng: message.lng });
  });
  // A new map (mode or theme) starts loading again; derived during render, never set from an effect.
  const mapKey = `${mode}|${theme.name}`;
  const [loadedKey, setLoadedKey] = useState(mapKey);
  if (loadedKey !== mapKey) {
    setLoadedKey(mapKey);
    setPhase('loading');
  }

  useEffect(() => {
    if (!consented) return undefined;
    let cancelled = false;
    const controller = controllerUrl();
    const timer = setTimeout(() => {
      if (!cancelled && !handle.current) setPhase('failed');
    }, MAP_TIMEOUT_MS);
    const send = (raw: unknown) => {
      if (!cancelled) deliver(raw);
    };
    Promise.all([
      load('style', MAPLIBRE_STYLE.url, MAPLIBRE_STYLE.integrity),
      load('script', MAPLIBRE_SCRIPT.url, MAPLIBRE_SCRIPT.integrity),
    ])
      .then(() => (controller ? load('script', controller) : Promise.reject(new Error('controller'))))
      .then(() => {
        const page = window as MapWindow;
        const node = host.current as unknown as HTMLElement | null;
        if (cancelled || !node || !page.maplibregl || !page.SpeedclubEventMap) {
          if (!cancelled) setPhase('failed');
          return;
        }
        handle.current = page.SpeedclubEventMap.mount(page.maplibregl, node, latestState(), send);
      })
      .catch(() => {
        if (!cancelled) setPhase('failed');
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      handle.current?.destroy();
      handle.current = null;
    };
  }, [consented, mode, theme.name]);

  useEffect(() => {
    if (phase === 'ready') handle.current?.apply(state);
  }, [phase, state]);

  useEffect(() => {
    if (phase === 'failed') onUnavailable?.();
    if (phase === 'ready') onReady?.();
  }, [onReady, onUnavailable, phase]);

  return (
    <EventMapFrame
      height={height}
      corner={corner}
      phase={consented ? phase : 'consent'}
      label={label}
      style={style}
      testID={testID}
    >
      <View
        ref={host}
        style={styles.host}
        onLayout={() => handle.current?.resize()}
        testID={testID ? `${testID}.canvas` : undefined}
      />
    </EventMapFrame>
  );
}
