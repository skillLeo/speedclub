<?php

use App\Actions\Social\BlockMember;
use App\Models\Notification;
use App\Models\Save;
use App\Models\User;
use App\Services\Notifications\SavedBuildsDigest;
use Carbon\CarbonImmutable;

require_once __DIR__.'/NotificationTestHelpers.php';

/**
 * [SIG] The weekly build_saved aggregate: Monday 09:00 Europe/Berlin counts the saves of the ISO week before, per build, never who.
 */
beforeEach(function () {
    socSavesOn();
    $this->owner = ntfMember('kenji.r34');
    $this->r34 = publishedVehicle($this->owner);
    // Monday 10 November 2026, 09:00 in Berlin; the week before is 2026-W45 (2 to 8 November).
    $this->monday = CarbonImmutable::parse('2026-11-09 09:00:00', 'Europe/Berlin');
});

function ntfSave(User $member, $vehicle, string $berlin): void
{
    Save::factory()->create(['user_id' => $member->id, 'vehicle_id' => $vehicle->id, 'created_at' => CarbonImmutable::parse($berlin, 'Europe/Berlin')->utc()]);
}

it('counts last week\'s saves per build in Berlin time and writes one row each', function () {
    ntfSave(User::factory()->create(), $this->r34, '2026-11-02 00:05');
    ntfSave(User::factory()->create(), $this->r34, '2026-11-05 18:00');
    ntfSave(User::factory()->create(), $this->r34, '2026-11-08 23:55');
    // Outside the week, on both edges.
    ntfSave(User::factory()->create(), $this->r34, '2026-11-01 23:59');
    ntfSave(User::factory()->create(), $this->r34, '2026-11-09 00:01');
    $other = publishedVehicle($this->owner);
    ntfSave(User::factory()->create(), $other, '2026-11-04 12:00');

    $this->travelTo($this->monday);
    // One build per queued slice: the digest walks every build through the queue (M2.2 review #13).
    config(['speedclub.notifications.digest_slice' => 1]);
    expect(app(SavedBuildsDigest::class)->run())->toBe('2026-W45');

    $rows = Notification::query()->where('notifiable_id', $this->owner->id)->orderByDesc('actor_count')->get();
    expect($rows->pluck('actor_count')->all())->toBe([3, 1])
        ->and($rows->first()?->group_key)->toBe("build_saved:{$this->r34->id}:2026-W45")
        ->and($rows->first()?->data)->toEqual(['count' => 3, 'week' => '2026-W45'])
        ->and($rows->first()?->actors()->count())->toBe(0);
});

it('leaves out saves by members who are gone or blocked either way, and the owner\'s own', function () {
    Save::factory()->create(['user_id' => $this->owner->id, 'vehicle_id' => $this->r34->id, 'created_at' => CarbonImmutable::parse('2026-11-04 12:00', 'Europe/Berlin')->utc()]);
    ntfSave(User::factory()->suspended()->create(), $this->r34, '2026-11-04 12:00');
    ntfSave(User::factory()->deactivated()->create(), $this->r34, '2026-11-04 12:00');
    $blocker = User::factory()->create();
    ntfSave($blocker, $this->r34, '2026-11-04 12:00');
    app(BlockMember::class)->handle($this->owner, $blocker);
    ntfSave(User::factory()->create(), $this->r34, '2026-11-04 13:00');

    $this->travelTo($this->monday);
    app(SavedBuildsDigest::class)->run();

    expect(Notification::query()->where('notifiable_id', $this->owner->id)->sole()->actor_count)->toBe(1);
});

it('changes nothing when it runs twice for the week', function () {
    ntfSave(User::factory()->create(), $this->r34, '2026-11-04 12:00');
    $this->travelTo($this->monday);

    app(SavedBuildsDigest::class)->run();
    $first = Notification::query()->sole();
    $first->forceFill(['read_at' => now()])->save();
    $this->travel(1)->hours();
    $this->artisan('notifications:saved-builds')->assertSuccessful();

    expect(Notification::query()->count())->toBe(1)
        ->and($first->refresh()->read_at)->not->toBeNull();
});

it('does nothing while the saved-builds flag is off', function () {
    socSavesOn(false);
    ntfSave(User::factory()->create(), $this->r34, '2026-11-04 12:00');
    $this->travelTo($this->monday);

    expect(app(SavedBuildsDigest::class)->run())->toBeNull()
        ->and(Notification::query()->count())->toBe(0);
});

it('skips a build that is no longer published', function () {
    ntfSave(User::factory()->create(), $this->r34, '2026-11-04 12:00');
    $this->r34->delete();
    $this->travelTo($this->monday);

    expect(app(SavedBuildsDigest::class)->run())->toBe('2026-W45')
        ->and(Notification::query()->count())->toBe(0);
});
