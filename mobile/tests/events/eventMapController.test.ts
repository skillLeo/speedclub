/**
 * The map controller `public/map/event-map.js` (M4.12, M5.9b), the same file the native WebView and the member web load, run against a
 * recording stand-in of MapLibre: what it draws for the "Spots" layer (city circles under the event points, labelled with the city,
 * carrying nothing but the label and the radius) and how `apply` updates it. The real MapLibre drawing is covered by the Playwright
 * flow web/tests/e2e/flows/f18-spot-layer.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { spotMapAreas } from '@/features/dex/spotMap';
import { mapState, type MapArea, type MapState } from '@/features/events/map/mapConfig';
import { getTheme } from '@/theme/theme';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

type Layer = { id: string; type: string; source?: string; filter?: unknown; paint?: Record<string, unknown>; layout?: Record<string, unknown> };
type GeoJson = { type: 'FeatureCollection'; features: { type: 'Feature'; id?: unknown; properties: Record<string, unknown>; geometry: { type: string; coordinates: number[] } }[] };
type Source = { spec: Record<string, unknown>; data: GeoJson; setData: jest.Mock };
type Handle = { apply: (state: MapState) => void; resize: () => void; destroy: () => void };
type Controller = { mount: (lib: unknown, node: unknown, state: MapState, send: (message: unknown) => void) => Handle };

/** A recording stand-in for maplibregl: only what the controller calls. */
function fakeMapLibre() {
  const maps: FakeMap[] = [];
  class FakeMap {
    options: Record<string, unknown>;
    sources = new Map<string, Source>();
    layers: Layer[] = [];
    handlers = new Map<string, ((event?: unknown) => void)[]>();
    touchZoomRotate = { disableRotation: jest.fn() };
    constructor(options: Record<string, unknown>) {
      this.options = options;
      maps.push(this);
    }
    on(name: string, layerOrHandler: string | ((event?: unknown) => void), handler?: (event?: unknown) => void) {
      const key = typeof layerOrHandler === 'string' ? `${name}:${layerOrHandler}` : name;
      const fn = typeof layerOrHandler === 'string' ? handler! : layerOrHandler;
      this.handlers.set(key, [...(this.handlers.get(key) ?? []), fn]);
    }
    fire(name: string, event?: unknown) {
      for (const fn of this.handlers.get(name) ?? []) fn(event);
    }
    addControl = jest.fn();
    addSource(id: string, spec: Record<string, unknown>) {
      const data = spec.data as GeoJson;
      const source: Source = { spec, data, setData: jest.fn((next: GeoJson) => void (source.data = next)) };
      this.sources.set(id, source);
    }
    getSource(id: string) {
      return this.sources.get(id);
    }
    addLayer(layer: Layer) {
      this.layers.push(layer);
    }
    getLayer(id: string) {
      return this.layers.find((layer) => layer.id === id);
    }
    getStyle() {
      return { layers: [{ id: 'background', type: 'background' }, { id: 'water', type: 'fill' }] };
    }
    setPaintProperty = jest.fn();
    getBounds() {
      return { getWest: () => 5.8, getSouth: () => 47.2, getEast: () => 15.1, getNorth: () => 55.1 };
    }
    getCanvas() {
      return { style: {} };
    }
    easeTo = jest.fn();
    jumpTo = jest.fn();
    resize = jest.fn();
    remove = jest.fn();
  }
  class AttributionControl {
    constructor(public options: unknown) {}
  }
  class Marker {}
  return { lib: { Map: FakeMap, AttributionControl, Marker }, maps };
}

function loadController(): Controller {
  const source = readFileSync(join(__dirname, '..', '..', 'public', 'map', 'event-map.js'), 'utf8');
  const root: { SpeedclubEventMap?: Controller } = {};
  // The file is an IIFE over `window`: hand it a root of its own.
  new Function('window', source)(root);
  if (!root.SpeedclubEventMap) throw new Error('event-map.js did not register SpeedclubEventMap');
  return root.SpeedclubEventMap;
}

const AREAS: MapArea[] = spotMapAreas(
  {
    generated_at: '2026-11-14T06:00:00+01:00',
    cities: [
      { city_id: 2950159, name: 'Berlin', bundesland: 'BE', count: 41 },
      { city_id: 2886242, name: 'Köln', bundesland: 'NW', count: 9 },
    ],
  },
  [
    [2950159, 'Berlin', 'BE', 52.524, 13.411, 3426354],
    [2886242, 'Köln', 'NW', 50.933, 6.95, 1024621],
  ],
);
const PINS = [{ id: '01evt', lat: 53.54, lng: 9.99, label: 'Sa 21.', title: 'Abendtreffen am Hafen' }];

function mounted(areas: readonly MapArea[] = AREAS) {
  const { lib, maps } = fakeMapLibre();
  const send = jest.fn();
  const state = mapState({ mode: 'pins', center: null, pins: PINS, areas, attribution: '© OpenStreetMap' }, getTheme('carbon'), true);
  const handle = loadController().mount(lib, {}, state, send);
  const map = maps[0]!;
  map.fire('load');
  return { map, send, state, handle };
}

describe('event-map.js: the "Spots" layer', () => {
  it('draws one circle per city at its centroid, before (under) the event points, and says ready', () => {
    const { map, send, state } = mounted();
    expect(send).toHaveBeenCalledWith({ type: 'ready' });
    const data = map.getSource('spot-areas')!.data;
    expect(data.type).toBe('FeatureCollection');
    expect(data.features).toEqual([
      { type: 'Feature', properties: { label: 'Berlin', radius: AREAS[0]!.radius }, geometry: { type: 'Point', coordinates: [13.411, 52.524] } },
      { type: 'Feature', properties: { label: 'Köln', radius: AREAS[1]!.radius }, geometry: { type: 'Point', coordinates: [6.95, 50.933] } },
    ]);
    const order = map.layers.map((layer) => layer.id);
    expect(order.slice(0, 2)).toEqual(['spot-areas', 'spot-area-label']);
    expect(order).toEqual(expect.arrayContaining(['clusters', 'point', 'point-label']));
    expect(order.indexOf('spot-areas')).toBeLessThan(order.indexOf('clusters'));
    const circles = map.getLayer('spot-areas')!;
    expect(circles).toMatchObject({ type: 'circle', source: 'spot-areas' });
    expect(circles.paint).toEqual({
      'circle-color': state.colors.area,
      'circle-radius': ['get', 'radius'],
      'circle-stroke-color': state.colors.primary,
      'circle-stroke-width': state.sizes.hairline,
    });
  });

  it('labels every circle with its city, in the map font and the caption size', () => {
    const { map, state } = mounted();
    const label = map.getLayer('spot-area-label')!;
    expect(label).toMatchObject({ type: 'symbol', source: 'spot-areas' });
    expect(label.layout).toMatchObject({ 'text-field': ['get', 'label'], 'text-font': [state.fonts.regular], 'text-size': state.sizes.text });
    expect(label.paint).toMatchObject({ 'text-color': state.colors.primary, 'text-halo-color': state.colors.canvas });
  });

  it('carries nothing but the label and the radius: no id, no count, no vehicle, no member', () => {
    const { map } = mounted();
    const source = map.getSource('spot-areas')!;
    expect(source.spec).toEqual({ type: 'geojson', data: source.data });
    for (const feature of source.data.features) {
      expect(Object.keys(feature).sort()).toEqual(['geometry', 'properties', 'type']);
      expect(Object.keys(feature.properties).sort()).toEqual(['label', 'radius']);
    }
    const circles = map.getLayer('spot-areas')!;
    const handlers = [...map.handlers.keys()];
    // Not interactive: no click or hover handler on the spot layers.
    expect(handlers.filter((key) => key.includes('spot-area'))).toEqual([]);
    expect(circles.filter).toBeUndefined();
  });

  it('with the layer off: an empty source, drawn nonetheless, so turning it on only sets data', () => {
    const { map } = mounted([]);
    expect(map.getSource('spot-areas')!.data.features).toEqual([]);
    expect(map.getLayer('spot-areas')).toBeTruthy();
  });

  it('apply: a new list of areas replaces the source data; the same list (by identity, as React hands it) leaves it alone', () => {
    const { map, state, handle } = mounted([]);
    const source = map.getSource('spot-areas')!;
    const on = { ...state, areas: AREAS };
    handle.apply(on);
    expect(source.setData).toHaveBeenCalledTimes(1);
    expect(source.data.features.map((feature) => feature.properties.label)).toEqual(['Berlin', 'Köln']);
    // Another state change (a selection) with the same areas: no redraw of the layer.
    handle.apply({ ...on, selectedId: '01evt' });
    expect(source.setData).toHaveBeenCalledTimes(1);
    // The layer turned off: an empty list clears the circles.
    handle.apply({ ...on, areas: [] });
    expect(source.setData).toHaveBeenCalledTimes(2);
    expect(source.data.features).toEqual([]);
  });

  it('draws no spot layer outside the pins mode (the EVT-02 snippet)', () => {
    const { lib, maps } = fakeMapLibre();
    const state = mapState({ mode: 'snippet', center: { lat: 50.9, lng: 6.9 }, areas: AREAS, attribution: '' }, getTheme('carbon'), true);
    loadController().mount(lib, {}, state, jest.fn());
    maps[0]!.fire('load');
    expect(maps[0]!.getSource('spot-areas')).toBeUndefined();
    expect(maps[0]!.layers.map((layer) => layer.id)).toEqual(['place']);
  });
});
