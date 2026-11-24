// Visual registry entries of M5.8 Forum, app part (docs/10_CLIENT_ROUND_1.md §7, §1; server contract docs/reports/phase-5/m5.8-contract.md).
// Same fields as the entries in routes.mjs, which merges this list. FOR-01/02/05 read the seeded forum (ForumSampleSeeder: 25 German
// sample threads, badged "Beispiel", with topic photos and the authors' cars); FOR-03 ★ shows one seeded thread, answered from its own
// API answers at a stable address (seededThread), so every part of the flagship is real seed data (photo, attached car, solution, an
// answer one level in, votes). These cells need the M5.8 server (routes/api/v1/forum.php).

/** A screen with data: the loaded element in the default state, the root in a forced one (routes.mjs loadedOr). */
const loadedOr = (/** @type {string} */ loaded, /** @type {string} */ root) =>
  `[data-qa-state="default"] ${loaded}, [data-qa-state]:not([data-qa-state="default"]) [data-testid="${root}"]`;

import { QA_NOW } from '../support/qa.mjs';

const HOUR = 3600 * 1000;
// Relative to the cell's fixed clock (browser clock and qaNow are QA_NOW), never the machine's: "20 hours ago" must be the app's.
const iso = (/** @type {number} */ offset) => new Date(Date.parse(QA_NOW) + offset).toISOString();

/** The staged thread's id: a valid ULID that no seed uses. */
export const THREAD = '01JQ0F0RVMSTAGEDTHREAD0001';
export const THREAD_PATH = new RegExp(`/api/v1/forum/threads/${THREAD}(\\?.*)?$`);
export const POSTS_PATH = new RegExp(`/api/v1/forum/threads/${THREAD}/posts(\\?.*)?$`);

const member = (/** @type {string} */ username, /** @type {string|null} */ name) => ({
  username,
  display_name: name,
  city: null,
  avatar: null,
  is_sample: true,
  is_editorial: false,
});

/** FOR-03 ★ shows this seeded thread (ForumSampleSeeder): Fahrwerk, solved, an answer one level in, "Hilfreich" votes, the author's
 * attached E46 and a topic photo of it. Its id changes with every seed, so the cells keep a stable address (THREAD) and the stage
 * answers it with the seeded thread's own API answers (DQ-P5-005: no invented thread, no photos of other entities). */
const SEEDED_SLUG = 'gewindefahrwerk-im-alltag-wie-hart-ist-zu-hart';
/** FOR-03-pending is lukas.sc's own thread: a seeded one about his kind of car (he drives the R34), not Jonas's E46 text under his name. */
const SEEDED_OWN_SLUG = 'r34-ersatzteile-wo-bestellt-ihr-in-deutschland';

/**
 * Moves every timestamp (`…_at`) of the answers by the same amount, so the thread's last activity lies 2 hours before the cell's clock
 * (QA_NOW): the seed writes them at seeding time, which is after the app's fixed today, and "14.11.2026" would be a date in the future.
 * @param {unknown} value
 * @param {number} shift ms
 * @returns {any}
 */
function shiftTimes(value, shift) {
  if (Array.isArray(value)) return value.map((item) => shiftTimes(item, shift));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key.endsWith('_at') && typeof item === 'string' && !Number.isNaN(Date.parse(item)) ? new Date(Date.parse(item) + shift).toISOString() : shiftTimes(item, shift),
    ]),
  );
}

/**
 * The seeded thread and its posts as the member reads them (the member's cookie session counts only from the app's origin), with its
 * id replaced by THREAD everywhere (path, share address, the posts' thread_id). Throws when the seed does not have it: the cell would
 * otherwise show "Dieses Thema gibt es nicht mehr". Also used by routes-m59-ai.mjs (FOR-03's KI-Zusammenfassung).
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 */
export async function seededThread(page, baseUrl, slug = SEEDED_SLUG) {
  const headers = { Accept: 'application/json', Origin: baseUrl, Referer: `${baseUrl}/app/forum` };
  const read = async (/** @type {string} */ path) => {
    const answer = await page.request.get(`${baseUrl}/api/v1/${path}`, { headers });
    if (!answer.ok()) throw new Error(`FOR-03 stage: GET ${path} answered ${answer.status()}`);
    return answer.json();
  };
  /** @type {any} */
  let row = null;
  for (let cursor = null, pages = 0; row === null && pages < 5; pages++) {
    const list = await read(`forum/threads?per_page=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    row = (list.data ?? []).find((/** @type {any} */ thread) => thread.slug === slug) ?? null;
    cursor = list.meta?.next_cursor ?? null;
    if (!cursor) break;
  }
  if (row === null) throw new Error(`FOR-03 stage: the seeded thread "${slug}" is not in the forum (ForumSampleSeeder)`);
  const [thread, posts] = await Promise.all([read(`forum/threads/${row.id}`), read(`forum/threads/${row.id}/posts?per_page=20`)]);
  const shift = Date.parse(QA_NOW) - 2 * HOUR - Date.parse(thread.data.last_activity_at ?? thread.data.created_at);
  const swap = (/** @type {unknown} */ value) => shiftTimes(JSON.parse(JSON.stringify(value).replaceAll(row.id, THREAD)), shift);
  return { thread: swap(thread), posts: swap(posts) };
}

/**
 * Stages FOR-03 from the seeded thread; `locked` and `status`/`own` change only what makes the variant.
 * @param {{ locked?: boolean, status?: string, own?: boolean }} options
 */
const stagedThread =
  ({ locked = false, status = 'published', own = false } = {}) =>
  async (/** @type {import('./route-steps.mjs').RouteStepContext} */ { page, stage, baseUrl }) => {
    const { thread, posts } = await seededThread(page, baseUrl, own ? SEEDED_OWN_SLUG : SEEDED_SLUG);
    const data = thread.data;
    if (locked) {
      data.is_locked = true;
      data.viewer = { ...data.viewer, can_reply: false };
    }
    if (status !== 'published') {
      // lukas.sc's own thread waiting for review (pre-moderation): nobody has answered it, so no solution and no replies.
      Object.assign(data, { status, is_solved: false, solution: null, replies_count: 0, last_poster: null, review_reason: null });
      posts.data = [];
    }
    if (own) {
      data.author = member('lukas.sc', 'Lukas Scholz');
      data.vehicle = null;
      data.body = (data.content ?? [])
        .map((/** @type {any} */ block) => (block.children ?? []).map((/** @type {any} */ child) => child.text ?? '').join(''))
        .filter(Boolean)
        .join('\n\n');
      data.viewer = { ...data.viewer, is_author: true, subscribed: false, can_reply: false, can_edit: true, can_delete: true, can_mark_solution: false, can_report: false };
    }
    await stage(POSTS_PATH, { body: posts });
    await stage(THREAD_PATH, { body: { ...thread, data } });
  };

/**
 * FOR-05 "Gestartet" for lukas.sc (p5r1 capture: he has no thread of his own, so the default cell looked like the empty one): three
 * own threads in their states (published and solved, in review, not approved with the staff's reason), badged "Beispiel".
 * @param {import('./route-steps.mjs').RouteStepContext} ctx
 */
async function stagedMine({ stage }) {
  const row = (/** @type {Record<string, any>} */ extra) => ({
    slug: 'beispiel',
    category: { id: 3, slug: 'fahrwerk', name: 'Fahrwerk', kind: 'standard' },
    author: member('lukas.sc', 'Lukas Scholz'),
    vehicle: null,
    tags: [],
    is_pinned: false,
    is_locked: false,
    is_solved: false,
    replies_count: 0,
    last_poster: null,
    has_photos: false,
    is_sample: true,
    ...extra,
    path: `/forum/${extra.id}`,
  });
  await stage(/\/api\/v1\/me\/forum\/threads(\?.*)?$/, {
    body: {
      data: [
        row({ id: '01JQ0F0RVMSTAGEDM1NE000001', title: 'Welche Federn für den E46 Touring mit Anhängerkupplung?', status: 'published', is_solved: true, replies_count: 3, last_activity_at: iso(-2 * HOUR), last_poster: member('kenji.r34', 'Kenji') }),
        row({ id: '01JQ0F0RVMSTAGEDM1NE000002', title: 'Bremsen quietschen nach dem Belagwechsel', status: 'pending', last_activity_at: iso(-5 * HOUR) }),
        row({ id: '01JQ0F0RVMSTAGEDM1NE000003', title: 'Werkstatt für Achsvermessung in Hamburg gesucht', status: 'rejected', review_reason: 'Bitte im Unterforum Werkstätten & Teile fragen.', last_activity_at: iso(-30 * HOUR) }),
      ],
      links: {},
      meta: { next_cursor: null, prev_cursor: null, per_page: 20, path: null },
    },
  });
}

/** @type {import('./matrix.mjs').RouteDef[]} */
export const routesM58 = [
  {
    id: 'FOR-01',
    path: '/app/forum',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'empty', 'error', 'offline'],
    ready: loadedOr('[data-testid^="FOR-01.thread."]', 'FOR-01.root'),
    capture: 'expanded',
    maxHeight: 2400,
    // DQ-P5-031: the axes this page changes (09 §14.1).
    p4: { en: true, tablet: true, black: true, small: true },
    fs2: true,
    notes:
      'M5.8 FOR-01 Entdecken › Forum (10 §1, §7.2): title "Entdecken" with bell and Nachrichten under 1280 ("Forum" from 1280, where the sidebar lists Forum), the segmented control Builds · Treffen · Forum (Forum selected), "Forum durchsuchen", the chip row "Sortiert: Aktiv" (opens the sort sheet) | Alle · the top-level categories, then the thread rows: category and car tags, the title (headline, 3 lines max), "Gelöst", the reply count (caption, tnum), last activity "vor 2 Std. · @name", "Beispiel" on the seeded samples, the attached car\'s photo at the row end. Empty: the badged sample row, "Hier ist es noch ruhig", "Thema starten".',
  },
  {
    id: 'FOR-01-unanswered',
    path: '/app/forum?sort=unanswered',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid^="FOR-01.thread."], [data-testid="FOR-01.emptyUnanswered"]',
    notes: 'Sorted "Unbeantwortet" from the address: the sort chip reads "Sortiert: Unbeantwortet"; rows without a reply ("Noch keine Antwort"), or "Jede Frage hat schon eine Antwort" with "Aktiv".',
  },
  {
    id: 'FOR-01-sortSheet',
    path: '/app/forum',
    phase: 3,
    auth: 'member',
    states: ['default'],
    // DQ-P5-031: the axes this page changes (09 §14.1).
    fs2: true,
    p4: { en: true, black: true },
    walk: async ({ page }) => {
      await page.getByTestId('FOR-01.sort').click();
    },
    ready: '[data-testid="FOR-01.sortSheet.solved"]',
    notes: 'The sort sheet "Themen sortieren": Aktiv (selected) · Neu · Unbeantwortet · Gelöst as radio rows.',
  },
  {
    id: 'FOR-02',
    path: '/app/forum/c/technik-tuning',
    phase: 3,
    auth: 'guest',
    states: ['default', 'loading', 'error'],
    // DQ-P5-031: the axes this page changes (09 §14.1).
    fs2: true,
    p4: { en: true, black: true },
    ready: loadedOr('[data-testid^="FOR-02.thread."], [data-testid="FOR-02.empty"]', 'FOR-02.root'),
    capture: 'expanded',
    maxHeight: 2400,
    notes: 'M5.8 FOR-02 Kategorie "Technik & Tuning" (guest): large title with back, its description, search, sort chip | Alle · Motor · Fahrwerk · Bremsen · Räder & Reifen · Abgasanlage · Elektronik, the rows of the category and its sub-forums.',
  },
  {
    id: 'FOR-03',
    path: `/app/forum/${THREAD}`,
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'empty', 'error', 'restricted'],
    ready: loadedOr('[data-testid="FOR-03.solutionBlock"]', 'FOR-03.root'),
    capture: 'expanded',
    prepare: stagedThread(),
    p4: { en: true, black: true, tablet: true },
    fs2: true,
    notes:
      'M5.8 FOR-03 ★ (10 §7.2; the seeded sample thread "Gewindefahrwerk im Alltag: wie hart ist zu hart?" by Jonas Becker, badged "Beispiel", DQ-P5-005): compact header "Forum" with back, bell, Teilen, Mehr; the thread\'s own photo (the E46\'s BMW M wheel close-up) as the lead, edge to edge on phones (radius 20 from 768), the tag line Fahrwerk · Gelöst · Beispiel, the title in title.1, the author with avatar and time, the opening post with its list, #gewinde #alltag, the attached car (BMW M3 E46), the solution card ("Gelöst", "Lösung von @fabian.e92", "Zur Antwort"), "4 Antworten" with Chronologisch · Hilfreichste, then the replies: Fabian Walter\'s solution with "Hilfreich 4" and Jonas\'s answer one level in, Robin Pohl ("Hilfreich 2"), Nora Demir. The reply bar at the bottom. Forced states: skeleton (photo, tags, title, author, text), "Dieses Thema gibt es nicht mehr", error + retry, restricted (the forum-ban line in place of the composer).',
  },
  {
    id: 'FOR-03-locked',
    path: `/app/forum/${THREAD}`,
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="FOR-03.closed"]',
    prepare: stagedThread({ locked: true }),
    notes: 'A locked thread: the notice "Geschlossen: …" under the photo, no "Antworten" on the replies (votes stay), the bar says "Neue Antworten sind hier nicht mehr möglich."',
  },
  {
    id: 'FOR-03-pending',
    path: `/app/forum/${THREAD}`,
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="FOR-03.pending"]',
    prepare: stagedThread({ status: 'pending', own: true }),
    notes: 'The author\'s own thread in pre-moderation (the seeded "R34 Ersatzteile: wo bestellt ihr in Deutschland?", as lukas.sc\'s, without the attached car): the "In Prüfung" notice, no replies yet, no reply bar.',
  },
  {
    id: 'FOR-04',
    path: '/app/forum-composer?category=fahrwerk',
    phase: 3,
    auth: 'member',
    states: ['default', 'restricted'],
    ready: '[data-testid="FOR-04.title"]',
    capture: 'expanded',
    p4: { en: true },
    fs2: true,
    notes:
      'M5.8 FOR-04 Neues Thema (modal sheet, centred 640 from 768): close, "Titel" with its helper, "Kategorie" (Fahrwerk, "Technik & Tuning" under it, opens the picker), "Text" with the Markdown helper, "Schlagwörter", "Fotos 0 von 6" with "Fotos hinzufügen", "Fahrzeug anhängen" chips (Keins + the member\'s cars), sticky "Veröffentlichen". Restricted: the forum-ban notice and a disabled CTA.',
  },
  {
    id: 'FOR-04-similar',
    path: '/app/forum-composer?category=fahrwerk',
    phase: 3,
    auth: 'member',
    states: ['default'],
    // DQ-P5-031: the axes this page changes (09 §14.1).
    fs2: true,
    p4: { en: true, black: true },
    walk: async ({ page }) => {
      // A title the seeded forum answers (DQ-P5-025): "Federn Touring" only ever matched the threads the e2e runs left behind.
      await page.getByTestId('FOR-04.title').fill('Gewindefahrwerk im Alltag zu hart?');
    },
    ready: '[data-testid="FOR-04.similar"]',
    notes: '"Ähnliche Themen" while the title "Gewindefahrwerk im Alltag zu hart?" is typed (forum/similar, debounced): the surface box with its heading, "Vielleicht ist deine Frage schon beantwortet." and the seeded thread it finds ("Gewindefahrwerk im Alltag: wie hart ist zu hart?").',
  },
  {
    id: 'FOR-04-validation',
    path: '/app/forum-composer',
    phase: 3,
    auth: 'member',
    states: ['default'],
    // DQ-P5-031: the axes this page changes (09 §14.1).
    fs2: true,
    p4: { en: true, black: true },
    walk: async ({ page }) => {
      await page.getByTestId('FOR-04.cta.primary').click();
    },
    ready: '[data-testid="FOR-04.category.error"]',
    notes: 'Submitting the empty form: "Mindestens 5 Zeichen." under the title, "Wähl eine Kategorie.", "Mindestens 10 Zeichen." under the text; nothing sent.',
  },
  {
    id: 'FOR-05',
    path: '/app/forum/mine',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'empty', 'error'],
    // DQ-P5-031: the axes this page changes (09 §14.1).
    fs2: true,
    p4: { en: true, black: true },
    ready: loadedOr('[data-testid^="FOR-05.thread."]', 'FOR-05.root'),
    prepare: stagedMine,
    notes: 'M5.8 FOR-05 Meine Themen: large title with back, Gestartet · Abonniert, the member\'s threads with their states (staged, badged "Beispiel": solved with 3 Antworten, "In Prüfung", "Nicht freigegeben" with the staff\'s reason); empty: the badged sample row, "Du hast noch kein Thema gestartet", "Thema starten".',
  },
  {
    id: 'SET-09-forum',
    path: '/app/settings/notifications?qaFlags=forum',
    phase: 3,
    auth: 'member',
    states: ['default'],
    // DQ-P5-031: the axes this page changes (09 §14.1).
    fs2: true,
    p4: { black: true },
    ready: '[data-testid="SET-09.forum"]',
    capture: 'expanded',
    notes: 'SET-09 with the category "Forum" after Treffen: Antworten im Forum (with "Höchstens alle 30 Minuten …"), Erwähnungen im Forum, Deine Antwort ist die Lösung; push on by default.',
  },
];
