<?php

use App\Enums\AuditActorType;
use App\Enums\NotificationType;
use App\Models\AuditEvent;
use App\Models\Badge;
use App\Models\Notification;
use App\Models\User;
use App\Models\UserBadge;

require_once __DIR__.'/GiftTestHelpers.php';

/**
 * ADR-516 b (DQ-P5G-07): the migration 2026_12_22_100000 retires the seeded night badge on hosts that have it: deactivated, taken back
 * from every member (earned row and unread unlock notification gone, a read one stays in the history), audited by the system, no push;
 * matched by key so a renamed badge is found; idempotent; a fresh install (no such row) changes nothing.
 */
function retireNightShift(): object
{
    return require database_path('migrations/2026_12_22_100000_retire_night_shift_badge.php');
}

function nightShiftBadge(array $attributes = []): Badge
{
    return Badge::factory()->hidden()->create(['key' => 'nachtschicht', 'category' => 'spotting', 'active' => true, 'rule_json' => ['metric' => 'night_spots', 'gte' => 10], ...$attributes]);
}

function badgeUnlockedRow(User $member, string $key, bool $read = false): Notification
{
    return Notification::factory()->forRecipient($member)->create([
        'type' => NotificationType::BadgeUnlocked,
        'group_key' => 'badge_unlocked:'.$key,
        'data' => ['badge_key' => $key],
        'read_at' => $read ? now() : null,
    ]);
}

it('deactivates the badge and takes it back from every member without a push, audited by the system', function () {
    nightShiftBadge(['name_de' => 'Umbenannt von Staff']);
    $other = Badge::factory()->create(['key' => 'erster-build']);
    [$one, $two, $gone] = [giftMember(), giftMember(), giftMember()];

    foreach ([$one, $two, $gone] as $member) {
        UserBadge::factory()->create(['user_id' => $member->id, 'badge_key' => 'nachtschicht']);
    }

    UserBadge::factory()->create(['user_id' => $one->id, 'badge_key' => $other->key]);
    badgeUnlockedRow($one, 'nachtschicht');
    badgeUnlockedRow($two, 'nachtschicht', read: true);
    badgeUnlockedRow($one, 'erster-build');
    $gone->delete();

    $result = retireNightShift()->retire();

    expect($result)->toBe(['deactivated' => true, 'revoked' => 3])
        ->and(Badge::query()->findOrFail('nachtschicht')->active)->toBeFalse()
        ->and(UserBadge::query()->where('badge_key', 'nachtschicht')->count())->toBe(0)
        ->and(UserBadge::query()->where('badge_key', 'erster-build')->count())->toBe(1)
        ->and(Notification::query()->where('group_key', 'badge_unlocked:nachtschicht')->whereNull('read_at')->count())->toBe(0)
        ->and(Notification::query()->where('group_key', 'badge_unlocked:nachtschicht')->whereNotNull('read_at')->count())->toBe(1)
        ->and(Notification::query()->where('group_key', 'badge_unlocked:erster-build')->count())->toBe(1)
        ->and(Notification::query()->whereNotNull('pushed_at')->count())->toBe(0);

    $events = AuditEvent::query()->whereIn('action', ['badge.deactivated', 'badge.revoked'])->orderBy('id')->get();
    expect($events->pluck('action')->countBy()->all())->toBe(['badge.deactivated' => 1, 'badge.revoked' => 3])
        ->and($events->every(fn (AuditEvent $e): bool => $e->getRawOriginal('actor_type') === AuditActorType::System->value && $e->actor_id === null))->toBeTrue()
        ->and($events->every(fn (AuditEvent $e): bool => str_contains((string) $e->reason, 'ADR-516')))->toBeTrue()
        ->and($events->firstWhere('action', 'badge.deactivated')?->target_id)->toBe('nachtschicht')
        ->and($events->where('action', 'badge.revoked')->pluck('target_id')->sort()->values()->all())->toBe(collect([$one->id, $two->id, $gone->id])->sort()->values()->all());
});

it('is idempotent: a second run writes nothing', function () {
    nightShiftBadge();
    UserBadge::factory()->create(['user_id' => giftMember()->id, 'badge_key' => 'nachtschicht']);
    retireNightShift()->up();
    $audits = AuditEvent::query()->count();

    expect(retireNightShift()->retire())->toBe(['deactivated' => false, 'revoked' => 0])
        ->and(AuditEvent::query()->count())->toBe($audits);
});

it('still takes the awards back when staff had already deactivated the badge', function () {
    nightShiftBadge(['active' => false]);
    UserBadge::factory()->create(['user_id' => giftMember()->id, 'badge_key' => 'nachtschicht']);

    expect(retireNightShift()->retire())->toBe(['deactivated' => false, 'revoked' => 1])
        ->and(AuditEvent::query()->where('action', 'badge.deactivated')->count())->toBe(0);
});

it('changes nothing on a fresh install, which never seeds the badge', function () {
    giftBadges();

    expect(Badge::query()->whereKey('nachtschicht')->exists())->toBeFalse()
        ->and(retireNightShift()->retire())->toBe(['deactivated' => false, 'revoked' => 0])
        ->and(AuditEvent::query()->where('action', 'like', 'badge.%')->count())->toBe(0);
});
