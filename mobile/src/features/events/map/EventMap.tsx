import { useEffect, useMemo, useRef, useState, type ComponentType, type Ref } from 'react';
import { Linking, StyleSheet } from 'react-native';
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';

import { siteUrl } from '@/features/settings/markdown/links';
import { useTheme } from '@/theme';
import { useMotionPreference } from '@/ui/motion';

import { EventMapFrame, type EventMapProps, type MapPhase } from './EventMapFrame';
import { controllerUrl, MAP_TIMEOUT_MS, mapHtml, mapState, parseMapMessage } from './mapConfig';
import { useMapConsent } from './mapConsent';
import { useMapAttribution } from './useMapAttribution';

/** The injected-script handle of the WebView; its class types do not resolve under React 19 (`props: never`). */
type WebViewHandle = { injectJavaScript: (script: string) => void };
const WebView = RNWebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebViewHandle> }>;

const styles = StyleSheet.create({ web: { flex: 1 } });

/**
 * MapView on iOS and Android (09 §5, ADR-411 fallback): MapLibre GL JS in a WebView, the controller from the site's own origin. The
 * page is built once per mode, theme and style; later changes (pins, selection, the picked point) go in through `scApply`. Links in
 * the attribution open in the browser, never inside the map.
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
  const theme = useTheme();
  const motion = useMotionPreference();
  const attribution = useMapAttribution();
  const ref = useRef<WebViewHandle>(null);
  // Every map waits for the reader's tap: "Karte anzeigen", or choosing EVT-01's map view (mapConsent.ts); a link never loads it.
  const consented = useMapConsent();
  const [phase, setPhase] = useState<MapPhase>('loading');
  const controller = controllerUrl();
  const state = useMemo(
    () =>
      mapState(
        { mode, center, zoom, pins, selectedId, exact, picked, attribution },
        theme,
        motion.reduced || !motion.enabled,
      ),
    [attribution, center, exact, mode, motion.enabled, motion.reduced, picked, pins, selectedId, theme, zoom],
  );
  // The page itself only follows what needs a new map: mode, theme and the controller; it is built from the state at that moment
  // (derived during render, so the first frame of a new page is already "loading").
  const pageKey = `${mode}|${theme.name}|${controller ?? ''}`;
  const [page, setPage] = useState(() => ({
    key: pageKey,
    html: controller ? mapHtml(state, controller) : null,
  }));
  if (page.key !== pageKey) {
    setPage({ key: pageKey, html: controller ? mapHtml(state, controller) : null });
    setPhase('loading');
  }
  const html = page.html;

  useEffect(() => {
    if (phase !== 'ready') return;
    ref.current?.injectJavaScript(`window.scApply&&window.scApply(${JSON.stringify(state)});true;`);
  }, [phase, state]);

  useEffect(() => {
    if (phase !== 'loading' || !consented) return undefined;
    const timer = setTimeout(() => setPhase('failed'), MAP_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [consented, phase]);

  useEffect(() => {
    if (consented && (phase === 'failed' || !html)) onUnavailable?.();
  }, [consented, html, onUnavailable, phase]);

  useEffect(() => {
    if (phase === 'ready') onReady?.();
  }, [onReady, phase]);

  const onMessage = (event: WebViewMessageEvent) => {
    const message = parseMapMessage(event.nativeEvent.data);
    if (!message) return;
    if (message.type === 'ready') setPhase('ready');
    else if (message.type === 'error') setPhase('failed');
    else if (message.type === 'select') onSelect?.(message.id);
    else if (message.type === 'view') onView?.(message.bbox);
    else if (message.type === 'pick') onPick?.({ lat: message.lat, lng: message.lng });
  };

  return (
    <EventMapFrame
      height={height}
      corner={corner}
      phase={!consented ? 'consent' : html ? phase : 'failed'}
      label={label}
      style={style}
      testID={testID}
    >
      {html && consented ? (
        <WebView
          ref={ref}
          source={{ html, baseUrl: siteUrl() ?? undefined }}
          originWhitelist={['about:blank', 'https://*']}
          onMessage={onMessage}
          onError={() => setPhase('failed')}
          onShouldStartLoadWithRequest={(
            request: Parameters<NonNullable<WebViewProps['onShouldStartLoadWithRequest']>>[0],
          ) => {
            if (
              request.isTopFrame === false ||
              request.url === 'about:blank' ||
              request.navigationType === undefined
            )
              return true;
            if (request.navigationType === 'click') {
              void Linking.openURL(request.url);
              return false;
            }
            return true;
          }}
          setSupportMultipleWindows={false}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          javaScriptEnabled
          domStorageEnabled={false}
          allowFileAccess={false}
          cacheEnabled
          accessible={false}
          // The WebView paints white until its page loads: the surface tone keeps a dark map from flashing.
          style={[styles.web, { backgroundColor: theme.color.bg.surface }]}
          testID={testID ? `${testID}.webview` : undefined}
        />
      ) : null}
    </EventMapFrame>
  );
}
