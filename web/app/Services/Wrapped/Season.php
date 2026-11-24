<?php

namespace App\Services\Wrapped;

use Carbon\CarbonImmutable;

/**
 * A Wrapped season (m5.9e contract §1): `2027-saison` is 1 March to 31 October 2027, `2027-jahr` the calendar year 2027, both in
 * Europe/Berlin (`wrapped.timezone`; season bounds `wrapped.season_start`/`season_end`). `from` is the first moment, `to` the last
 * (end of day), both in that zone; queries compare with the UTC instants (`fromUtc()`/`toUtc()`) and Berlin dates (`fromDate()`).
 */
final readonly class Season
{
    public const PATTERN = '[0-9]{4}-(saison|jahr)';

    private function __construct(
        public string $key,
        public int $year,
        public string $kind,
        public CarbonImmutable $from,
        public CarbonImmutable $to,
    ) {}

    public static function tryFrom(mixed $key): ?self
    {
        if (! is_string($key) || preg_match('/\A([0-9]{4})-(saison|jahr)\z/', $key, $match) !== 1) {
            return null;
        }

        $year = (int) $match[1];

        if ($year < 2000 || $year > 2999) {
            return null;
        }

        $zone = config()->string('speedclub.wrapped.timezone');

        if ($match[2] === 'jahr') {
            $from = CarbonImmutable::create($year, 1, 1, 0, 0, 0, $zone);
            $to = CarbonImmutable::create($year, 12, 31, 23, 59, 59, $zone);
        } else {
            [$startMonth, $startDay] = array_map(intval(...), explode('-', config()->string('speedclub.wrapped.season_start')));
            [$endMonth, $endDay] = array_map(intval(...), explode('-', config()->string('speedclub.wrapped.season_end')));
            $from = CarbonImmutable::create($year, $startMonth, $startDay, 0, 0, 0, $zone);
            $to = CarbonImmutable::create($year, $endMonth, $endDay, 23, 59, 59, $zone);
        }

        if (! $from instanceof CarbonImmutable || ! $to instanceof CarbonImmutable) {
            return null;
        }

        return new self($key, $year, $match[2], $from, $to);
    }

    public static function from(string $key): self
    {
        return self::tryFrom($key) ?? throw new \InvalidArgumentException("Unknown Wrapped season [$key].");
    }

    public function isYear(): bool
    {
        return $this->kind === 'jahr';
    }

    /** The first instant of the season in UTC, for timestamp columns. */
    public function fromUtc(): CarbonImmutable
    {
        return $this->from->utc();
    }

    /** The last instant of the season in UTC, for timestamp columns. */
    public function toUtc(): CarbonImmutable
    {
        return $this->to->utc();
    }

    /** "2027-03-01": for date columns (Berlin days). */
    public function fromDate(): string
    {
        return $this->from->toDateString();
    }

    public function toDate(): string
    {
        return $this->to->toDateString();
    }

    public function contains(CarbonImmutable $moment): bool
    {
        return $moment->betweenIncluded($this->from, $this->to);
    }
}
