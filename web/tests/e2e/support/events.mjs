// M4.12 visual data (EVT-02/03/05/06 organiser cells): lukas.sc organises two events that only he and staff can see — one in
// review (the frozen state, ADR-439) and one draft with the place shown after an RSVP. Found by title or made through the member API
// the app uses, so a second run reuses them and their slugs stay the same within and across runs; nobody else ever sees them (drafts
// and pending events are the organiser's alone, ADR-437), so no other cell changes. The public cells use the seeded sample events
// (ShowcaseEvents, deterministic slugs) instead.
import { DEMO_MEMBER, sessionOf } from './auth.mjs';
import { expectStatus, memberApi } from './garage.mjs';

/**
 * `days` from now at about `hour` in Berlin (summer or winter time does not matter for a picture): always in the future.
 * @param {number} days
 * @param {number} hour
 */
function startsIn(days, hour) {
  const day = new Date(Date.now() + days * 24 * 3600 * 1000);
  day.setUTCHours(hour - 1, 0, 0, 0);
  return day.toISOString();
}

const EVENTS = [
  {
    key: 'pendingEvent',
    body: () => ({
      title: 'Cars & Coffee am Ring',
      type: 'meet',
      visibility: 'public',
      location_visibility: 'public',
      starts_at: startsIn(21, 9),
      ends_at: startsIn(21, 12),
      venue_name: 'Parkplatz Döttinger Höhe',
      street: 'Döttinger Höhe 1',
      postcode: '53520',
      city: 'Nürburg',
      country: 'DE',
      lat: 50.3462,
      lng: 6.9658,
      description: 'Sonntagmorgen am Ring: Kaffee, Builds und Benzingespräche. Motor aus auf dem Platz.',
      organiser_rules: 'Bitte nur auf den markierten Flächen parken.',
      rules: ['legal_only', 'no_racing', 'respect_residents', 'no_litter'],
      capacity: 80,
      accept_rules: true,
      submit: true,
    }),
  },
  {
    key: 'draftEvent',
    body: () => ({
      title: 'Nachtausfahrt Schwarzwaldhochstraße',
      type: 'cruise',
      visibility: 'followers',
      location_visibility: 'after_rsvp',
      starts_at: startsIn(28, 20),
      ends_at: startsIn(28, 23),
      venue_name: 'Wanderparkplatz Ruhestein',
      city: 'Baiersbronn',
      country: 'DE',
      lat: 48.5571,
      lng: 8.2286,
      description: 'Ruhige Runde ab Ruhestein, Tempo nach Verkehrsregeln. Treffpunkt nach deiner Zusage.',
      rules: ['legal_only', 'no_racing', 'respect_residents'],
      accept_rules: true,
      submit: false,
    }),
  },
];

/** @type {Promise<Record<string, string>>|null} */
let ids = null;

/** The slugs of lukas.sc's organiser events, made on first use. */
export function eventFixtureIds() {
  ids ??= (async () => {
    const api = await memberApi(await sessionOf(DEMO_MEMBER));
    try {
      const organised = expectStatus(await api.get('me/events?tab=organised&per_page=50'), 200, 'GET me/events organised').data;
      /** @type {Record<string, string>} */
      const slugs = {};
      for (const event of EVENTS) {
        const body = event.body();
        const found = organised.find((/** @type {{title:string}} */ entry) => entry.title === body.title);
        const data = found ?? expectStatus(await api.post('events', body), 201, `POST events ${body.title}`).data;
        slugs[event.key] = data.slug;
        // M4.17: the admin's ADM-53/54 cells address an event by its ULID ({pendingEventId}).
        slugs[`${event.key}Id`] = data.id;
      }
      return slugs;
    } finally {
      await api.dispose();
    }
  })();
  ids.catch(() => (ids = null));
  return ids;
}

/**
 * DQ-1110: the published demo meet members can answer, "Feierabendtreffen am Elbdeich" by jann.ptrs (ShowcaseEvents `member_events`,
 * 10 days ahead, rolling; lukas.sc is going, nina.neu has not answered). Found through jann.ptrs's public event list, so the cells
 * follow a reseed whatever its slug; read only (no cell answers it).
 */
const MEMBER_EVENT = { organiser: 'jann.ptrs', title: 'Feierabendtreffen am Elbdeich' };
/**
 * DQ-P5-012: the demo meet that is over, "Saugmotor-Abend" by max.e46 (ShowcaseEvents `member_events`, 21 days back at seeding), with
 * the seeded approved gallery (member_events[].gallery). Found the same way; the EVT-02 gallery cells read it under `m56-gallery`.
 */
const PAST_MEMBER_EVENT = { organiser: 'max.e46', title: 'Saugmotor-Abend', when: 'past' };

/** @type {Map<string, Promise<Record<string, string>>>} */
const memberEvents = new Map();

/**
 * The slug of a seeded demo meet under its token name, read once per process from its organiser's public event list.
 * @param {string} token
 * @param {{ organiser: string, title: string, when?: 'past' }} wanted (`when: 'past'`: the organiser list of meets that are over)
 */
function seededEventIds(token, wanted) {
  let found = memberEvents.get(token);
  if (!found) {
    found = (async () => {
      const api = await memberApi(await sessionOf(DEMO_MEMBER));
      try {
        const path = `public/users/${wanted.organiser}/events`;
        const query = wanted.when ? `?when=${wanted.when}&per_page=50` : '?per_page=50';
        const events = expectStatus(await api.get(`${path}${query}`), 200, `GET ${path}${query}`).data;
        const event = events.find((/** @type {{title:string}} */ entry) => entry.title === wanted.title);
        if (!event) throw new Error(`${wanted.title} of @${wanted.organiser} is not seeded (ShowcaseEvents member_events, DQ-1110)`);
        return { [token]: event.slug };
      } finally {
        await api.dispose();
      }
    })();
    found.catch(() => memberEvents.delete(token));
    memberEvents.set(token, found);
  }
  return found;
}

const memberEventIds = () => seededEventIds('memberEvent', MEMBER_EVENT);
const pastMemberEventIds = () => seededEventIds('pastMemberEvent', PAST_MEMBER_EVENT);

/**
 * Tokens of the M4.12 routes: each event's slug, and its id (`…Id`) for the admin routes; {memberEvent} for the answerable meet,
 * {pastMemberEvent} for the meet that is over with its gallery.
 */
export const EVENT_FIXTURE_TOKENS = [...EVENTS.flatMap((event) => [event.key, `${event.key}Id`]), 'memberEvent', 'pastMemberEvent'];

/**
 * The values of the event tokens asked for: lukas.sc's organiser events only when one of them is named (they are made on first use).
 * @param {string[]} names
 */
export async function eventTokenValues(names) {
  const organiser = names.some((name) => name !== 'memberEvent' && name !== 'pastMemberEvent' && EVENT_FIXTURE_TOKENS.includes(name));
  return {
    ...(organiser ? await eventFixtureIds() : {}),
    ...(names.includes('memberEvent') ? await optionalSeed('memberEvent', memberEventIds) : {}),
    ...(names.includes('pastMemberEvent') ? await optionalSeed('pastMemberEvent', pastMemberEventIds) : {}),
  };
}

/** Why a seeded token has no value in this run (a seed not run yet), by token name; the runner skips its cells and logs this. */
export const MISSING_SEEDS = /** @type {Record<string, string>} */ ({});

/**
 * A token that comes from a seed another lane may not have run yet: its absence skips only the cells that use it, never the run.
 * @param {string} name
 * @param {() => Promise<Record<string, string>>} read
 */
async function optionalSeed(name, read) {
  try {
    return await read();
  } catch (error) {
    MISSING_SEEDS[name] = error instanceof Error ? error.message : String(error);
    return {};
  }
}
