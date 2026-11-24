/** Season Wrapped tests: the payload and the list as the contract (m5.9e §3/§5) has the server send them. */
import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';

import { newQueryClient } from '../qr/harness';

export { newQueryClient, renderScreen, signIn, signOut, stubFetch, type Answer } from '../qr/harness';

/**
 * A query client whose app config has the Wrapped flags as given; both on by default. Client round 6 (L2): `GET me/wrapped` goes
 * out only while `wrapped` is on (and, for the Home banner, `wrapped.countdown`).
 */
export function wrappedClient(flags: Record<string, boolean> = { wrapped: true, 'wrapped.countdown': true }) {
  const client = newQueryClient();
  client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: { ...BUNDLED_APP_CONFIG.flags, ...flags } }, confirmed: true });
  return client;
}

export const SEASON = '2027-saison';

const media = (name: string) => ({
  id: name,
  blurhash: 'LoGlekxvjYof_Nt7ayj]M{j@ofWB',
  thumbhash: null,
  focal_x: 0.5,
  focal_y: 0.6,
  variants: [
    { width: 640, height: 800, url: `https://speedclub.test/media/${name}-640.jpg` },
    { width: 1280, height: 1600, url: `https://speedclub.test/media/${name}-1280.jpg` },
  ],
});

/** All nine cards with data. */
export function rawCards(): Record<string, unknown>[] {
  return [
    { kind: 'intro', title: 'Deine Saison 2027', subtitle: 'Vom ersten Treffen im März bis zum Saisonende im Oktober.' },
    { kind: 'spots', count: 47, unique_cars: 31, cities: ['Düsseldorf', 'Köln', 'Essen'], rarest: { dex_number: 412, rarity: 'legend', vehicle_name: 'Honda NSX NA1', make: 'Honda', generation: 'NA1' } },
    { kind: 'scans', sticker_scans: 128, profile_or_vehicle_views: null, top_city: 'Düsseldorf' },
    { kind: 'score', from: 412, to: 642, stage_from: 3, stage_to: 4, vehicle_name: 'Nissan Skyline GT-R R34' },
    { kind: 'top_mod', name: 'Meister S1 3P', brand: 'Work', before_media: media('before'), after_media: media('after'), vehicle_name: 'Nissan Skyline GT-R R34' },
    { kind: 'treffen', attended: 6, names: ['Cars & Coffee Düsseldorf', 'JDM Sonntag am Rhein'] },
    { kind: 'build_spirit', key: 'shakotan_artist', title: 'Shakotan Artist', explanation: 'Fahrwerk, Felgen und Stance machen mehr als die Hälfte deiner Mods aus.' },
    { kind: 'percentile', bundesland: 'NRW', percentile: 'Top 12 %', metric: 'build_score' },
    { kind: 'share', vehicle_name: 'Nissan Skyline GT-R R34', dex_number: 34, score: 642, stage: 4, qr_url: 'https://speedclub.de/v/nissan-skyline-gt-r-r34-5tf974vj', qr_svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><path d="M0 0h7v7H0z"/></svg>', image: media('cover') },
  ];
}

export function rawPayload(cards: Record<string, unknown>[] = rawCards()) {
  return {
    data: {
      v: 1,
      season_key: SEASON,
      window: { from: '2027-03-01', to: '2027-10-31' },
      member: { display_name: 'Lukas', username: 'lukas.sc', avatar: null },
      cards,
    },
  };
}

export function rawList(seasons: Record<string, unknown>[], countdown: Record<string, unknown> | null = null) {
  return { data: seasons, meta: { countdown } };
}
