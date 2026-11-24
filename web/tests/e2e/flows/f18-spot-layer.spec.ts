// F18 STREET DEX, the "Spots" layer of Entdecken › Treffen › Karte (10 §16.2, docs/reports/phase-5/m5.9b-contract.md §6/§8): the public
// spot map drawn as city circles. Spots of five different cars in one city, older than 24 hours, put that city on `GET spot-map`
// (SpotMap: at least `dex.map.min_cars` cars, SEC-P5G-03); the member opens Treffen, taps Karte (the consent to the map), turns on
// "Spots" and the map controller (public/map/event-map.js) draws one circle per city, labelled with the city, carrying nothing else.
//
// Third parties stay unreachable (support/fixtures). In this spec only, the tile style the map asks for after the tap is answered here
// with a minimal MapLibre style: no sources and no tiles, a background in the Carbon canvas token, and `glyphs` on the app's own origin
// (the label layers need a glyphs URL to be valid at all, event-map.js sets `text-font` "Noto Sans Regular"), answered with an empty
// glyph range, so the city names are in the layer but not painted in the picture. No request leaves for any other third-party URL.
//
// The observable: the page's own maplibregl, wrapped by an init script of this test as the library script defines it, records each
// map the controller creates. The test reads the controller's map through MapLibre's public API (getStyle, getLayer,
// queryRenderedFeatures); nothing in the app or the controller changes for it. Runs at 390 × carbon × de like the other flows.
import type { Request, Response } from '@playwright/test';
import { useSession } from '../support/auth.mjs';
import { ageTestMember, dexForgetSpotMap, dexFreeCities, dexSpotFixture } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { de, id, members, named, open } from '../support/flow';
import { buildVehicle } from '../support/garage.mjs';
import { BASE_URL } from '../support/qa.mjs';
import { tokens } from '../support/tokens.mjs';

type City = { id: number; name: string; bundesland: string };
type SpotMapAnswer = { data: { generated_at: string; cities: { city_id: number; name: string; bundesland: string; count: number }[] } };
type Feature = { type: string; id?: unknown; properties: Record<string, unknown>; geometry: { type: string; coordinates: number[] } };
type LayerState = {
  maps: number;
  source: { type: string; data: { type: string; features: Feature[] } } | null;
  circles: { type: string; source: string; radius: unknown } | null;
  label: { type: string; source: string; textField: unknown } | null;
  rendered: Record<string, unknown>[];
};

const ORIGIN = new URL(BASE_URL).origin;
const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
const GLYPHS = `${ORIGIN}/__qa-map-glyphs/{fontstack}/{range}.pbf`;
/** mapConfig.ts: the layer's circles span the small avatar's to the profile avatar's radius. */
const RADIUS = { min: tokens.size.avatar.sm / 2, max: tokens.size.avatar.xl / 2 } as const;
const CAPTION = 'Städte, in denen mindestens 5 verschiedene Autos gespottet wurden. Spots erscheinen nach 24 Stunden.';
/** SpotMap: a city shows from five different cars. */
const CARS = 5;

/** Version 8, no sources, no sprite; a background in the Carbon canvas token (the controller recolours it to the same token). */
const STYLE = {
  version: 8,
  name: 'Speedclub QA, no tiles',
  sources: {},
  glyphs: GLYPHS,
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': tokens.themes.carbon.color['bg.canvas'] } }],
};

/** Read in the page: the controller's newest map, its spot source as getStyle() serialises it, the two spot layers, the drawn circles. */
function readLayer(): LayerState {
  type QaMap = {
    getStyle: () => { sources: Record<string, { type: string; data: { type: string; features: Feature[] } }> };
    getLayer: (id: string) => { type: string; source: string } | undefined;
    getPaintProperty: (layer: string, name: string) => unknown;
    getLayoutProperty: (layer: string, name: string) => unknown;
    queryRenderedFeatures: (options: { layers: string[] }) => { properties: Record<string, unknown> }[];
  };
  const maps = (window as unknown as { __qaMaps?: QaMap[] }).__qaMaps ?? [];
  const map = maps[maps.length - 1];
  if (!map) return { maps: 0, source: null, circles: null, label: null, rendered: [] };
  const circles = map.getLayer('spot-areas');
  const label = map.getLayer('spot-area-label');
  return {
    maps: maps.length,
    source: map.getStyle().sources['spot-areas'] ?? null,
    circles: circles ? { type: circles.type, source: circles.source, radius: map.getPaintProperty('spot-areas', 'circle-radius') } : null,
    label: label ? { type: label.type, source: label.source, textField: map.getLayoutProperty('spot-area-label', 'text-field') } : null,
    rendered: circles ? map.queryRenderedFeatures({ layers: ['spot-areas'] }).map((feature) => feature.properties) : [],
  };
}

test.describe('F18 STREET DEX: the Spots layer on Treffen › Karte', () => {
  test('consent → Spots on → city circles labelled by city, no car, no member, no other third party', async ({ page, context }, testInfo) => {
    test.setTimeout(240_000);
    const [owner, spotter] = await members('f18layerowner', 'f18layerspotter');
    await named(owner, 'Ole F18', 'Bonn');
    await named(spotter, 'Nele F18', 'Bonn');
    // Spots of accounts younger than 24 hours are not counted (contract §2).
    await ageTestMember(spotter.email, 3);

    // A city no one has spotted in: the tenth free one for Chromium, the ninth for WebKit, so the two projects and F18 (the first
    // three) never share one.
    const free = (await dexFreeCities(10)).cities as City[];
    const city = free[free.length - 1 - (testInfo.project.name === 'webkit' ? 1 : 0)];
    expect(city, 'dex-free-cities answered fewer than 10 cities').toBeTruthy();
    const cars: string[] = [];
    for (let index = 0; index < CARS; index++) {
      const car = await buildVehicle(owner.api, { photos: 1, nickname: `F18Spot${index}${owner.username.slice(-4)}` });
      cars.push(car.id);
      await dexSpotFixture(spotter.email, car.id, city!.id, { count: 1, hoursAgo: 48 });
    }
    await dexForgetSpotMap();

    // The observable: every MapLibre map the page creates, recorded as the library script hands maplibregl to the window.
    await page.addInitScript(() => {
      const maps: unknown[] = [];
      Object.defineProperty(window, '__qaMaps', { value: maps });
      let lib: unknown;
      Object.defineProperty(window, 'maplibregl', {
        configurable: true,
        get: () => lib,
        set: (value: { Map?: new (options: unknown) => object } | undefined) => {
          const Base = value?.Map;
          if (!value || !Base) {
            lib = value;
            return;
          }
          class RecordedMap extends Base {
            constructor(options: unknown) {
              super(options);
              maps.push(this);
            }
          }
          lib = Object.create(value, { Map: { value: RecordedMap } });
        },
      });
    });

    // Every request that leaves the app's origin; only the tile style may, and only after the tap.
    const thirdParty: string[] = [];
    page.on('request', (request: Request) => {
      const url = new URL(request.url());
      if (/^(https?|wss?):$/.test(url.protocol) && url.origin !== ORIGIN) thirdParty.push(request.url());
    });
    await page.route('https://tiles.openfreemap.org/**', async (route) => {
      if (route.request().url() !== STYLE_URL) return route.fallback();
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(STYLE) });
    });
    await page.route(`${ORIGIN}/__qa-map-glyphs/**`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) }),
    );

    await useSession(context, spotter.session);
    // All coming meets, not "Diese Woche": the week's content depends on the calendar day the showcase was seeded (live data), and in a
    // week without a meet a phone shows the empty state where the map would be (EVT-01 weekEmpty). The layer is the subject here.
    await open(page, '/app/events?when=upcoming');
    await expect(id(page, 'EVT-01.root')).toBeVisible();
    await expect(id(page, 'EVT-01.view.map')).toBeVisible();
    expect(thirdParty, 'the list loads nothing from a third party').toEqual([]);

    // Choosing Karte is the reader's consent (mapConsent.ts): only now the style is asked for.
    await id(page, 'EVT-01.view.map').click();
    const chip = id(page, 'EVT-01.map.spots.chip');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('role', 'checkbox');
    await expect(chip).toHaveAccessibleName(de('dex', 'map.layerLabel'));
    await expect(chip).toHaveAttribute('aria-checked', 'false');
    await expect(id(page, 'EVT-01.map.spots.caption')).toHaveCount(0);

    // (1) On: the layer reads the public spot map and the centroid file, the chip is checked.
    const answer = page.waitForResponse((response: Response) => new URL(response.url()).pathname === '/api/v1/spot-map');
    await chip.click();
    const spotMap = (await (await answer).json()) as SpotMapAnswer;
    await expect(chip).toHaveAttribute('aria-checked', 'true');

    // (3) The rule that keeps the layer private.
    expect(de('dex', 'map.caption')).toBe(CAPTION);
    await expect(id(page, 'EVT-01.map.spots.caption')).toHaveText(CAPTION);

    // The cities the layer must draw: the answer's, placed by id from the public centroid file, in the answer's order.
    const ours = spotMap.data.cities.find((entry) => entry.city_id === city!.id);
    expect(ours, `${city!.name} (5 cars, 48 h) is on GET spot-map`).toMatchObject({ name: city!.name, count: CARS });
    const centroids = (await (await page.request.get('/geo/de-cities.json')).json()) as { cities: [number, string, string, number, number, number][] };
    const known = new Map(centroids.cities.map((row) => [row[0], row]));
    const expected = spotMap.data.cities.filter((entry) => entry.count > 0 && known.has(entry.city_id));
    const busiest = Math.max(...expected.map((entry) => entry.count));
    const radius = (count: number) => Math.round(RADIUS.min + Math.sqrt(count / busiest) * (RADIUS.max - RADIUS.min));

    // (2) The controller drew them: its source holds one feature per city, and the circle layer renders ours.
    await expect.poll(async () => (await page.evaluate(readLayer)).source?.data.features.length ?? 0, { timeout: 20_000 }).toBe(expected.length);
    await expect
      .poll(async () => (await page.evaluate(readLayer)).rendered.map((properties) => properties.label), { timeout: 20_000 })
      .toContain(city!.name);
    const layer = await page.evaluate(readLayer);
    expect(layer.maps).toBeGreaterThan(0);
    expect(layer.circles).toEqual({ type: 'circle', source: 'spot-areas', radius: ['get', 'radius'] });
    expect(layer.label).toEqual({ type: 'symbol', source: 'spot-areas', textField: ['get', 'label'] });
    const features = layer.source!.data.features;
    expect(
      features.map((feature) => ({ label: feature.properties.label, radius: feature.properties.radius, at: feature.geometry.coordinates })),
    ).toEqual(expected.map((entry) => ({ label: entry.name, radius: radius(entry.count), at: [known.get(entry.city_id)![4], known.get(entry.city_id)![3]] })));
    for (const feature of features) {
      // A city name, a radius, a point: nothing else.
      expect(Object.keys(feature).sort()).toEqual(['geometry', 'properties', 'type']);
      expect(Object.keys(feature.properties).sort()).toEqual(['label', 'radius']);
      expect(feature.geometry.type).toBe('Point');
      expect(typeof feature.properties.label === 'string' && feature.properties.label.length > 0).toBe(true);
    }
    for (const properties of layer.rendered) expect(Object.keys(properties).sort()).toEqual(['label', 'radius']);
    // No vehicle id and no member anywhere in the layer data.
    const text = JSON.stringify(layer);
    for (const trace of [...cars, owner.username, spotter.username, owner.email, spotter.email, 'Ole F18', 'Nele F18', 'vehicle', 'spotter']) {
      expect(text, `the layer data holds "${trace}"`).not.toContain(trace);
    }

    // (4) The tile style is the only request that left the origin; nothing else was even attempted.
    expect([...new Set(thirdParty)]).toEqual([STYLE_URL]);

    // One picture of the drawn layer for the record (an artifact, not a baseline).
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const maps = (window as unknown as { __qaMaps: { once: (name: string, fn: () => void) => void; triggerRepaint: () => void }[] }).__qaMaps;
          const map = maps[maps.length - 1]!;
          const done = setTimeout(resolve, 5_000);
          map.once('idle', () => {
            clearTimeout(done);
            resolve();
          });
          map.triggerRepaint();
        }),
    );
    await testInfo.attach('EVT-01-spots-map', { body: await page.screenshot(), contentType: 'image/png' });
  });
});
