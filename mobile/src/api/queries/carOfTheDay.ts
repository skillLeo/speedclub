/**
 * M5.9d Car of the Day (contract docs/reports/phase-5/m5.9d-contract.md §3, ADR-508): `GET home/modules` gains
 * `car_of_the_day: {day, vehicle, story_line, owner}` from 18:00 to the next 18:00 (Home's lead module), and the owner edits the story
 * line while the car is featured (`PATCH vehicles/{id}/car-of-the-day {story_line}`, ≤ 140, moderated by keyword rules).
 *
 * Through the generated client (`CarOfTheDayResource` in `HomeModules`, `CarOfTheDayStoryResource`): `vehicle` is the
 * `FeedVehicleResource` of the other Home modules, `owner` a `MemberSummaryResource`, the PATCH answers `{data: {story_line}}`.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api, apiData } from '@/api/client';
import { qa } from '@/lib/qa';

import type { FeedOwner, FeedVehicle } from './home';
import { giftQa } from './giftQa';
import { homeKeys } from './home';

/** The story line's limit (contract §3). */
export const STORY_LINE_MAX = 140;

export type CarOfTheDay = {
  /** "2026-11-14": the Berlin day the pick belongs to (published 18:00). */
  day: string;
  vehicle: FeedVehicle;
  story_line: string | null;
  owner: FeedOwner | null;
};


const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `car_of_the_day` of the Home modules, or null when there is none (before 18:00 on the first day, a skipped day, an older server). */
export function carOfTheDayOf(modules: unknown): CarOfTheDay | null {
  if (!isRecord(modules) || !isRecord(modules.car_of_the_day)) return null;
  const pick = modules.car_of_the_day;
  const vehicle = pick.vehicle;
  if (typeof pick.day !== 'string' || !DAY.test(pick.day)) return null;
  if (!isRecord(vehicle) || typeof vehicle.id !== 'string' || typeof vehicle.full_title !== 'string') return null;
  const story = typeof pick.story_line === 'string' && pick.story_line.trim() !== '' ? pick.story_line.trim() : null;
  const owner = isRecord(pick.owner) && typeof pick.owner.username === 'string' ? (pick.owner as FeedOwner) : null;
  return { day: pick.day, vehicle: vehicle as FeedVehicle, story_line: story, owner };
}

/**
 * Today's pick for Start: from the Home modules, or (QA, never in production) the bundled sample of `qaGift`; `qaGift=error` has none,
 * as a module that failed to load shows nothing on Start.
 */
export function resolveCarOfTheDay(modules: unknown, me: string | null): CarOfTheDay | null {
  const source = giftQa();
  if (source) return qa.gift === 'error' ? null : source.carOfTheDay(me);
  return carOfTheDayOf(modules);
}

/** The day as a date at noon UTC: "2026-11-14" never slips into the 13th in any zone. */
export function carOfTheDayDate(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

/** The member owns the car of the day: the story editor is theirs. */
export function ownsCarOfTheDay(pick: CarOfTheDay | null, username: string | null): boolean {
  return pick !== null && username !== null && pick.owner?.username === username;
}

/** The Home modules with a new story line, so the module shows it at once. */
function withStory(modules: unknown, storyLine: string | null): unknown {
  if (!isRecord(modules) || !isRecord(modules.car_of_the_day)) return modules;
  return { ...modules, car_of_the_day: { ...modules.car_of_the_day, story_line: storyLine } };
}

/** "Story bearbeiten": `PATCH vehicles/{id}/car-of-the-day {story_line}`. The Home module takes the saved line, then reads again. */
export function useUpdateCarOfTheDayStory(vehicleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (storyLine: string): Promise<string | null> => {
      const body = await apiData(
        api.PATCH('/vehicles/{vehicle}/car-of-the-day', { params: { path: { vehicle: vehicleId } }, body: { story_line: storyLine.trim() } }),
      );
      const data = isRecord(body) && isRecord(body.data) ? body.data : body;
      // The server may shorten or clean the line (keyword rules): its answer wins; a 204 keeps what was sent.
      if (isRecord(data) && 'story_line' in data) return typeof data.story_line === 'string' && data.story_line.trim() !== '' ? data.story_line : null;
      return storyLine.trim() || null;
    },
    onSuccess: (storyLine) => {
      for (const [key] of client.getQueriesData({ queryKey: homeKeys.all })) {
        if (key[2] === 'modules') client.setQueryData(key, (modules: unknown) => withStory(modules, storyLine));
      }
      void client.invalidateQueries({ queryKey: homeKeys.all, predicate: (query) => query.queryKey[2] === 'modules' });
    },
  });
}
