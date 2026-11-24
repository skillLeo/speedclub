<?php

namespace App\Services\CarOfTheDay;

use App\Enums\CarOfTheDayRoundStatus;
use App\Enums\CarOfTheDayRoundUnavailable;
use App\Enums\CarOfTheDaySource;
use App\Enums\CarOfTheDayVoteBlock;
use App\Enums\RestrictionType;
use App\Http\Resources\V1\FeedVehicleResource;
use App\Models\CarOfTheDay;
use App\Models\CarOfTheDayCandidate;
use App\Models\CarOfTheDayVote;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Discover\VisibleBuilds;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * R4-2.1 rounds (contract-cotd-voting V1–V4, V6, V10). The round of day D opens at publish_at (18:00) on D−1, when its candidates are
 * frozen (the Picker's top `candidates`, never a sample in production; ADR-535 fills a short round with samples elsewhere), and closes at voting.closes_at (17:00) on D; the 17:55 pick counts it
 * (CarOfTheDayVotes). Times are Europe/Berlin. No method here returns a vote count.
 */
final class CarOfTheDayVoting
{
    public function __construct(
        private readonly CarOfTheDayPicker $picker,
        private readonly CarOfTheDays $days,
        private readonly VisibleBuilds $builds,
    ) {}

    /** The day whose round is the current one at $now: tomorrow from 18:00, else today. */
    public static function roundDay(CarbonImmutable $now): string
    {
        return CarbonImmutable::parse(CarOfTheDayClock::shownDay($now))->addDay()->toDateString();
    }

    public static function opensAt(string $day): CarbonImmutable
    {
        return self::at(CarbonImmutable::parse($day)->subDay()->toDateString(), config()->string('speedclub.car_of_the_day.publish_at'));
    }

    public static function closesAt(string $day): CarbonImmutable
    {
        return self::at($day, config()->string('speedclub.car_of_the_day.voting.closes_at'));
    }

    /**
     * Whether $now is inside the open window of $day's round.
     */
    public static function isOpen(string $day, CarbonImmutable $now): bool
    {
        return $now->greaterThanOrEqualTo(self::opensAt($day)) && $now->lessThan(self::closesAt($day));
    }

    /**
     * Freezes $day's candidates once its round has opened (idempotent; the first read or the 18:00 run). Always the real clock.
     * Fewer than min_candidates stores nothing (the round is unavailable) and is remembered for ten minutes, so reads stay cheap. While
     * another request holds the freeze, this one returns at once (not_ready).
     */
    public function prepare(string $day, ?CarbonImmutable $now = null): void
    {
        $now ??= CarbonImmutable::now();

        if ($now->lessThan(self::opensAt($day)) || $this->frozen($day) || Cache::has('car_of_the_day:round:none:'.$day)) {
            return;
        }

        // Never a blocking wait: Lock::block() times out by Carbon::now(), which a test's travelTo() freezes (it spun forever), and a
        // read should not queue behind the freeze anyway. A read that finds the lock taken answers not_ready (unavailable()); the lock
        // expires on its own after 30 s should its holder die, and is released in finally otherwise.
        $lock = Cache::lock('car_of_the_day:round:'.$day, 30);

        if (! $lock->get()) {
            return;
        }

        try {
            // Again under the lock: another request may have frozen the round since the check above.
            if (CarOfTheDayCandidate::query()->where('day', $day)->exists()) {
                return;
            }

            $ids = $this->picker->ranked($day, config()->integer('speedclub.car_of_the_day.voting.candidates'));

            if (count($ids) < config()->integer('speedclub.car_of_the_day.voting.min_candidates')) {
                Cache::put('car_of_the_day:round:none:'.$day, true, now()->addMinutes(10));

                return;
            }

            DB::table('car_of_the_day_candidates')->insertOrIgnore(array_map(fn (string $id, int $index): array => [
                'day' => $day,
                'vehicle_id' => $id,
                'position' => $index + 1,
                'created_at' => now(),
            ], $ids, array_keys($ids)));
        } finally {
            $lock->release();
        }
    }

    /**
     * The candidates' vehicle ids of $day in position order (empty when the round was never frozen).
     *
     * @return list<string>
     */
    public function candidateIds(string $day): array
    {
        return array_values(CarOfTheDayCandidate::query()->where('day', $day)->orderBy('position')->pluck('vehicle_id')->map(strval(...))->all());
    }

    /**
     * Why $day has no vote, or null when it has one: too few candidates, or a staff choice or skip for the day (it wins anyway, V6).
     */
    public function unavailable(string $day): ?CarOfTheDayRoundUnavailable
    {
        $row = CarOfTheDay::query()->where('day', $day)->first();

        if ($row instanceof CarOfTheDay && ($row->source === CarOfTheDaySource::Staff || $row->skipped)) {
            return CarOfTheDayRoundUnavailable::StaffDecided;
        }

        $count = count($this->candidateIds($day));

        if ($count === 0 && ! Cache::has('car_of_the_day:round:none:'.$day) && CarbonImmutable::now()->greaterThanOrEqualTo(self::opensAt($day))) {
            // Opened but not frozen yet (a read that waited in vain for the freeze, or a QA read that never freezes).
            return CarOfTheDayRoundUnavailable::NotReady;
        }

        return $count < config()->integer('speedclub.car_of_the_day.voting.min_candidates')
            ? CarOfTheDayRoundUnavailable::TooFewCandidates
            : null;
    }

    /**
     * Why this account cannot vote at $now regardless of the round (V4), or null.
     */
    public function block(User $member, CarbonImmutable $now): ?CarOfTheDayVoteBlock
    {
        return match (true) {
            $member->getAttribute('is_sample') === true => CarOfTheDayVoteBlock::SampleAccount,
            ! $member->isActive() || $member->isRestrictedFrom(RestrictionType::Publishing) => CarOfTheDayVoteBlock::Restricted,
            ! $member->hasVerifiedEmail() => CarOfTheDayVoteBlock::EmailUnverified,
            $now->lessThan($this->votableFrom($member)) => CarOfTheDayVoteBlock::AccountTooNew,
            default => null,
        };
    }

    /** When the account turns min_account_days old. */
    public function votableFrom(User $member): CarbonImmutable
    {
        return CarbonImmutable::parse($member->created_at ?? now())->addDays(config()->integer('speedclub.car_of_the_day.voting.min_account_days'));
    }

    /**
     * Which of $ids $viewer may see in a list (blocks either way, VisibleBuilds), in $ids' order.
     *
     * @param  list<string>  $ids
     * @return list<string>
     */
    public function visibleTo(User $viewer, array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $visible = $this->builds->query($viewer, fromSearch: false)->whereIn('vs.vehicle_id', $ids)->pluck('vs.vehicle_id')->map(strval(...))->all();

        return array_values(array_filter($ids, fn (string $id): bool => in_array($id, $visible, true)));
    }

    /**
     * The whole state of GET car-of-the-day/vote for $viewer at $now (V10: the QA clock on a read; $freeze only with the real clock).
     *
     * @return array{round: array<string, mixed>, last_result: array<string, mixed>|null}
     */
    public function state(User $viewer, CarbonImmutable $now, bool $freeze): array
    {
        $day = self::roundDay($now);

        if ($freeze) {
            $this->prepare($day, $now);
        }

        $unavailable = $this->unavailable($day);
        $status = match (true) {
            $unavailable !== null => CarOfTheDayRoundStatus::Unavailable,
            self::isOpen($day, $now) => CarOfTheDayRoundStatus::Open,
            default => CarOfTheDayRoundStatus::Closed,
        };
        $block = $status === CarOfTheDayRoundStatus::Open ? $this->block($viewer, $now) : CarOfTheDayVoteBlock::Closed;
        $ids = $unavailable === null ? $this->visibleTo($viewer, $this->candidateIds($day)) : [];
        $vehicles = $this->vehicles($ids);
        $positions = array_flip($this->candidateIds($day));
        $candidates = [];

        foreach ($ids as $id) {
            if (! isset($vehicles[$id])) {
                continue;
            }

            $own = $vehicles[$id]->owner_id === $viewer->id;
            $candidates[] = [
                'position' => ($positions[$id] ?? 0) + 1,
                'own' => $own,
                'votable' => $block === null && ! $own,
                'vehicle' => $vehicles[$id],
            ];
        }

        return [
            'round' => [
                'day' => $day,
                'status' => $status,
                'unavailable_reason' => $unavailable,
                'opens_at' => self::opensAt($day),
                'closes_at' => self::closesAt($day),
                'can_vote' => $block === null,
                'cannot_vote_reason' => $block,
                'can_vote_from' => $block === CarOfTheDayVoteBlock::AccountTooNew ? $this->votableFrom($viewer) : null,
                'my_vote' => $this->myVote($viewer, $day),
                'candidates' => $candidates,
            ],
            'last_result' => $this->lastResult($viewer, $now),
        ];
    }

    public function myVote(User $viewer, string $day): ?string
    {
        $vote = CarOfTheDayVote::query()->where('day', $day)->where('user_id', $viewer->id)->value('vehicle_id');

        return is_string($vote) ? $vote : null;
    }

    /**
     * The round decided last: the published pick Home shows at $now, when its day had a round. The winner only if the reader may see it.
     *
     * @return array{day: string, my_vote: string|null, winner: Vehicle|null, by_vote: bool}|null
     */
    private function lastResult(User $viewer, CarbonImmutable $now): ?array
    {
        $pick = $this->days->current($now);

        if ($pick === null || $this->candidateIds($pick->dayString()) === []) {
            return null;
        }

        $shown = $this->days->shownTo($viewer, $now);
        $winner = $shown !== null && $shown['pick']->is($pick) ? ($this->vehicles([(string) $pick->vehicle_id])[(string) $pick->vehicle_id] ?? null) : null;

        return [
            'day' => $pick->dayString(),
            'my_vote' => $this->myVote($viewer, $pick->dayString()),
            'winner' => $winner,
            'by_vote' => $pick->by_vote,
        ];
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, Vehicle>
     */
    private function vehicles(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return Vehicle::query()->whereKey($ids)->with(FeedVehicleResource::RELATIONS)->withCount('modifications')->get()->keyBy('id')->all();
    }

    private function frozen(string $day): bool
    {
        return CarOfTheDayCandidate::query()->where('day', $day)->exists();
    }

    private static function at(string $day, string $time): CarbonImmutable
    {
        return CarbonImmutable::parse($day.' '.$time, config()->string('speedclub.car_of_the_day.timezone'));
    }
}
