// Garage data for the M1.6 and M1.7 specs and the visual registry: the seeded flagship, and fresh members under
// E2E_DOMAIN whose vehicles are built through the API the app itself uses (docs/reports/phase-1/m1.6-api-handover.md).
// Demo members are only read here, never changed. A fresh member and everything it owns goes in the global teardown of
// the Playwright run (support/backend.mjs deleteTestAccounts), vehicles, photos and QR codes with it.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { request } from '@playwright/test';
import { apiLogin, DEMO_AFFECTED, DEMO_MEMBER, sessionOf } from './auth.mjs';
import { createMember, E2E_DOMAIN } from './backend.mjs';
import { BASE_URL } from './qa.mjs';
import { withStartLock } from './start-lock.mjs';

/** DemoSeeder's flagship (docs/07_QA_AND_RELEASE.md, test data): lukas.sc's R34, public, QR 8TR0Q3MC. */
export const R34 = {
  slug: 'nissan-skyline-gt-r-r34-5tf974vj',
  code: '8TR0Q3MC',
  shortCode: '8TR0 Q3MC',
  title: 'Nissan Skyline GT-R',
  owner: 'lukas.sc',
};
/**
 * The resolver's demo states (DemoSeeder::seedQrCodes, ADR-148): a reissued code, a private vehicle, an unknown code.
 * The titles of WEB-06 and QR-RESOLVE as copy. Both render a word joiner (U+2060) after "QR-" that keeps "QR-Code" on one
 * line (DQ-162); compare them with support/text.mjs expectText, which ignores the joiner and nothing else.
 */
export const QR_STATES = {
  revoked: { code: 'APPY9FZ9', status: 410, title: 'Dieser QR-Code ist nicht mehr gültig' },
  private: { code: '5A7XE8ET', status: 404, title: 'Dieses Fahrzeug ist privat' },
  notFound: { code: 'ZZZZZZZZ', status: 404, title: 'Diesen QR-Code kennen wir nicht' },
};
/** A private demo vehicle: "Fahrzeug nicht verfügbar" for anybody but its owner. */
export const PRIVATE_SLUG = 'toyota-gr86-zn8-6g12gv4h';

const PHOTO_DIR = new URL('../../../../design/seed-photos/', import.meta.url);
/** Real photos for uploads, re-encoded by the server like any other. */
export const SEED_PHOTOS = ['generic-exterior-01.jpg', 'generic-wheels-01.jpg', 'generic-interior-01.jpg', 'generic-engine-01.jpg'];
export const photoPath = (/** @type {string} */ name) => new URL(name, PHOTO_DIR);
/** The same photo as a path on this machine, for a file chooser. */
export const photoFile = (/** @type {string} */ name) => fileURLToPath(photoPath(name));

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let sequence = 0;
/** Ten characters and more, not in the common list, not the address. */
export const GARAGE_PASSWORD = `Ladedruck-${RUN}-Kehre`;

/**
 * @typedef {{status:number, body:any, headers:Record<string,string>}} ApiAnswer
 * @typedef {{
 *   get:(path:string)=>Promise<ApiAnswer>,
 *   post:(path:string, data?:object, opts?:{idempotent?:boolean, key?:string})=>Promise<ApiAnswer>,
 *   patch:(path:string, data:object)=>Promise<ApiAnswer>,
 *   put:(path:string, data:object)=>Promise<ApiAnswer>,
 *   delete:(path:string)=>Promise<ApiAnswer>,
 *   upload:(path:string, file:string, fields?:Record<string,string>)=>Promise<ApiAnswer>,
 *   dispose:()=>Promise<void>,
 * }} MemberApi
 */

/**
 * The API as the web app calls it with this session: same origin, XSRF header, JSON.
 * @param {import('./auth.mjs').MemberSession} session
 * @returns {Promise<MemberApi>}
 */
export async function memberApi(session) {
  const xsrf = decodeURIComponent(session.cookies.find((c) => c.name === 'XSRF-TOKEN')?.value ?? '');
  const context = await request.newContext({
    baseURL: BASE_URL,
    // The session cookies as the browser holds them; apiLogin read them from a storage state of the same shape.
    storageState: { cookies: /** @type {any} */ (session.cookies), origins: [] },
    // A new connection per request: a kept-alive socket that Apache closed in between answered with ECONNRESET.
    extraHTTPHeaders: { Accept: 'application/json', Origin: BASE_URL, Referer: `${BASE_URL}/app/`, 'X-XSRF-TOKEN': xsrf, Connection: 'close' },
  });
  const answer = async (/** @type {import('@playwright/test').APIResponse} */ response) => ({
    status: response.status(),
    body: response.status() === 204 ? null : await response.json().catch(() => null),
    headers: response.headers(),
  });
  const url = (/** @type {string} */ path) => `/api/v1/${path.replace(/^\//, '')}`;
  return {
    get: async (path) => answer(await context.get(url(path))),
    // `key` repeats a request with the same Idempotency-Key, as a retry after a lost answer does.
    post: async (path, data = {}, { idempotent = true, key } = {}) =>
      answer(await context.post(url(path), { data, headers: idempotent ? { 'Idempotency-Key': key ?? randomUUID() } : {} })),
    patch: async (path, data) => answer(await context.patch(url(path), { data })),
    put: async (path, data) => answer(await context.put(url(path), { data })),
    delete: async (path) => answer(await context.delete(url(path))),
    upload: async (path, file, fields = {}) =>
      answer(
        await context.post(url(path), {
          multipart: { ...fields, file: { name: file, mimeType: 'image/jpeg', buffer: readFileSync(photoPath(file)) } },
          headers: { 'Idempotency-Key': randomUUID() },
          timeout: 60_000,
        }),
      ),
    dispose: () => context.dispose(),
  };
}

/** Fails with the server's answer instead of a later, puzzling one. */
export function expectStatus(/** @type {ApiAnswer} */ answer, /** @type {number} */ status, /** @type {string} */ what) {
  if (answer.status !== status) throw new Error(`${what}: HTTP ${answer.status} instead of ${status}: ${JSON.stringify(answer.body).slice(0, 600)}`);
  return answer.body;
}

/**
 * A new member under E2E_DOMAIN who finished onboarding, with an empty garage, signed in through the API.
 * @param {string} label part of the address, for reading the database
 */
export async function createGarageMember(label) {
  const n = ++sequence;
  const email = `garage.${label}.${RUN}.${n}@${E2E_DOMAIN}`;
  const username = `g${RUN}${n}`.slice(0, 24);
  await createMember(email, username, GARAGE_PASSWORD);
  const session = await apiLogin(email, GARAGE_PASSWORD);
  return { email, username, session, api: await memberApi(session) };
}

/** @type {Map<string, Promise<number>>} */
const catalogue = new Map();

/**
 * The id of a catalogue entry by its name, from the lists the wizard's sheets read.
 * @param {MemberApi} api
 * @param {string} path catalog/makes, catalog/makes/{id}/models or catalog/models/{id}/generations
 * @param {string} name
 */
function catalogueId(api, path, name) {
  const key = `${path}|${name}`;
  let id = catalogue.get(key);
  if (!id) {
    id = (async () => {
      for (let cursor = ''; ; ) {
        const page = expectStatus(await api.get(`${path}?per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`), 200, path);
        const hit = page.data.find((/** @type {{name:string}} */ entry) => entry.name === name);
        if (hit) return hit.id;
        cursor = page.meta?.next_cursor ?? '';
        if (!cursor) throw new Error(`${name} is not in ${path}`);
      }
    })();
    id.catch(() => catalogue.delete(key));
    catalogue.set(key, id);
  }
  return id;
}

/**
 * Catalogue ids of a make, model and generation.
 * @param {MemberApi} api
 * @param {{make:string, model:string, generation?:string}} names
 */
export async function catalogueIds(api, { make, model, generation }) {
  const makeId = await catalogueId(api, 'catalog/makes', make);
  const modelId = await catalogueId(api, `catalog/makes/${makeId}/models`, model);
  const generationId = generation ? await catalogueId(api, `catalog/models/${modelId}/generations`, generation) : null;
  return { make_id: makeId, model_id: modelId, generation_id: generationId };
}

/** The R34 of the wizard walk: what F2 types in, and what fixtures build without the wizard. */
export const SKYLINE = { make: 'Nissan', model: 'Skyline GT-R', generation: 'R34', year: 2002 };
export const SKYLINE_SPECS = {
  engine_code: 'RB26DETT',
  engine_text: '2,6 l R6 Biturbo',
  displacement_cc: 2568,
  fuel: 'petrol',
  aspiration: 'biturbo',
  power_value: 280,
  power_unit: 'ps',
  power_source: 'factory',
  torque_nm: 392,
  torque_source: 'factory',
  drivetrain: 'all',
  gearbox: 'manual',
};
/** FS-6's example mod, in the strict JSON types of the category schema. */
export const BBS_WHEELS = {
  category: 'wheels_tires',
  status: 'installed',
  installed_on: '2023-03',
  fields: { wheel_brand: 'BBS', wheel_model: 'LM', diameter: 19, width_front: 9.5, et_front: 35, tyre_size_front: '255/35 R19' },
};

/**
 * A vehicle of this member built through the API, as the wizard would: draft, specs, photos, then publish unless `draft`.
 * @param {MemberApi} api
 * @param {{car?:typeof SKYLINE, photos?:number, specs?:object|null, draft?:boolean, visibility?:'public'|'unlisted'|'private', mods?:object[], nickname?:string}} [opts]
 * @returns {Promise<{id:string, slug:string, qr:{code:string,url:string}|null, photos:{id:string}[], mods:{id:string}[]}>}
 */
export async function buildVehicle(api, { car = SKYLINE, photos = 1, specs = SKYLINE_SPECS, draft = false, visibility, mods = [], nickname } = {}) {
  const ids = await catalogueIds(api, car);
  const created = expectStatus(
    await api.post('vehicles', { ...ids, model_year: car.year, wizard_step: 2, ...(nickname ? { nickname } : {}) }),
    201,
    'POST vehicles',
  ).data;
  if (specs) expectStatus(await api.put(`vehicles/${created.id}/specs`, specs), 200, 'PUT specs');
  const uploaded = [];
  for (let i = 0; i < photos; i++) {
    const file = /** @type {string} */ (SEED_PHOTOS[i % SEED_PHOTOS.length]);
    uploaded.push(expectStatus(await api.upload(`vehicles/${created.id}/media`, file), 201, `POST media ${file}`).data);
  }
  let vehicle = created;
  if (!draft) {
    // A publish changes Start's Neue Builds: it waits while a spec holds them (support/start-lock.mjs).
    vehicle = expectStatus(await withStartLock(() => api.post(`vehicles/${created.id}/publish`, visibility ? { visibility } : {})), 200, 'POST publish').data;
  }
  const madeMods = [];
  for (const mod of mods) madeMods.push(expectStatus(await api.post(`vehicles/${created.id}/mods`, mod), 201, 'POST mods').data);
  return { id: vehicle.id, slug: vehicle.slug, qr: vehicle.qr ?? null, photos: uploaded, mods: madeMods };
}

/** @typedef {{r34:string, r34Photo:string, r34Mod:string, r34Update:string, draft:string, s15:string, decision:string}} DemoIds */

/** @type {Promise<DemoIds>|null} */
let demo = null;

/**
 * Ids of the seeded demo data the registry and specs open: lukas.sc's vehicles (ULIDs are new after every seed), the
 * R34's photos, mods and build updates, and the E30 draft. Read once per process as lukas.sc, with the session the
 * `member` strategy uses, and never written. `decision` is the seeded decision of ModerationDemoSeeder (its id is new after
 * every seed), read as tobi.quattro, the member it affects.
 * @returns {Promise<DemoIds>}
 */
export function demoIds() {
  demo ??= readDemoIds();
  demo.catch(() => {
    demo = null;
  });
  return demo;
}

async function readDemoIds() {
  const api = await memberApi(await sessionOf(DEMO_MEMBER));
  try {
    const garage = expectStatus(await api.get('me/vehicles'), 200, 'GET me/vehicles').data;
    const r34 = garage.find((/** @type {{slug:string}} */ v) => v.slug === R34.slug);
    const draft = garage.find((/** @type {{status:string}} */ v) => v.status === 'draft');
    if (!r34 || !draft) throw new Error('lukas.sc has no R34 or no draft: run the DemoSeeder (docs/07_QA_AND_RELEASE.md, test data).');
    const vehicle = expectStatus(await api.get(`vehicles/${r34.id}`), 200, 'GET R34').data;
    const mods = expectStatus(await api.get(`vehicles/${r34.id}/mods?per_page=100`), 200, 'GET R34 mods').data;
    const updates = expectStatus(await api.get(`vehicles/${r34.id}/updates?per_page=30`), 200, 'GET R34 updates').data;
    const decision = await seededDecision();
    const wheels = mods.find((/** @type {{category:{key:string}|string}} */ m) => (typeof m.category === 'string' ? m.category : m.category?.key) === 'wheels_tires');
    const update = updates.find((/** @type {{hidden:boolean,changes_count:number}} */ u) => !u.hidden && u.changes_count > 0) ?? updates[0];
    return {
      r34: r34.id,
      r34Photo: vehicle.photos[0]?.id,
      r34Mod: wheels?.id ?? mods[0]?.id,
      r34Update: update?.id,
      draft: draft.id,
      s15: garage.find((/** @type {{slug:string,status:string}} */ v) => v.status !== 'draft' && v.slug !== R34.slug)?.id,
      decision,
    };
  } finally {
    await api.dispose();
  }
}

/** The id of the decision ModerationDemoSeeder made about tobi.quattro's RS6 photo (m2.6-api-handover.md §7). Read only. */
async function seededDecision() {
  const api = await memberApi(await sessionOf(DEMO_AFFECTED));
  try {
    const decisions = expectStatus(await api.get('me/decisions'), 200, 'GET me/decisions of tobi.quattro').data;
    const id = decisions[0]?.id;
    if (!id) throw new Error('tobi.quattro has no decision: run the DemoSeeder with demo photos (m2.6-api-handover.md §7).');
    return /** @type {string} */ (id);
  } finally {
    await api.dispose();
  }
}
