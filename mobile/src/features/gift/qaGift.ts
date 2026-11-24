/**
 * The bundled set of the non-production override `qaGift` (mobile/src/lib/qa.ts): the level, badges, Car of the Day, invites and the
 * `/join/{code}` lookup answer from it until lane B serves them, so the visual matrix can capture M5.9d. Never shown to a member: `qa`
 * has no overrides in production. The level title is the contract's own example ladder (m5.9d-contract §1); the badges are the
 * seeded catalogue's (BadgeSeeder, DE/EN); the Car of the Day is a real
 * car on a licensed seed photo (design/seed-photos/CREDITS.md), `is_sample` and so badged "Beispiel".
 */
import type { Badge } from '@/api/queries/badges';
import type { CarOfTheDay } from '@/api/queries/carOfTheDay';
import { registerGiftQaSource } from '@/api/queries/giftQa';
import type { FeedVehicle } from '@/api/queries/home';
import type { InviteLookup, MyInvites } from '@/api/queries/invites';
import type { MyLevel, PublicLevel } from '@/api/queries/level';
import { SAMPLE_CARD_PHOTO } from '@/features/garage/sample';
import i18n from '@/i18n';
import { qa } from '@/lib/qa';
import type { PhotoFields } from '@/ui/Photo';

/** Whether this session answers the M5.9d reads from the QA set. */
export function qaGiftActive(): boolean {
  return qa.gift !== undefined;
}

const en = () => i18n.language.startsWith('en');

/** The server's ladder (config `speedclub.xp.levels`, lang/{de,en}/levels.php), as GET me/level sends it. */
const QA_LADDER_FROM = [0, 100, 250, 500, 900, 1500, 2400, 3600, 5200, 7500] as const;
const QA_TITLES_DE = ['Street Rookie', 'Garagen-Stammgast', 'Schrauber-Azubi', 'Teilejäger', 'Build-Handwerker', 'Bekanntes Gesicht', 'Detail-Meister', 'Szene-Veteran', 'Garagen-Legende', 'Kaido Legend']; // i18n-ignore: the server's titles
const QA_TITLES_EN = ['Street Rookie', 'Garage Regular', 'Wrench Apprentice', 'Parts Hunter', 'Build Crafter', 'Familiar Face', 'Detail Master', 'Scene Veteran', 'Garage Legend', 'Kaido Legend']; // i18n-ignore: the server's titles

/** Level 4 on the server's ladder: 740 XP, 60 % of the way from 500 to 900 (client round 2: the sheet shows what comes next). */
export function qaLevel(): MyLevel {
  const titles = en() ? QA_TITLES_EN : QA_TITLES_DE;
  const ladder = QA_LADDER_FROM.map((from, index) => ({ level: index + 1, title: titles[index] ?? '', from_xp: from }));
  return { level: 4, title: titles[3] ?? '', xp: 740, next_level_xp: 900, progress: 0.6, today: { earned: 40, cap: 200 }, ladder };
}

/**
 * Founding numbers for the profile lines: the signed-in QA profile's and another member's. Unique like the real ones, so the two
 * profiles never show the same number (DQ-P5G-25).
 */
export const QA_FOUNDING_NUMBER = 42;
export const QA_MEMBER_FOUNDING_NUMBER = 117;
/** Another member's level (contract §1 example ladder, level 6). */
export const QA_MEMBER_LEVEL: PublicLevel = { level: 6, title: 'Familiar Face' }; // i18n-ignore: the server's title

type Seed = Omit<Badge, 'description' | 'hint'> & { description: [string, string] | null; hint: [string, string] | null };

// DQ-P5G-25: keys, names and texts of the seeded catalogue (web/database/seeders/BadgeSeeder.php), German and English as the server
// sends them; earned dates before the matrix's qaNow (2 November 2026). A hidden badge not earned yet comes without name and
// description, only with its hint. No Treffen badge: those stay inactive until check-ins exist.
const SEEDS: readonly Seed[] = [
  { key: 'founding-member', hidden: false, name: 'Founding Member', description: ['Du bist eines der ersten 1.000 Mitglieder von Speedclub.', 'You are one of the first 1,000 members of Speedclub.'], hint: null, tier: 3, category: 'founding', earned_at: '2026-10-02T18:12:00Z', sort: 290 },
  { key: 'erster-build', hidden: false, name: 'Erster Build', description: ['Du hast dein erstes Auto in der Garage veröffentlicht.', 'You published your first car in the garage.'], hint: null, tier: 1, category: 'garage', earned_at: '2026-10-03T19:40:00Z', sort: 10 },
  { key: 'zehn-mods', hidden: false, name: 'Schrauberliste', description: ['Zehn Mods mit Marke, Einbaudatum und Foto.', 'Ten mods with brand, install date and photo.'], hint: null, tier: 2, category: 'mods', earned_at: '2026-10-21T17:05:00Z', sort: 80 },
  { key: 'crew-starter', hidden: false, name: 'Crew Starter', description: ['Über eine Einladung dazugekommen oder jemanden eingeladen, der jetzt dabei ist.', 'Joined through an invite, or invited someone who is in now.'], hint: null, tier: 1, category: 'community', earned_at: '2026-10-30T20:30:00Z', sort: 300 },
  { key: 'street-famous-10', hidden: false, name: 'Street Famous', description: ['Zehn Leute haben eines deiner Autos gespottet.', 'Ten people spotted one of your cars.'], hint: null, tier: 1, category: 'spotting', earned_at: null, sort: 150 },
  { key: 'erstes-set', hidden: false, name: 'Erstes Set', description: ['Du hast ein Dex-Set komplett.', 'You completed a Dex set.'], hint: null, tier: 1, category: 'sets', earned_at: null, sort: 200 },
  { key: 'sticker-drauf', hidden: false, name: 'Sticker drauf', description: ['Dein Auto hat einen aktiven Speedclub Sticker.', 'Your car has an active Speedclub sticker.'], hint: null, tier: 1, category: 'sticker', earned_at: null, sort: 270 },
  { key: 'erstentdecker', hidden: true, name: null, description: null, hint: ['Sei früh dran, wenn ein Sticker neu ist.', 'Be early when a sticker is new.'], tier: null, category: 'spotting', earned_at: null, sort: 190 },
  { key: 'sticker-100', hidden: true, name: null, description: null, hint: ['Park da, wo Leute stehen bleiben.', 'Park where people stop and look.'], tier: null, category: 'sticker', earned_at: null, sort: 280 },
];

function badgeOf(seed: Seed): Badge {
  const pick = (pair: [string, string] | null) => (pair ? pair[en() ? 1 : 0] : null);
  return { ...seed, description: pick(seed.description), hint: pick(seed.hint) };
}

export function qaBadges(): Badge[] {
  return SEEDS.map(badgeOf);
}

/** What another member's profile shows: the earned ones. */
export function qaMemberBadges(): Badge[] {
  return qaBadges().filter((badge) => badge.earned_at !== null);
}

/** `qaGift=unlock`: one new badge; `stack`: three ("3 neue Abzeichen"); otherwise none. */
export function qaUnseen(): Badge[] {
  const earned = qaMemberBadges();
  if (qa.gift === 'unlock') return earned.slice(3, 4);
  if (qa.gift === 'stack') return earned.slice(1, 4);
  return [];
}

export const QA_COTD_VEHICLE_ID = 'sample-cotd-r34';

/** The bundled photo of the sample car (it has no cover URL). */
export function qaCarOfTheDayPhoto(vehicleId: string): PhotoFields | undefined {
  return vehicleId === QA_COTD_VEHICLE_ID ? SAMPLE_CARD_PHOTO : undefined;
}

const COTD_VEHICLE: FeedVehicle = {
  id: QA_COTD_VEHICLE_ID,
  public_id: 'sample-cotd',
  slug: 'sample-cotd-r34',
  status: 'published',
  visibility: 'public',
  is_main: true,
  build_score: null,
  eyebrow: null,
  make: 'Nissan', // i18n-ignore
  model: 'Skyline GT-R', // i18n-ignore
  generation: 'R34', // i18n-ignore
  title: 'Skyline GT-R R34', // i18n-ignore
  full_title: 'Nissan Skyline GT-R R34', // i18n-ignore
  nickname: null,
  color: null,
  model_year: 1999,
  subline_parts: [],
  // Factory figures of the R34 GT-R (RB26DETT).
  spec_strip: [
    { key: 'power', value: '280', unit: 'PS', label: 'Leistung' }, // i18n-ignore
    { key: 'torque', value: '392', unit: 'Nm', label: 'Drehmoment' }, // i18n-ignore
  ],
  cover: null,
  photo_count: 12,
  mod_count: 14,
  updates_count: 6,
  is_sample: true,
  published_at: '2026-09-20T18:00:00Z',
  updated_at: '2026-11-10T18:00:00Z',
  wizard: null,
  completeness: null,
  qr: null,
  owner: null,
  latest_update: null,
  viewer: null,
  // R5-5: a sample build has no thread.
  comment_thread: { enabled: false, can_write: false },
};

/** `qaGift`: today's pick (the clock's Berlin day), owned by the signed-in member with `qaGift=owner`. */
export function qaCarOfTheDay(me: string | null, now: Date = qa.now ?? new Date()): CarOfTheDay {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const username = qa.gift === 'owner' && me ? me : 'nina.r34'; // i18n-ignore: a sample handle
  return {
    day,
    vehicle: COTD_VEHICLE,
    story_line: en() ? 'Imported in 2019, rebuilt bolt by bolt in a single garage in Bochum.' : '2019 importiert, Schraube für Schraube in einer Garage in Bochum neu aufgebaut.', // i18n-ignore
    owner: { username, display_name: null, city: 'Bochum', avatar: null, is_sample: true, is_editorial: false }, // i18n-ignore
  };
}

export function qaInvites(): MyInvites {
  return {
    invites: [
      { code: '7KQ2M9XA', created_at: '2026-10-02T18:12:00Z', accepted_at: '2026-11-12T20:30:00Z', accepted_by: { username: 'tobi.e46', display_name: 'Tobi' } }, // i18n-ignore
      { code: 'H4NC8RVE', created_at: '2026-10-02T18:12:00Z', accepted_at: '2026-11-13T09:02:00Z', accepted_by: null },
      { code: 'P3WZ6TDK', created_at: '2026-10-02T18:12:00Z', accepted_at: null, accepted_by: null },
      { code: 'B8MJ1QYS', created_at: '2026-10-02T18:12:00Z', accepted_at: null, accepted_by: null },
      { code: 'R2XF5GHN', created_at: '2026-10-02T18:12:00Z', accepted_at: null, accepted_by: null },
    ],
  };
}

export function qaInviteLookup(code: string): InviteLookup {
  return code === 'P3WZ6TDK' || code === 'B8MJ1QYS' || code === 'R2XF5GHN'
    ? { status: 'valid', inviter: { username: 'nina.r34', display_name: 'Nina' } } // i18n-ignore
    : { status: 'invalid' };
}

/** Installs the QA set as the source of the M5.9d reads while `qaGift` is set (never in production). */
export function installQaGift(): void {
  if (qa.gift === undefined) return;
  registerGiftQaSource({
    level: qaLevel,
    badges: qaBadges,
    memberBadges: qaMemberBadges,
    unseen: qaUnseen,
    carOfTheDay: (me) => qaCarOfTheDay(me),
    invites: qaInvites,
    inviteLookup: qaInviteLookup,
  });
}

installQaGift();
