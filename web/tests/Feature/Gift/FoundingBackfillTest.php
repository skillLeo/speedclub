<?php

use App\Models\AuditEvent;
use App\Models\User;
use Illuminate\Support\Str;

require_once __DIR__.'/GiftTestHelpers.php';

/**
 * CR-P5G-09: speedclub:founding:backfill gives members who were active before the M5.9d deploy their Founding Member numbers, in
 * activated_at order, from the counter onward; production only, idempotent, one audit entry per number.
 */
beforeEach(function () {
    config(['speedclub.founding.environments' => ['production']]);
    app()->detectEnvironment(fn () => 'production');
});

afterEach(function () {
    app()->detectEnvironment(fn () => 'testing');
});

/** An active member (a real address: the factory's example.* domains never get a number). */
function fbActive(string $activatedAt, array $attributes = []): User
{
    return giftMember(['email' => 'founder-'.Str::lower(Str::random(8)).'@garage.test', 'activated_at' => $activatedAt, 'email_verified_at' => now(), 'founding_number' => null, ...$attributes]);
}

it('numbers the members active before the deploy in activation order, once, and audits every number', function () {
    $third = fbActive('2026-05-03 10:00:00');
    $first = fbActive('2026-05-01 10:00:00');
    $second = fbActive('2026-05-02 10:00:00');
    $sample = fbActive('2026-04-01 10:00:00', ['is_sample' => true]);
    $test = fbActive('2026-04-01 11:00:00', ['email' => 'demo@speedclub.test']);
    $suspended = fbActive('2026-04-02 10:00:00', ['status' => 'suspended']);
    $never = giftMember(['activated_at' => null, 'founding_number' => null]);

    $this->artisan('speedclub:founding:backfill --dry-run')->expectsOutputToContain('3 member(s) would get')->assertSuccessful();
    expect(User::query()->whereNotNull('founding_number')->count())->toBe(0);

    $this->artisan('speedclub:founding:backfill --chunk=2')->expectsOutputToContain('3 member(s) got')->assertSuccessful();

    expect([$first->refresh()->founding_number, $second->refresh()->founding_number, $third->refresh()->founding_number])->toBe([1, 2, 3])
        ->and($sample->refresh()->founding_number)->toBeNull()
        ->and($test->refresh()->founding_number)->toBeNull()
        ->and($suspended->refresh()->founding_number)->toBeNull()
        ->and($never->refresh()->founding_number)->toBeNull();

    $events = AuditEvent::query()->where('action', 'founding.assigned')->orderBy('id')->get();
    expect($events)->toHaveCount(3)
        ->and($events->pluck('after')->all())->toEqual([
            ['backfill' => true, 'founding_number' => 1],
            ['backfill' => true, 'founding_number' => 2],
            ['backfill' => true, 'founding_number' => 3],
        ])
        ->and($events->pluck('actor_type')->map->value->unique()->all())->toBe(['system']);

    $this->artisan('speedclub:founding:backfill')->expectsOutputToContain('0 member(s) got')->assertSuccessful();
    expect(AuditEvent::query()->where('action', 'founding.assigned')->count())->toBe(3);
});

it('fills from the counter onward when newer members got numbers first, never moving one', function () {
    $newer = fbActive('2026-12-20 10:00:00', ['founding_number' => 1]);
    $this->artisan('speedclub:founding:backfill')->assertSuccessful();
    $older = fbActive('2026-05-01 10:00:00');

    $this->artisan('speedclub:founding:backfill')->assertSuccessful();

    expect($newer->refresh()->founding_number)->toBe(1)->and($older->refresh()->founding_number)->toBe(2);
});

it('stops when the numbers run out', function () {
    config(['speedclub.founding.max' => 1]);
    $first = fbActive('2026-05-01 10:00:00');
    $second = fbActive('2026-05-02 10:00:00');

    $this->artisan('speedclub:founding:backfill')->expectsOutputToContain('All Founding Member numbers are taken')->assertSuccessful();

    expect($first->refresh()->founding_number)->toBe(1)->and($second->refresh()->founding_number)->toBeNull();
});

it('refuses outside production', function () {
    app()->detectEnvironment(fn () => 'staging');
    $member = fbActive('2026-05-01 10:00:00');

    $this->artisan('speedclub:founding:backfill')->assertFailed();

    expect($member->refresh()->founding_number)->toBeNull();
});
