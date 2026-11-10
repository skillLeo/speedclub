<?php

use App\Enums\ErrorCode;

it('maps HTTP statuses to codes', function (int $status, ErrorCode $code) {
    expect(ErrorCode::fromStatus($status))->toBe($code);
})->with([
    [401, ErrorCode::Unauthenticated],
    [403, ErrorCode::Forbidden],
    [404, ErrorCode::NotFound],
    [419, ErrorCode::SessionExpired],
    [429, ErrorCode::RateLimited],
    [418, ErrorCode::BadRequest],
    [500, ErrorCode::ServerError],
    [502, ErrorCode::ServerError],
    [503, ErrorCode::ServiceUnavailable],
]);

it('gives every code a status that maps back, except the named variants of a generic code', function (ErrorCode $code) {
    $generic = match ($code) {
        ErrorCode::AccountRestricted, ErrorCode::EmailNotVerified, ErrorCode::PasswordChangeRequired, ErrorCode::QrRevokedByStaff, ErrorCode::CannotMessage, ErrorCode::SecondFactorLocked, ErrorCode::PasswordConfirmationRequired, ErrorCode::ViewAsReadOnly, ErrorCode::ViewAsNoMessages, ErrorCode::AiOptInRequired, ErrorCode::ConsentRequired => ErrorCode::Forbidden,
        ErrorCode::InvalidCredentials => ErrorCode::Unauthenticated,
        ErrorCode::InvalidCode, ErrorCode::VehicleIncomplete, ErrorCode::OwnContent, ErrorCode::AppealPeriodOver, ErrorCode::ChallengeExpired, ErrorCode::TwoFactorCodeRequired, ErrorCode::DecisionNotAppealable, ErrorCode::ContentBlocked, ErrorCode::AiRefused, ErrorCode::AiUnverifiable => ErrorCode::ValidationFailed,
        ErrorCode::AiUnavailable, ErrorCode::AiBudgetExhausted => ErrorCode::ServiceUnavailable,
        ErrorCode::AiDailyLimit => ErrorCode::RateLimited,
        ErrorCode::VehicleUnavailable, ErrorCode::MemberUnavailable, ErrorCode::FeatureDisabled => ErrorCode::NotFound,
        ErrorCode::UsernameChangeCooldown, ErrorCode::TokenRotationNotDue, ErrorCode::TwoFactorRequired, ErrorCode::IdempotencyKeyReused, ErrorCode::FeedStale, ErrorCode::RequestPending, ErrorCode::AlreadyReported, ErrorCode::AppealExists => ErrorCode::Conflict,
        default => $code,
    };

    expect(ErrorCode::fromStatus($code->status()))->toBe($generic);
})->with(ErrorCode::cases());

it('answers 409 with a code of its own when an Idempotency-Key belongs to another request', function () {
    expect(ErrorCode::IdempotencyKeyReused->value)->toBe('idempotency_key_reused')
        ->and(ErrorCode::IdempotencyKeyReused->status())->toBe(409);
});

it('has a German and an English message for every code', function (string $locale) {
    app()->setLocale($locale);

    foreach (ErrorCode::cases() as $code) {
        expect(trans()->hasForLocale('errors.'.$code->value, $locale))->toBeTrue($code->value);
    }
})->with(['de', 'en']);

it('keeps the admin JSON strings complete in both locales', function () {
    $de = json_decode((string) file_get_contents(lang_path('de.json')), true);
    $en = json_decode((string) file_get_contents(lang_path('en.json')), true);

    expect(array_diff_key($en, $de))->toBe([])
        ->and(array_keys(array_filter($de, fn (string $key): bool => str_starts_with($key, 'admin.'), ARRAY_FILTER_USE_KEY)))
        ->toBe(array_keys($en));
});

it('loads German validation messages', function () {
    expect(trans('validation.required', ['attribute' => 'Name'], 'de'))->toBe('Name muss ausgefüllt werden.');
});

it('holds the product limits in config', function () {
    expect(config('speedclub.usernames.reserved'))->toContain('admin', 'speedclub', 'impressum', 'staff')
        ->and(config('speedclub.garage.max_vehicles_per_member'))->toBe(20)
        ->and(config('speedclub.garage.max_photos_per_vehicle'))->toBe(30)
        ->and(config('speedclub.passwords.min_length'))->toBe(10);
});
