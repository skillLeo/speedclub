<?php

use App\Models\AuditEvent;
use App\Models\Badge;
use App\Models\Notification;
use App\Models\User;
use App\Models\UserBadge;
use App\Services\Notifications\Notifier;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/../Support/helpers.php';

/**
 * SEC-P5G-05 "Abzeichen entziehen" (ADM-10 Übersicht, panel "Abzeichen"): moderation.decide (Owner, Admin, Moderator) on the route ahead of
 * the password check, a reason, ⚿. RevokeBadge removes the user_badges row and the member's unread `badge_unlocked` notice of that badge
 * (a read one stays), audited `badge.revoked` on the member. The panel lists the earned badges for every members.view role.
 */
const ADM10B_REVOKE = ['owner', 'admin', 'moderator'];
const ADM10B_REASON = 'Spots per Serie erschlichen, Spots bereits entfernt.';

function adm10bAs(string $role): void
{
    seedStaffRoles();
    actingAsStaff(staffWithRole($role));
    test()->withSession(['auth.password_confirmed_at' => time()]);
}

/** A member who earned $key, with the unlock notice the awarder writes. */
function adm10bEarned(string $key = 'erster-spot', bool $read = false): User
{
    $member = User::factory()->create();
    $badge = Badge::query()->find($key) ?? Badge::factory()->create(['key' => $key, 'name_de' => 'Erster Spot', 'rule_json' => ['metric' => 'cars_spotted', 'gte' => 1]]);
    UserBadge::factory()->create(['user_id' => $member->id, 'badge_key' => $badge->key, 'source_ref' => 'event']);
    $notice = app(Notifier::class)->badgeUnlocked($member, $badge, push: false);
    if ($read) {
        $notice?->forceFill(['read_at' => now()])->save();
    }

    return $member;
}

it('guards "Entziehen" by moderation.decide, ahead of the password check', function () {
    $member = adm10bEarned();

    assertAdminMatrix('POST', "/admin/members/{$member->id}/badges/erster-spot/revoke", ADM10B_REVOKE, function (TestResponse $r): void {
        expect($r->status())->toBeIn([302, 303, 423]);
    }, ['reason' => ADM10B_REASON]);

    expect(UserBadge::query()->where('user_id', $member->id)->count())->toBe(1)
        ->and(AuditEvent::query()->where('action', 'badge.revoked')->count())->toBe(0);
});

it('revokes one badge: the row and its unread notice go, audited on the member with the reason', function (string $role) {
    $member = adm10bEarned();
    $other = Badge::factory()->create(['key' => 'erster-build']);
    UserBadge::factory()->create(['user_id' => $member->id, 'badge_key' => $other->key]);
    adm10bAs($role);

    $this->post("/admin/members/{$member->id}/badges/erster-spot/revoke", ['reason' => ADM10B_REASON])
        ->assertStatus(303)
        ->assertSessionHas('success', 'members.badges.flash.revoked');

    $event = AuditEvent::query()->where('action', 'badge.revoked')->sole();
    expect(UserBadge::query()->where('user_id', $member->id)->pluck('badge_key')->all())->toBe(['erster-build'])
        ->and(Notification::query()->where('notifiable_id', $member->id)->where('group_key', 'badge_unlocked:erster-spot')->exists())->toBeFalse()
        ->and($event->target_type)->toBe('user')
        ->and($event->target_id)->toBe($member->id)
        ->and($event->reason)->toBe(ADM10B_REASON)
        ->and($event->before['badge_key'])->toBe('erster-spot')
        ->and($event->after['notification_removed'])->toBeTrue();
})->with(ADM10B_REVOKE);

it('keeps a notice the member already read', function () {
    $member = adm10bEarned(read: true);
    adm10bAs('moderator');

    $this->post("/admin/members/{$member->id}/badges/erster-spot/revoke", ['reason' => ADM10B_REASON])->assertStatus(303);

    expect(UserBadge::query()->where('user_id', $member->id)->exists())->toBeFalse()
        ->and(Notification::query()->where('notifiable_id', $member->id)->where('group_key', 'badge_unlocked:erster-spot')->exists())->toBeTrue();
});

it('refuses a reason over 1000 characters (ADR-540: none is needed) and needs a badge the member holds', function () {
    $member = adm10bEarned();
    adm10bAs('admin');

    $this->post("/admin/members/{$member->id}/badges/erster-spot/revoke", ['reason' => str_repeat('x', 1001)])->assertSessionHasErrors('reason');
    $this->post("/admin/members/{$member->id}/badges/erster-build/revoke", ['reason' => ADM10B_REASON])->assertSessionHasErrors('badge');

    expect(UserBadge::query()->where('user_id', $member->id)->count())->toBe(1)
        ->and(AuditEvent::query()->where('action', 'badge.revoked')->count())->toBe(0);
});

it('lists the earned badges on Übersicht, with "Entziehen" only for moderation.decide', function (string $role, bool $canRevoke) {
    $member = adm10bEarned();
    adm10bAs($role);

    $this->get("/admin/members/{$member->id}")->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
        ->has('badges.earned', 1)
        ->where('badges.earned.0.key', 'erster-spot')
        ->where('badges.earned.0.name', 'Erster Spot')
        ->where('badges.earned.0.source', 'event')
        ->where('badges.can_revoke', $canRevoke));
    $this->get("/admin/members/{$member->id}?tab=vehicles")->assertInertia(fn (AssertableInertia $page) => $page->missing('badges'));
})->with([
    'owner' => ['owner', true],
    'moderator' => ['moderator', true],
    'support' => ['support', false],
    'analyst' => ['analyst', false],
]);
