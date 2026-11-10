<?php

use App\Models\VerificationCode;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\DB;

/**
 * @return array<string, string> expression by command
 */
function scheduled(): array
{
    $events = [];

    foreach (app(Schedule::class)->events() as $event) {
        $command = preg_replace('/^.*artisan["\']?\s+/', '', (string) $event->command);
        $events[$command] = $event->expression;
    }

    return $events;
}

it('runs what exists now at the times of 05_ARCHITECTURE §11', function (string $command, string $expression) {
    expect(scheduled())->toHaveKey($command)
        ->and(scheduled()[$command])->toBe($expression);
})->with([
    'queue worker' => ['queue:work --stop-when-empty --max-time=50 --tries=3', '* * * * *'],
    'cron heartbeat' => ['health:schedule-check-heartbeat', '* * * * *'],
    'health checks' => ['health:check', '*/5 * * * *'],
    'codes and idempotency keys' => ['speedclub:prune-platform', '0 * * * *'],
    'expired tokens' => ['sanctum:prune-expired --hours=24', '0 * * * *'],
    'audit verify' => ['audit:verify', '0 2 * * *'],
    'audit export' => ['audit:export', '0 2 * * *'],
    'audit retention' => ['audit:retention', '30 2 * * *'],
    'media prune' => ['media:prune', '0 0 * * *'],
    'vehicle hard delete' => ['vehicles:prune', '0 0 * * *'],
    'Für dich ranking (M2.2)' => ['home:rank', '0 * * * *'],
    'push receipts (M2.2)' => ['push:receipts', '*/15 * * * *'],
    'notification retention (M2.2)' => ['notifications:prune', '15 3 * * *'],
    'saved-builds digest (M2.2), in Berlin time' => ['notifications:saved-builds', '0 9 * * 1'],
    'message digest (M2.4), in Berlin time' => ['messages:digest', '0 18 * * *'],
    'lift expired suspensions (M2.6)' => ['moderation:lift-expired-suspensions', '*/15 * * * *'],
]);

it('runs the saved-builds digest on Monday 09:00 Europe/Berlin', function () {
    $event = collect(app(Schedule::class)->events())->first(fn ($event): bool => str_contains((string) $event->command, 'notifications:saved-builds'));

    expect($event->timezone)->toBe('Europe/Berlin');
});

it('never lets two queue workers overlap', function () {
    $worker = collect(app(Schedule::class)->events())
        ->first(fn ($event): bool => str_contains((string) $event->command, 'queue:work'));

    expect($worker->withoutOverlapping)->toBeTrue();
});

it('does not let a killed worker hold the queue lock for long, and runs after everything else', function () {
    $events = app(Schedule::class)->events();
    $worker = end($events);

    expect((string) $worker->command)->toContain('queue:work')
        ->and($worker->expiresAt)->toBe(2);
});

it('prunes expired cache rows, such as rate-limit keys derived from IP addresses, and keeps live ones', function () {
    config(['cache.default' => 'database']);

    DB::table('cache')->insert([
        ['key' => 'throttle-expired', 'value' => 'x', 'expiration' => now()->subSecond()->getTimestamp()],
        ['key' => 'throttle-live', 'value' => 'x', 'expiration' => now()->addMinute()->getTimestamp()],
    ]);

    $this->artisan('speedclub:prune-platform')->assertSuccessful();

    expect(DB::table('cache')->pluck('key')->all())->toBe(['throttle-live']);
});

it('prunes expired sessions, which hold IP addresses, and keeps live ones', function () {
    config(['session.driver' => 'database', 'session.lifetime' => 120]);

    DB::table('sessions')->insert([
        ['id' => 'expired', 'payload' => '', 'last_activity' => now()->subMinutes(121)->getTimestamp(), 'ip_address' => '203.0.113.1'],
        ['id' => 'live', 'payload' => '', 'last_activity' => now()->subMinutes(119)->getTimestamp(), 'ip_address' => '203.0.113.2'],
    ]);

    $this->artisan('speedclub:prune-platform')->assertSuccessful();

    expect(DB::table('sessions')->pluck('id')->all())->toBe(['live']);
});

it('prunes verification codes only after the retention period, because the hourly limit counts spent ones', function () {
    $age = fn (VerificationCode $code, int $minutes) => $code->forceFill(['created_at' => now()->subMinutes($minutes)])->save();

    $live = VerificationCode::factory()->create(['expires_at' => now()->addMinutes(5)]);
    $expiredInWindow = VerificationCode::factory()->create(['expires_at' => now()->subMinute()]);
    $age($expiredInWindow, 59);
    $consumedInWindow = VerificationCode::factory()->create(['expires_at' => now()->addMinutes(5)]);
    $consumedInWindow->forceFill(['consumed_at' => now()])->save();
    $age($consumedInWindow, 59);
    $yesterdayEvening = VerificationCode::factory()->create(['expires_at' => now()->subHours(23)]);
    $age($yesterdayEvening, 23 * 60 + 10);
    $old = VerificationCode::factory()->create(['expires_at' => now()->subHours(24)]);
    $age($old, 24 * 60 + 10);

    $this->artisan('speedclub:prune-platform')->assertSuccessful();

    expect(VerificationCode::query()->pluck('id')->all())
        ->toEqualCanonicalizing([$live->id, $expiredInWindow->id, $consumedInWindow->id, $yesterdayEvening->id]);
});

it('keeps at least the hourly window even with a shorter retention', function () {
    config(['speedclub.verification.retention_hours' => 0]);
    $code = VerificationCode::factory()->create(['expires_at' => now()->subMinute()]);
    $code->forceFill(['created_at' => now()->subMinutes(59)])->save();

    $this->artisan('speedclub:prune-platform')->assertSuccessful();

    expect(VerificationCode::query()->whereKey($code->id)->exists())->toBeTrue();
});
