<?php

use App\Enums\VerificationPurpose;
use App\Models\User;
use App\Models\VerificationCode;
use App\Services\Auth\VerificationCodes;
use Illuminate\Support\Facades\DB;

/**
 * Two sign-ups at the same moment deadlocked: issue() closed the open codes with a ranged UPDATE, which for a new member
 * matches nothing and takes a gap lock up to the end of the index, so both INSERTs waited on each other and one sign-up
 * answered 500 (docs/reports/logs/m19-r3-e2e.log, laravel.log SQLSTATE 40001). Open codes are now closed by primary key.
 */
function updatesOnVerificationCodes(Closure $run): array
{
    DB::flushQueryLog();
    DB::enableQueryLog();
    $run();
    DB::disableQueryLog();

    return array_values(array_filter(
        array_column(DB::getQueryLog(), 'query'),
        fn (string $sql): bool => str_starts_with(strtolower(ltrim($sql)), 'update') && str_contains($sql, 'verification_codes'),
    ));
}

it('issues the first code of a new member without any UPDATE on verification_codes', function () {
    $member = User::factory()->create(['email_verified_at' => null]);

    $updates = updatesOnVerificationCodes(fn () => app(VerificationCodes::class)->issue($member, VerificationPurpose::EmailVerification));

    expect($updates)->toBe([])
        ->and(VerificationCode::query()->where('user_id', $member->getKey())->count())->toBe(1);
});

it('closes the open code by primary key when a new one replaces it', function () {
    $member = User::factory()->create(['email_verified_at' => null]);
    $codes = app(VerificationCodes::class);
    $codes->issue($member, VerificationPurpose::EmailVerification);
    $first = VerificationCode::query()->where('user_id', $member->getKey())->sole();

    $this->travel(config()->integer('speedclub.verification.resend_cooldown_seconds') + 1)->seconds();
    $updates = updatesOnVerificationCodes(fn () => $codes->issue($member, VerificationPurpose::EmailVerification));

    expect($updates)->toHaveCount(1)
        ->and($updates[0])->not->toContain('user_id')
        ->and($first->fresh()->consumed_at)->not->toBeNull()
        ->and(VerificationCode::query()->where('user_id', $member->getKey())->whereNull('consumed_at')->count())->toBe(1);
});
