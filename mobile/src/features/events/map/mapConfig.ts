/**
 * The event map's configuration (09 §8.7, ADR-411): MapLibre GL JS from a pinned CDN build with subresource integrity, OpenFreeMap
 * tiles (no key) in a dark style for Carbon/Schwarz and a light one for Hell, recoloured to the canvas tokens, and the attribution
 * "© OpenMapTiles © OpenStreetMap-Mitwirkende" always visible. The controller (public/map/event-map.js) is the same file on native
 * (WebView) and the member web.
 */
import { siteUrl } from '@/features/settings/markdown/links';
import { isWeb } from '@/lib/platform';
import { resolveColor, size, space, typography, type AppTheme } from '@/theme';
import { motionDuration } from '@/ui/motion';

export const MAPLIBRE_VERSION = '4.7.1';
export const MAPLIBRE_SCRIPT = {
  url: `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`,
  integrity: 'sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj',
};
export const MAPLIBRE_STYLE = {
  url: `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`,
  integrity: 'sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V',
};
const TILE_STYLES = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/positron',
} as const;
/** Germany, for a list without a region (EVT-01 Karte opens on the country). */
export const GERMANY = { lat: 51.1657, lng: 10.4515 } as const;
export const COUNTRY_ZOOM = 5;
export const CITY_ZOOM = 12;
export const AREA_ZOOM = 11;
/** The map waits this long for its first tiles before it says it is unavailable (ADR-411 fallback). */
export const MAP_TIMEOUT_MS = 12_000;

export type MapMode = 'pins' | 'snippet' | 'picker';

export type MapPin = { id: string; lat: number; lng: number; label: string; title: string };

export type MapPoint = { lat: number; lng: number };

/** What the controller draws; every design value comes from the tokens. */
export type MapState = {
  mode: MapMode;
  styleUrl: string;
  attribution: string;
  center: MapPoint;
  zoom: number;
  pins: readonly MapPin[];
  selectedId: string | null;
  focus: MapPoint | null;
  exact: boolean;
  picked: MapPoint | null;
  reduced: boolean;
  moveMs: number;
  fadeMs: number;
  colors: { canvas: string; water: string; primary: string; accent: string; area: string };
  sizes: {
    pin: number;
    cluster: number;
    clusterL: number;
    clusterRadius: number;
    clusterMaxZoom: number;
    stroke: number;
    hairline: number;
    area: number;
    handle: number;
    text: number;
  };
  fonts: { regular: string; bold: string };
};

/** The controller's messages to the app. */
export type MapMessage =
  | { type: 'ready' }
  | { type: 'error'; message?: string }
  | { type: 'select'; id: string | null }
  | { type: 'view'; bbox: [number, number, number, number] }
  | { type: 'pick'; lat: number; lng: number };

export function parseMapMessage(raw: unknown): MapMessage | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null) return null;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case 'ready':
      return { type: 'ready' };
    case 'error':
      return { type: 'error', message: typeof message.message === 'string' ? message.message : undefined };
    case 'select':
      return { type: 'select', id: typeof message.id === 'string' ? message.id : null };
    case 'view': {
      const bbox = message.bbox;
      if (
        !Array.isArray(bbox) ||
        bbox.length !== 4 ||
        !bbox.every((v) => typeof v === 'number' && Number.isFinite(v))
      )
        return null;
      return { type: 'view', bbox: bbox as [number, number, number, number] };
    }
    case 'pick':
      return typeof message.lat === 'number' && typeof message.lng === 'number'
        ? { type: 'pick', lat: message.lat, lng: message.lng }
        : null;
    default:
      return null;
  }
}

export type MapInput = {
  mode: MapMode;
  center: MapPoint | null;
  zoom?: number;
  pins?: readonly MapPin[];
  selectedId?: string | null;
  exact?: boolean;
  picked?: MapPoint | null;
  attribution: string;
};

export function mapState(input: MapInput, theme: AppTheme, reduced: boolean): MapState {
  const color = (token: Parameters<typeof resolveColor>[1]) => resolveColor(theme, token);
  const selected = input.selectedId
    ? (input.pins ?? []).find((pin) => pin.id === input.selectedId)
    : undefined;
  return {
    mode: input.mode,
    styleUrl: theme.colorScheme === 'light' ? TILE_STYLES.light : TILE_STYLES.dark,
    attribution: input.attribution,
    center: input.center ?? input.picked ?? GERMANY,
    zoom: input.zoom ?? (input.center || input.picked ? CITY_ZOOM : COUNTRY_ZOOM),
    pins: input.pins ?? [],
    selectedId: input.selectedId ?? null,
    focus: selected ? { lat: selected.lat, lng: selected.lng } : null,
    exact: input.exact ?? true,
    picked: input.picked ?? null,
    reduced,
    moveMs: motionDuration('spring.calm'),
    fadeMs: motionDuration('effect.default'),
    colors: {
      canvas: color('bg.canvas'),
      water: color('bg.surface'),
      primary: color('text.primary'),
      accent: color('accent.fg'),
      area: color('state.selected'),
    },
    sizes: {
      // 09 §5 MapView: pins are text-primary dots; a cluster takes the small avatar's circle.
      pin: space[8] - space[2],
      cluster: size.avatar.sm / 2,
      clusterL: size.avatar.md / 2,
      clusterRadius: size.touchMin,
      clusterMaxZoom: 13,
      stroke: space[2],
      hairline: size.border.control,
      area: size.avatar.xl / 2,
      handle: size.slider.thumb,
      text: typography.caption.fontSize,
    },
    // OpenFreeMap serves Noto Sans glyphs; Inter is not on the tile server.
    fonts: { regular: 'Noto Sans Regular', bold: 'Noto Sans Bold' },
  };
}

/** The controller on this origin: the member web's base path, or the public site for the native WebView. */
export function controllerUrl(): string | null {
  if (isWeb) {
    const base = (process.env.EXPO_BASE_URL ?? '').replace(/\/+$/, '');
    return `${base}/map/event-map.js`;
  }
  const site = siteUrl();
  return site ? `${site.replace(/\/+$/, '')}/app/map/event-map.js` : null;
}

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * The native WebView page: MapLibre and the controller, a full-size container on the canvas colour, and the bridge that hands the
 * controller's messages to React Native. State updates arrive through `window.scApply(json)`.
 */
export function mapHtml(state: MapState, controller: string): string {
  const canvas = escapeAttr(state.colors.canvas);
  const initial = JSON.stringify(state).replace(/</g, '\\u003c');
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">',
    `<link rel="stylesheet" href="${MAPLIBRE_STYLE.url}" integrity="${MAPLIBRE_STYLE.integrity}" crossorigin="anonymous">`,
    `<style>html,body,#map{margin:0;height:100%;width:100%;background:${canvas}}</style>`,
    '</head><body><div id="map"></div>',
    `<script src="${MAPLIBRE_SCRIPT.url}" integrity="${MAPLIBRE_SCRIPT.integrity}" crossorigin="anonymous"></script>`,
    `<script src="${escapeAttr(controller)}"></script>`,
    '<script>(function(){',
    'function send(m){try{window.ReactNativeWebView.postMessage(JSON.stringify(m))}catch(e){}}',
    "if(!window.maplibregl||!window.SpeedclubEventMap){send({type:'error',message:'script'});return;}",
    `var handle=window.SpeedclubEventMap.mount(window.maplibregl,document.getElementById('map'),${initial},send);`,
    'window.scApply=function(s){handle.apply(s)};',
    "window.addEventListener('resize',function(){handle.resize()});",
    '})();</script></body></html>',
  ].join('');
}
