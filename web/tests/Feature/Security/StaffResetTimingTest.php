<?php

use App\Models\Staff;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;

/**
 * SEC-P1-02, SEC-P1-19 and the password.update oracle of the M1.9 review: neither staff reset step may tell by its timing
 * whether an address belongs to staff. Group perf, run alone on a quiet machine (`pest --group=perf`): timings in a busy
 * parallel run say nothing.
 *
 * At the production hashing cost, not the testing one: with the cheap testing cost every gap is far below anything measurable.
 */
const STAFF_RESET_TOLERANCE_MS = 50.0;

const STAFF_RESET_ROUNDS = 5;

function staffResetAtProductionCost(): void
{
    config(['hashing.bcrypt.rounds' => 12, 'hashing.argon.memory' => 65536, 'hashing.argon.time' => 4, 'hashing.argon.threads' => 1]);
    app()->forgetInstance('hash');
    Hash::clearResolvedInstance('hash');
    app()->forgetInstance('auth.password');
    Password::clearResolvedInstance('auth.password');
}

/**
 * @param  list<float>  $values
 */
function staffResetMedian(array $values): float
{
    sort($values);

    return $values[intdiv(count($values), 2)];
}

/**
 * The medians go to the log of the perf run as well, so a pass shows its margin.
 *
 * @param  array<string, float>  $medians
 */
function staffResetReport(string $step, array $medians): void
{
    fwrite(STDERR, sprintf("[perf] %s medians in ms: %s\n", $step, json_encode(array_map(fn (float $ms): float => round($ms, 1), $medians))));
}

/**
 * @param  Closure(): mixed  $request
 */
function staffResetMs(Closure $request): float
{
    $start = hrtime(true);
    $request();

    return (hrtime(true) - $start) / 1e6;
}

it('answers a reset-link request for a known, an unknown and an already-asked address in the same time', function () {
    staffResetAtProductionCost();
    Notification::fake();
    $staff = Staff::factory()->create();
    $times = ['known' => [], 'unknown' => [], 'throttled' => []];

    // Warm-up: the first request of a process loads routes, views and translations.
    $this->postJson('/admin/forgot-password', ['email' => 'warm-up@speedclub.test'])->assertOk();

    foreach (range(1, STAFF_RESET_ROUNDS) as $i) {
        Cache::flush();
        DB::table('staff_password_reset_tokens')->delete();

        $times['known'][] = staffResetMs(fn () => $this->postJson('/admin/forgot-password', ['email' => $staff->email])->assertOk());
        $times['unknown'][] = staffResetMs(fn () => $this->postJson('/admin/forgot-password', ['email' => "ghost$i@speedclub.test"])->assertOk());
        // The broker's own 60 seconds per address: no new token, so no hash.
        $times['throttled'][] = staffResetMs(fn () => $this->postJson('/admin/forgot-password', ['email' => $staff->email])->assertOk());
    }

    $medians = array_map(staffResetMedian(...), $times);
    staffResetReport('forgot-password', $medians);

    expect(max($medians) - min($medians))->toBeLessThan(STAFF_RESET_TOLERANCE_MS, 'medians in ms: '.json_encode($medians));
})->group('perf');

it('answers a wrong reset token for a known address in the same time as an unknown address', function () {
    staffResetAtProductionCost();
    $staff = Staff::factory()->create();
    $times = ['known' => [], 'unknown' => []];
    $body = fn (string $email): array => [
        'email' => $email,
        'token' => str_repeat('a', 64),
        'password' => 'a-new-staff-password-1',
        'password_confirmation' => 'a-new-staff-password-1',
    ];

    $this->postJson('/admin/reset-password', $body('warm-up@speedclub.test'))->assertUnprocessable();

    foreach (range(1, STAFF_RESET_ROUNDS) as $i) {
        Cache::flush();
        // A real token row, so the wrong token goes through the hash check of DatabaseTokenRepository::exists().
        Password::broker('staff')->createToken($staff);

        $times['known'][] = staffResetMs(fn () => $this->postJson('/admin/reset-password', $body($staff->email))->assertUnprocessable());
        $times['unknown'][] = staffResetMs(fn () => $this->postJson('/admin/reset-password', $body("ghost$i@speedclub.test"))->assertUnprocessable());
    }

    $medians = array_map(staffResetMedian(...), $times);
    staffResetReport('reset-password', $medians);

    expect(abs($medians['known'] - $medians['unknown']))->toBeLessThan(STAFF_RESET_TOLERANCE_MS, 'medians in ms: '.json_encode($medians));
})->group('perf');

it('keeps the staff timebox above one production hash, with headroom', function () {
    staffResetAtProductionCost();
    $hashes = [];
    $floors = [];

    foreach (range(1, STAFF_RESET_ROUNDS) as $i) {
        $hashes[] = staffResetMs(fn () => Hash::make(str_repeat('t', 64)));
        // The broker as the routes get it: an unknown address does no work, so its time is the floor itself.
        $floors[] = staffResetMs(fn () => Password::broker('staff')->sendResetLink(['email' => "ghost$i@speedclub.test"]));
    }

    $hash = staffResetMedian($hashes);
    $floor = staffResetMedian($floors);
    staffResetReport('hash vs staff floor', ['hash' => $hash, 'floor' => $floor]);

    // The known path is that hash plus three queries. Should this fail on a slower host, raise auth.passwords.staff.timebox.
    expect($floor - $hash)->toBeGreaterThan(2 * STAFF_RESET_TOLERANCE_MS);
})->group('perf');
