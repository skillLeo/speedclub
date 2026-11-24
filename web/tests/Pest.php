<?php

use App\Models\ConfigVersion;
use chillerlan\QRCode\QRCode as QrLibrary;
use chillerlan\QRCode\QROptions;
use Illuminate\Auth\SessionGuard;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Session\Store;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

pest()->extend(TestCase::class)
    ->use(RefreshDatabase::class)
    ->in('Feature');

pest()->extend(TestCase::class)->in('Unit');

/*
 * ADR-540 (client decision 2026-11-23): the product defaults are four-eyes OFF and staff 2FA OPTIONAL. The admin, security and staff
 * suites were written for the strict rules and keep proving them: they start with the strict governance published (four-eyes on,
 * 2FA Pflicht), exactly as an Owner switches it back on. The defaults and the relaxed mode are proved in
 * Feature/Admin/Settings/GovernanceOptionalTest.php, which publishes the switches it needs per test.
 */
pest()->beforeEach(fn () => strictGovernance())->in('Feature/Admin', 'Feature/Security', 'Feature/Staff', 'Unit/Approvals');

/**
 * Creates a real database session in which $user is signed in on $guard and returns its id.
 * Requests then authenticate only through the cookie, not through actingAs() and its in-memory user.
 */
function databaseSessionFor(mixed $user, string $guard): string
{
    config(['session.driver' => 'database']);

    $id = Str::random(40);
    $store = new Store('test', app('session')->driver('database')->getHandler(), $id, config()->string('session.serialization', 'php'));
    $store->put('login_'.$guard.'_'.sha1(SessionGuard::class), $user->getAuthIdentifier());
    $store->put('_token', Str::random(40));
    $store->save();

    // Boot may have resolved the array driver; the guard must share the store StartSession fills.
    app()->forgetInstance('session.store');
    app('auth')->forgetGuards();

    return $id;
}

/**
 * The text of the QR code in a server-drawn PNG. chillerlan/php-qrcode 6.0.1's reader misreads about 1 in 40 of its own clean
 * version-6/7 renders (lead probe 2026-11-16: 3 of 120; ZXing-C++ reads every one of them, including the share pictures that failed
 * here), so a page address with a random slug made tests flaky about 1 run in 8. When the picture as drawn fails, the same picture
 * scaled to 80 %, 60 % and 50 % is read; the caller still compares the full text exactly.
 */
function readQrText(string $png): string
{
    $first = null;

    foreach ([1.0, 0.8, 0.6, 0.5] as $factor) {
        $blob = $png;

        if ($factor !== 1.0) {
            $image = imagecreatefromstring($png);
            $scaled = $image === false ? false : imagescale($image, (int) round(imagesx($image) * $factor), (int) round(imagesy($image) * $factor), IMG_BILINEAR_FIXED);

            if ($scaled === false) {
                continue;
            }

            ob_start();
            imagepng($scaled);
            $blob = (string) ob_get_clean();
        }

        try {
            return (new QrLibrary(new QROptions))->readFromBlob($blob)->data;
        } catch (Throwable $exception) {
            $first ??= $exception;
        }
    }

    throw $first ?? new RuntimeException('No QR code found.');
}

/**
 * ADR-540: publishes the governance switches as the newest live version of the config key `governance` (no staff, no audit: a test
 * fixture), so Governance::fourEyes(), Governance::staffTwoFactorRequired() and OwnerOverride::enabled() read them.
 */
function publishGovernance(bool $fourEyes, string $staffTwoFactor = 'optional', bool $ownerOverride = true): void
{
    $version = (int) ConfigVersion::query()->where('key', 'governance')->max('version') + 1;
    // By primary key only: an UPDATE … WHERE key/status would take next-key (gap) locks on config_versions and block tests that insert
    // other keys from a second connection (M35 SF-8).
    $live = ConfigVersion::query()->where('key', 'governance')->where('status', 'published')->pluck('id')->all();
    if ($live !== []) {
        ConfigVersion::query()->whereKey($live)->update(['status' => 'superseded']);
    }
    DB::table('config_versions')->insert([
        'key' => 'governance',
        'version' => $version,
        'status' => 'published',
        'payload' => json_encode(['owner_override' => $ownerOverride, 'four_eyes' => $fourEyes, 'staff_two_factor' => $staffTwoFactor]),
        'published_at' => now(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);
}

/** ADR-540: the strict governance the admin suites were written for: four-eyes on, staff 2FA Pflicht, Owner-Override on. */
function strictGovernance(): void
{
    publishGovernance(fourEyes: true, staffTwoFactor: 'required');
}
