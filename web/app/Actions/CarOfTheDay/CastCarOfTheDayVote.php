<?php

namespace App\Actions\CarOfTheDay;

use App\Enums\CarOfTheDayRoundUnavailable;
use App\Enums\CarOfTheDayVoteBlock;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\CarOfTheDayVote;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\CarOfTheDay\CarOfTheDayVoting;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * R4-2.1 (contract-cotd-voting §2.2): casts or changes the member's vote in the open round. Always the real clock (V10). One row per
 * account and day (unique key); the same vote again changes nothing. No count is read or returned.
 */
final class CastCarOfTheDayVote
{
    public function __construct(private readonly CarOfTheDayVoting $voting) {}

    public function handle(User $member, string $day, string $vehicleId): void
    {
        $now = CarbonImmutable::now();

        // A closed account is not restricted but gone (contract §2.2: 403 forbidden); the policy refuses it first.
        if ($member->isDeactivated()) {
            throw new ApiException(ErrorCode::Forbidden);
        }

        match ($this->voting->block($member, $now)) {
            CarOfTheDayVoteBlock::SampleAccount => throw new ApiException(ErrorCode::Forbidden, (string) __('car_of_the_day.vote.sample_account')),
            CarOfTheDayVoteBlock::Restricted => throw new ApiException(ErrorCode::AccountRestricted),
            CarOfTheDayVoteBlock::EmailUnverified => throw new ApiException(ErrorCode::EmailNotVerified),
            CarOfTheDayVoteBlock::AccountTooNew => throw new ApiException(ErrorCode::Forbidden, (string) __('car_of_the_day.vote.too_new')),
            default => null,
        };

        if ($day !== CarOfTheDayVoting::roundDay($now) || ! CarOfTheDayVoting::isOpen($day, $now)) {
            $key = $now->lessThan(CarOfTheDayVoting::opensAt($day)) ? 'not_open' : 'closed';

            throw ValidationException::withMessages(['day' => [(string) __('car_of_the_day.vote.'.$key)]]);
        }

        $this->voting->prepare($day, $now);

        $unavailable = $this->voting->unavailable($day);

        if ($unavailable !== null) {
            $key = $unavailable === CarOfTheDayRoundUnavailable::NotReady ? 'not_ready' : 'unavailable';

            throw ValidationException::withMessages(['day' => [(string) __('car_of_the_day.vote.'.$key)]]);
        }

        if (! in_array($vehicleId, $this->voting->visibleTo($member, $this->voting->candidateIds($day)), true)) {
            throw ValidationException::withMessages(['vehicle_id' => [(string) __('car_of_the_day.vote.not_candidate')]]);
        }

        if (Vehicle::query()->whereKey($vehicleId)->value('owner_id') === $member->id) {
            throw new ApiException(ErrorCode::OwnContent, (string) __('car_of_the_day.vote.own_car'));
        }

        DB::transaction(function () use ($member, $day, $vehicleId): void {
            $current = CarOfTheDayVote::query()->where('day', $day)->where('user_id', $member->id)->lockForUpdate()->first();

            if ($current?->vehicle_id === $vehicleId) {
                return;
            }

            // The unique (day, user_id) key keeps one vote per account even when two requests race.
            DB::table('car_of_the_day_votes')->upsert(
                [['id' => (new CarOfTheDayVote)->newUniqueId(), 'day' => $day, 'user_id' => $member->id, 'vehicle_id' => $vehicleId, 'created_at' => now(), 'updated_at' => now()]],
                ['day', 'user_id'],
                ['vehicle_id', 'updated_at'],
            );
        }, 3);
    }
}
