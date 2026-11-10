<?php

use App\Support\Moderation\AppealDeadline;
use Carbon\CarbonImmutable;

/**
 * §§ 187(1), 188(2), (3) BGB in Europe/Berlin (m2.6-contract Addendum): six months from the notification, to the end of the day with the
 * same number, or the last day of a shorter month.
 */
it('ends at the end of the same-numbered day six months later, in Berlin', function (string $notified, string $end) {
    expect(AppealDeadline::from(CarbonImmutable::parse($notified))->toIso8601String())->toBe($end);
})->with([
    'plain' => ['2026-03-15T09:00:00+00:00', '2026-09-15T23:59:59+02:00'],
    '31 August to 28 February' => ['2026-08-31T10:00:00+02:00', '2027-02-28T23:59:59+01:00'],
    '31 August in a leap year to 29 February' => ['2027-08-31T10:00:00+02:00', '2028-02-29T23:59:59+01:00'],
    '31 March to 30 September' => ['2026-03-31T12:00:00+02:00', '2026-09-30T23:59:59+02:00'],
    'late UTC evening is the next day in Berlin' => ['2026-03-31T22:30:00+00:00', '2026-10-01T23:59:59+02:00'],
    'winter notice, summer end' => ['2026-12-01T08:00:00+01:00', '2027-06-01T23:59:59+02:00'],
    'summer notice, winter end' => ['2026-06-10T08:00:00+02:00', '2026-12-10T23:59:59+01:00'],
    'on the night of the spring change' => ['2026-03-29T01:30:00+00:00', '2026-09-29T23:59:59+02:00'],
    'on the night of the autumn change' => ['2026-10-25T00:30:00+00:00', '2027-04-25T23:59:59+02:00'],
    'ends on the day the clocks go back' => ['2026-04-25T12:00:00+02:00', '2026-10-25T23:59:59+01:00'],
]);

it('is open up to the last second of the last day and closed at midnight', function () {
    $notified = CarbonImmutable::parse('2026-08-31T10:00:00+02:00');

    expect(AppealDeadline::isOpen($notified, CarbonImmutable::parse('2027-02-28T23:59:59.999+01:00')))->toBeTrue()
        ->and(AppealDeadline::isOpen($notified, CarbonImmutable::parse('2027-03-01T00:00:00+01:00')))->toBeFalse()
        ->and(AppealDeadline::isOpen($notified, CarbonImmutable::parse('2027-02-28T22:59:59+00:00')))->toBeTrue()
        ->and(AppealDeadline::isOpen($notified, CarbonImmutable::parse('2027-02-28T23:00:00+00:00')))->toBeFalse();
});

it('covers the review cases (M2.6 review #18)', function (string $notified, string $end) {
    expect(AppealDeadline::from(CarbonImmutable::parse($notified))->toIso8601String())->toBe($end);
})->with([
    'midnight in Berlin counts for that day' => ['2026-05-10T00:00:00+02:00', '2026-11-10T23:59:59+01:00'],
    'the last second of a Berlin day' => ['2026-05-10T23:59:59+02:00', '2026-11-10T23:59:59+01:00'],
    '29 February to 29 August' => ['2028-02-29T12:00:00+01:00', '2028-08-29T23:59:59+02:00'],
    '30 August to 28 February, not a leap year' => ['2026-08-30T12:00:00+02:00', '2027-02-28T23:59:59+01:00'],
    '31 December to 30 June' => ['2026-12-31T12:00:00+01:00', '2027-06-30T23:59:59+02:00'],
]);

it('counts in Berlin whatever the application time zone', function () {
    config(['app.timezone' => 'America/New_York']);
    date_default_timezone_set('America/New_York');

    try {
        // 20:30 in New York on 31 March is 02:30 on 1 April in Berlin.
        expect(AppealDeadline::from(CarbonImmutable::parse('2026-03-31 20:30:00'))->toIso8601String())->toBe('2026-10-01T23:59:59+02:00');
    } finally {
        date_default_timezone_set('UTC');
        config(['app.timezone' => 'UTC']);
    }
});
