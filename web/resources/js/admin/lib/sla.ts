import { trans } from 'laravel-vue-i18n';
import { formatNumber } from './format';

/**
 * SLA timers of the SplitQueues (09 §10.2): "45 Min.", "5 Std.", "3 Tg." from the minutes the server counted (QaClock-aware), and the
 * one overdue rule the queues share: more than a day waiting is a warning (06 §3). Same rule as Kpi::SLA_MINUTES on the dashboard.
 */
export const SLA_MINUTES = 24 * 60;

export function waitingText(minutes: number | null | undefined): string {
    if (minutes === null || minutes === undefined) return '–';
    if (minutes < 60) return trans('ui.waiting.minutes', { count: formatNumber(minutes) });
    if (minutes < 48 * 60) return trans('ui.waiting.hours', { count: formatNumber(Math.floor(minutes / 60)) });
    return trans('ui.waiting.days', { count: formatNumber(Math.floor(minutes / (24 * 60))) });
}

export const overdue = (minutes: number | null | undefined): boolean => minutes !== null && minutes !== undefined && minutes >= SLA_MINUTES;
