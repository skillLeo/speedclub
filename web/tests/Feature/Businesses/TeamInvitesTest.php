<?php

use App\Enums\BusinessRole;
use App\Enums\BusinessStatus;
use App\Enums\ModTagStatus;
use App\Enums\NotificationType;
use App\Models\AuditEvent;
use App\Models\Business;
use App\Models\BusinessInvite;
use App\Models\BusinessMember;
use App\Models\ModBusinessTag;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Support\Facades\Gate;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/BusinessTestHelpers.php';

/**
 * SEC-414-01 (High; docs/reports/security/phase-4-m414-m417.md): team membership of a business is an invitation the member accepts.
 * Every abuse path of the report as a probe: the drafted member gets no role, keeps their own application, is told; a business
 * proposal on a team member's build waits for that member; a rival's confirmed tag survives; the invitee accepts or declines, the
 * owner withdraws; the authorisation matrix of the new routes; audit, rate limit and idempotency.
 */
beforeEach(function () {
    bizFlags();
    $this->owner = User::factory()->create(['username' => 'evil.tuning']);
    $this->business = bizBusiness($this->owner, ['slug' => 'evil-tuning', 'name' => 'Evil Tuning']);
    $this->victim = User::factory()->create(['username' => 'victim.e30']);
});

function bizInvite(User $owner, string $username): BusinessInvite
{
    Sanctum::actingAs($owner);
    test()->postJson('/api/v1/me/business/members', ['username' => $username])->assertOk();

    return BusinessInvite::query()->whereHas('user', fn ($query) => $query->where('username', $username))->latest('id')->firstOrFail();
}

function bizNotes(User $user, string $state): int
{
    return Notification::query()->where('notifiable_id', $user->id)->where('type', NotificationType::BusinessInvite->value)
        ->where('data->state', $state)->count();
}

it('makes an added member a pending invitee: no role, no dashboard, free to apply, told in the app', function () {
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/v1/me/business/members', ['username' => '@victim.e30'])->assertOk()
        ->assertJsonPath('data.invites.0.username', 'victim.e30')
        ->assertJsonCount(1, 'data.team');

    expect($this->business->refresh()->roleOf($this->victim))->toBeNull()
        ->and(BusinessMember::query()->where('user_id', $this->victim->id)->exists())->toBeFalse()
        ->and(bizNotes($this->victim, 'invited'))->toBe(1)
        ->and(AuditEvent::query()->where('action', 'business.member_invited')->value('after'))->toMatchArray(['username' => 'victim.e30']);

    Sanctum::actingAs($this->victim);
    $this->getJson('/api/v1/me/business')->assertOk()->assertExactJson(['data' => null]);
    $this->patchJson('/api/v1/me/business', ['about' => 'Übernommen.'])->assertNotFound()->assertJsonPath('code', 'business_unavailable');
    $this->getJson('/api/v1/me/business/tag-requests')->assertNotFound();
    $this->getJson('/api/v1/me/business-invites')->assertOk()->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.business.slug', 'evil-tuning')->assertJsonPath('data.0.invited_by', 'evil.tuning');
    // The drafted member's own application is not blocked (the old 409 business_exists path is gone).
    $this->postJson('/api/v1/me/business', bizBody(), ['Idempotency-Key' => 'sec414-apply-0001'])->assertCreated();
});

it('never confirms a tag on a team member’s build from the business side; the member’s own proposal confirms', function () {
    $mod = bizBuildWithMod($this->victim);
    $invite = bizInvite($this->owner, 'victim.e30');

    // Pending invitee: a proposal waits for the build owner.
    $this->postJson('/api/v1/me/business/tag-requests', ['mod_id' => $mod->id])->assertCreated()
        ->assertJsonPath('data.status', 'pending')->assertJsonPath('data.initiated_by', 'business');
    ModBusinessTag::query()->delete();

    // Even an accepted team member's build: the owner's proposal is a pending proposal for that member.
    Sanctum::actingAs($this->victim);
    $this->postJson("/api/v1/me/business-invites/{$invite->id}/accept")->assertOk()->assertJsonPath('data.viewer_role', 'staff');
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/v1/me/business/tag-requests', ['mod_id' => $mod->id])->assertCreated()
        ->assertJsonPath('data.status', 'pending')->assertJsonPath('data.initiated_by', 'business');
    expect($mod->refresh()->installed_by_business_id)->toBeNull();
    $this->getJson('/api/v1/businesses/evil-tuning/portfolio')->assertJsonCount(0, 'data');
    ModBusinessTag::query()->delete();

    // The member proposing their own build is the owner acting: confirmed at once.
    Sanctum::actingAs($this->victim);
    $this->postJson('/api/v1/me/business/tag-requests', ['mod_id' => $mod->id])->assertCreated()->assertJsonPath('data.status', 'accepted');
    expect($mod->refresh()->installed_by_business_id)->toBe($this->business->id);
});

it('keeps a rival business’s confirmed tag: a proposal is 409, the owner’s own request is 409 business_tag_taken', function () {
    $rival = bizBusiness(null, ['slug' => 'rival-werkstatt']);
    $mod = bizBuildWithMod($this->victim);
    ModBusinessTag::factory()->create(['mod_id' => $mod->id, 'business_id' => $rival->id, 'status' => ModTagStatus::Accepted, 'requested_by' => $this->victim->id]);
    $mod->forceFill(['installed_by_business_id' => $rival->id])->saveQuietly();

    // The report's probe inverted: draft + propose leaves the rival's tag alone.
    bizInvite($this->owner, 'victim.e30');
    $this->postJson('/api/v1/me/business/tag-requests', ['mod_id' => $mod->id])->assertConflict();
    expect(ModBusinessTag::query()->where('business_id', $rival->id)->where('status', ModTagStatus::Accepted->value)->exists())->toBeTrue()
        ->and($mod->refresh()->installed_by_business_id)->toBe($rival->id);
    $this->getJson('/api/v1/businesses/rival-werkstatt/portfolio')->assertJsonCount(1, 'data');
    $this->getJson('/api/v1/businesses/evil-tuning/portfolio')->assertJsonCount(0, 'data');

    // Even the build's owner, now on the team, does not silently replace it.
    $invite = BusinessInvite::query()->where('user_id', $this->victim->id)->firstOrFail();
    Sanctum::actingAs($this->victim);
    $this->postJson("/api/v1/me/business-invites/{$invite->id}/accept")->assertOk();
    $this->putJson("/api/v1/mods/{$mod->id}/business-tag", ['business' => 'evil-tuning'])->assertConflict()->assertJsonPath('code', 'business_tag_taken');
    $this->postJson('/api/v1/me/business/tag-requests', ['mod_id' => $mod->id])->assertConflict()->assertJsonPath('code', 'business_tag_taken');
    expect($mod->refresh()->installed_by_business_id)->toBe($rival->id);

    // Taking it off first, then naming the other business, is the owner's choice.
    $this->deleteJson("/api/v1/mods/{$mod->id}/business-tag")->assertNoContent();
    $this->putJson("/api/v1/mods/{$mod->id}/business-tag", ['business' => 'evil-tuning'])->assertSuccessful()->assertJsonPath('data.status', 'accepted');
});

it('tells a rival whose pending proposal the build owner replaced', function () {
    $rival = bizBusiness(null, ['slug' => 'rival-werkstatt']);
    $member = User::factory()->create();
    $mod = bizBuildWithMod($member);
    ModBusinessTag::factory()->create(['mod_id' => $mod->id, 'business_id' => $rival->id, 'status' => ModTagStatus::Pending, 'initiated_by' => 'business', 'requested_by' => $rival->owner_id]);

    Sanctum::actingAs($member);
    $this->putJson("/api/v1/mods/{$mod->id}/business-tag", ['business' => 'evil-tuning'])->assertSuccessful()->assertJsonPath('data.status', 'pending');
    expect(Notification::query()->where('notifiable_id', $rival->owner_id)->where('type', NotificationType::BusinessTag->value)->where('data->state', 'declined')->exists())->toBeTrue();
});

it('lets the invitee accept: staff with the dashboard, the owner told, other invitations void, audited', function () {
    $other = bizBusiness(null, ['slug' => 'andere-werkstatt']);
    BusinessInvite::factory()->create(['business_id' => $other->id, 'user_id' => $this->victim->id]);
    $invite = bizInvite($this->owner, 'victim.e30');

    Sanctum::actingAs($this->victim);
    $this->getJson('/api/v1/me/business-invites')->assertJsonCount(2, 'data');
    $this->postJson("/api/v1/me/business-invites/{$invite->id}/accept", [], ['Idempotency-Key' => 'sec414-accept-0001'])->assertOk()
        ->assertJsonPath('data.slug', 'evil-tuning')->assertJsonPath('data.viewer_role', 'staff');
    $this->postJson("/api/v1/me/business-invites/{$invite->id}/accept", [], ['Idempotency-Key' => 'sec414-accept-0001'])->assertOk()
        ->assertJsonPath('data.slug', 'evil-tuning');

    expect($this->business->refresh()->roleOf($this->victim))->toBe(BusinessRole::Staff)
        ->and(BusinessInvite::query()->where('user_id', $this->victim->id)->exists())->toBeFalse()
        ->and(bizNotes($this->owner, 'accepted'))->toBe(1)
        ->and(bizNotes($this->victim, 'invited'))->toBe(0)
        ->and(AuditEvent::query()->where('action', 'business.invite_accepted')->where('actor_id', $this->victim->id)->exists())->toBeTrue();
    $this->getJson('/api/v1/me/business')->assertOk()->assertJsonPath('data.slug', 'evil-tuning');
    $this->getJson('/api/v1/me/business-invites')->assertJsonCount(0, 'data');
});

it('refuses an accept when the invitee has a business of their own meanwhile', function () {
    $invite = bizInvite($this->owner, 'victim.e30');
    bizBusiness($this->victim);

    Sanctum::actingAs($this->victim);
    $this->postJson("/api/v1/me/business-invites/{$invite->id}/accept")->assertConflict()->assertJsonPath('code', 'business_exists');
    expect($this->business->refresh()->roleOf($this->victim))->toBeNull();
});

it('lets the invitee decline and the owner withdraw; nothing is left behind', function () {
    $invite = bizInvite($this->owner, 'victim.e30');
    Sanctum::actingAs($this->victim);
    $this->deleteJson("/api/v1/me/business-invites/{$invite->id}")->assertNoContent();
    expect(BusinessInvite::query()->count())->toBe(0)
        ->and(bizNotes($this->owner, 'declined'))->toBe(1)
        ->and(bizNotes($this->victim, 'invited'))->toBe(0)
        ->and(AuditEvent::query()->where('action', 'business.invite_declined')->exists())->toBeTrue();

    $again = bizInvite($this->owner, 'victim.e30');
    expect(bizNotes($this->victim, 'invited'))->toBe(1);
    $this->getJson('/api/v1/me/business')->assertJsonPath('data.invites.0.username', 'victim.e30');
    $this->deleteJson('/api/v1/me/business/members/victim.e30')->assertNoContent();
    expect(BusinessInvite::query()->whereKey($again->id)->exists())->toBeFalse()
        ->and(bizNotes($this->victim, 'invited'))->toBe(0)
        ->and(AuditEvent::query()->where('action', 'business.invite_withdrawn')->exists())->toBeTrue();

    Sanctum::actingAs($this->victim);
    $this->postJson("/api/v1/me/business-invites/{$again->id}/accept")->assertNotFound();
});

it('tells the member when the owner removes them, and the owner when staff leave', function () {
    $staff = User::factory()->create(['username' => 'tom.schrauber']);
    BusinessMember::factory()->create(['business_id' => $this->business->id, 'user_id' => $this->victim->id]);
    BusinessMember::factory()->create(['business_id' => $this->business->id, 'user_id' => $staff->id]);

    Sanctum::actingAs($this->owner);
    $this->deleteJson('/api/v1/me/business/members/victim.e30')->assertNoContent();
    Sanctum::actingAs($staff);
    $this->deleteJson('/api/v1/me/business/members/tom.schrauber')->assertNoContent();

    expect(bizNotes($this->victim, 'removed'))->toBe(1)
        ->and(bizNotes($this->owner, 'left'))->toBe(1)
        ->and(AuditEvent::query()->whereIn('action', ['business.member_removed', 'business.member_left'])->count())->toBe(2);
});

it('guards the invitation routes: guest, another member, blocked, staff of the business, deactivated invitee', function () {
    $invite = bizInvite($this->owner, 'victim.e30');
    app('auth')->forgetGuards();

    $this->getJson('/api/v1/me/business-invites')->assertUnauthorized();
    $this->postJson("/api/v1/me/business-invites/{$invite->id}/accept")->assertUnauthorized();
    $this->deleteJson("/api/v1/me/business-invites/{$invite->id}")->assertUnauthorized();

    // Another member, the inviting owner and staff of the business cannot answer it (it is not theirs: 404).
    $staff = User::factory()->create();
    BusinessMember::factory()->create(['business_id' => $this->business->id, 'user_id' => $staff->id]);

    foreach ([User::factory()->create(), $this->owner, $staff] as $other) {
        Sanctum::actingAs($other);
        $this->getJson('/api/v1/me/business-invites')->assertOk()->assertJsonCount(0, 'data');
        $this->postJson("/api/v1/me/business-invites/{$invite->id}/accept")->assertNotFound();
        $this->deleteJson("/api/v1/me/business-invites/{$invite->id}")->assertNotFound();
    }

    // Staff cannot invite or withdraw (the owner's ability).
    Sanctum::actingAs($staff);
    $this->postJson('/api/v1/me/business/members', ['username' => 'someone.else'])->assertForbidden();
    $this->deleteJson('/api/v1/me/business/members/victim.e30')->assertForbidden();

    // A block with the owner hides the invitation and refuses the accept.
    socBlock($this->victim, $this->owner);
    Sanctum::actingAs($this->victim->refresh());
    $this->getJson('/api/v1/me/business-invites')->assertJsonCount(0, 'data');
    $this->postJson("/api/v1/me/business-invites/{$invite->id}/accept")->assertNotFound()->assertJsonPath('code', 'business_unavailable');
    expect(BusinessMember::query()->where('user_id', $this->victim->id)->exists())->toBeFalse();
});

it('refuses invitations of unknown, blocked or already invited members and counts open invitations against the team limit', function () {
    config(['speedclub.businesses.members_max' => 2]);
    User::factory()->create(['username' => 'second.one']);
    User::factory()->create(['username' => 'third.one']);
    $blocker = User::factory()->create(['username' => 'blocker.one']);
    socBlock($blocker, $this->owner);
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/v1/me/business/members', ['username' => 'gibt.es.nicht'])->assertUnprocessable()->assertJsonValidationErrors('username');
    $this->postJson('/api/v1/me/business/members', ['username' => 'blocker.one'])->assertUnprocessable()->assertJsonValidationErrors('username');
    $this->postJson('/api/v1/me/business/members', ['username' => 'victim.e30'])->assertOk();
    $this->postJson('/api/v1/me/business/members', ['username' => 'victim.e30'])->assertUnprocessable()->assertJsonValidationErrors('username');
    $this->postJson('/api/v1/me/business/members', ['username' => 'second.one'])->assertOk();
    $this->postJson('/api/v1/me/business/members', ['username' => 'third.one'])->assertConflict()->assertJsonPath('code', 'limit_reached');
    expect(BusinessInvite::query()->count())->toBe(2);
});

it('rate limits invitations and answers', function () {
    socLimit('businesses');
    User::factory()->create(['username' => 'second.one']);
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/v1/me/business/members', ['username' => 'victim.e30'])->assertOk();
    $this->postJson('/api/v1/me/business/members', ['username' => 'second.one'])->assertTooManyRequests()->assertJsonPath('code', 'rate_limited');
});

it('lets the invitee decline under a suspension of their account, never accept', function () {
    $invite = bizInvite($this->owner, 'victim.e30');
    $this->victim->forceFill(['status' => 'suspended'])->save();
    $user = $this->victim->refresh();

    expect(Gate::forUser($user)->allows('respond', $invite))->toBeFalse()
        ->and(Gate::forUser($user)->allows('decline', $invite))->toBeTrue();
});

it('lists a business on the invitation that is not public yet, so the member knows who asks', function () {
    $applied = bizBusiness(User::factory()->create(['username' => 'neu.betrieb']), ['status' => 'applied', 'slug' => 'neuer-betrieb', 'verified_at' => null]);
    $invite = bizInvite($applied->owner, 'victim.e30');

    Sanctum::actingAs($this->victim);
    $this->getJson('/api/v1/me/business-invites')->assertJsonPath('data.0.id', $invite->id)->assertJsonPath('data.0.business.verified', false);
    $this->getJson('/api/v1/businesses/neuer-betrieb')->assertNotFound();
    expect(Business::query()->findOrFail($applied->id)->status)->toBe(BusinessStatus::Applied);
});
