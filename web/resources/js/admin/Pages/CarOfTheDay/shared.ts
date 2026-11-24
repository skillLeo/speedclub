import { trans } from 'laravel-vue-i18n';
import { routeOr } from '../../lib/routes';

/** ADM-64 Car of the Day (M5.9d admin): one Berlin day of App\Http\Controllers\Admin\CarOfTheDay\CarOfTheDayIndexController. */
export interface CotdDay {
    day: string;
    today: boolean;
    editable: boolean;
    id: number | null;
    source: 'auto' | 'staff' | null;
    skipped: boolean;
    skipped_reason: string | null;
    story_line: string | null;
    bundesland: string | null;
    is_sample: boolean;
    published_at: string | null;
    decided_by: string | null;
    /** R4-2.1: the pick came from the members' votes. */
    by_vote: boolean;
    vehicle: {
        id: string;
        title: string;
        cover: string | null;
        cover_focus: string | null;
        cover_placeholder: string | null;
        owner: { id: string; username: string | null } | null;
    } | null;
}

export type CotdStatus = 'published' | 'picked' | 'open' | 'skipped' | 'missed';

export function statusOf(day: CotdDay): CotdStatus {
    if (day.skipped) return 'skipped';
    if (day.vehicle !== null) return day.published_at !== null ? 'published' : 'picked';
    return day.editable ? 'open' : 'missed';
}

export const statusTone = { published: 'success', picked: 'info', open: 'neutral', skipped: 'warning', missed: 'neutral' } as const;

/** "Sa., 14.11.2026" in the admin's language (the day is a Berlin date, formatted at noon UTC so no zone moves it). */
export function dayLabel(day: string, locale: string): string {
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
}

export const overrideUrl = (day: string): string => routeOr('admin.car-of-the-day.override', `/admin/content/car-of-the-day/${day}/override`, { day });
export const skipUrl = (day: string): string => routeOr('admin.car-of-the-day.skip', `/admin/content/car-of-the-day/${day}/skip`, { day });
export const sourceLabel = (day: CotdDay): string =>
    day.source === null
        ? '–'
        : day.source === 'staff' && day.decided_by
          ? trans('gift.cotd.source.staff_by', { name: day.decided_by })
          : day.by_vote
            ? trans('gift.cotd.source.vote')
            : trans(`gift.cotd.source.${day.source}`);

/**
 * R4-2.1 vote rounds (App\Http\Controllers\Admin\CarOfTheDay\CarOfTheDayVoteRounds, staff only): the Picker's suggestions of a day with
 * all votes and the counted ones, and how the day was decided (a team choice or skip wins over the votes).
 */
export type VoteRoundStatus = 'open' | 'counting' | 'by_vote' | 'picker' | 'staff';
export interface VoteCandidate {
    position: number;
    votes: number;
    counted: number;
    winner: boolean;
    vehicle: (NonNullable<CotdDay['vehicle']> & { deleted: boolean }) | null;
}
export interface VoteRound {
    day: string;
    status: VoteRoundStatus;
    closes_at: string;
    total: number;
    candidates: VoteCandidate[];
}
export type VoteRoundUnavailable = 'too_few_candidates' | 'staff_decided' | 'not_ready';
export interface VoteRounds {
    enabled: boolean;
    closes_at: string;
    /** R4DQ-34: the round that opened last, and why it has no vote (null: it has one). */
    current?: { day: string; unavailable: VoteRoundUnavailable | null };
    rounds: VoteRound[];
}

/** "22.11." (DE) / "22/11" (EN): the round's day in a reason line. */
export function shortDayLabel(day: string, locale: string): string {
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
}

export const roundTone = { open: 'info', counting: 'warning', by_vote: 'success', picker: 'neutral', staff: 'neutral' } as const;
