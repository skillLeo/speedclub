<?php

use App\Enums\CrewJoinMode;
use App\Enums\CrewRole;
use App\Enums\CrewStatus;
use App\Enums\RestrictionType;
use App\Models\AuditEvent;
use App\Models\CrewInvite;
use App\Models\CrewMember;
use App\Models\CrewRequest;
use App\Models\Notification;
use App\Models\User;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/CrewTestHelpers.php';

/**
 * R4-2.3 Crews, memberships (contract-crews.md §3 #13–26, §5): join by mode, requests with approval, invitations with blocks (C3),
 * leaving, removing, roles, the founder hand-over, the limits, the in-app notifications (none for declines or leaving).
 */
beforeEach(function () {
    crewFlags();
});

function crewNotes(User $user): array
{
    return Notification::query()->where('notifiable_id', $user->id)->where('type', 'crew')->pluck('data')->map(fn ($data) => $data['state'] ?? null)->all();
}

it('joins an open crew at once; twice changes nothing', function () {
    $crew = crewMake();
    $me = User::factory()->create();
    Sanctum::actingAs($me);

    $this->postJson("/api/v1/crews/{$crew->slug}/join")->assertOk()->assertJsonPath('data.viewer.state', 'member')->assertJsonPath('data.member_count', 2);
    $this->postJson("/api/v1/crews/{$crew->slug}/join")->assertOk()->assertJsonPath('data.member_count', 2);
    expect($crew->roleOf($me))->toBe(CrewRole::Member);
});

it('asks to join a request crew; founder and admins hear about it and decide', function () {
    $founder = User::factory()->create();
    $admin = User::factory()->create();
    $crew = crewMake($founder, [], CrewJoinMode::Request);
    crewAdd($crew, $admin, CrewRole::Admin);
    $me = User::factory()->create(['username' => 'jan.anfrage']);

    Sanctum::actingAs($me);
    $this->postJson("/api/v1/crews/{$crew->slug}/join")->assertOk()->assertJsonPath('data.viewer.state', 'requested')->assertJsonPath('data.member_count', 2);
    $this->postJson("/api/v1/crews/{$crew->slug}/join")->assertOk()->assertJsonPath('data.viewer.state', 'requested');
    $this->getJson('/api/v1/me/crew-requests')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.crew.id', $crew->id);
    expect(crewNotes($founder))->toBe(['request_received'])->and(crewNotes($admin))->toBe(['request_received']);

    Sanctum::actingAs($admin);
    $this->getJson('/api/v1/notifications')->assertOk()->assertJsonPath('data.0.type', 'crew')
        ->assertJsonPath('data.0.details.state', 'request_received')->assertJsonPath('data.0.details.crew_slug', $crew->slug)
        ->assertJsonPath('data.0.details.username', 'jan.anfrage');
    $list = $this->getJson("/api/v1/crews/{$crew->slug}/requests")->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.member.username', 'jan.anfrage');
    $id = $list->json('data.0.id');
    $this->postJson("/api/v1/crews/{$crew->slug}/requests/{$id}/approve")->assertCreated()->assertJsonPath('data.role', 'member')->assertJsonPath('data.member.username', 'jan.anfrage');

    expect($crew->roleOf($me))->toBe(CrewRole::Member)->and(CrewRequest::query()->count())->toBe(0)
        ->and(crewNotes($me))->toBe(['request_approved'])->and(crewNotes($founder))->toBe([])->and(crewNotes($admin))->toBe([]);
});

it('declines a request silently and lets the member withdraw one', function () {
    $founder = User::factory()->create();
    $crew = crewMake($founder, [], CrewJoinMode::Request);
    $me = User::factory()->create();
    $request = CrewRequest::factory()->create(['crew_id' => $crew->id, 'user_id' => $me->id]);

    Sanctum::actingAs($founder);
    $this->postJson("/api/v1/crews/{$crew->slug}/requests/{$request->id}/decline")->assertNoContent();
    expect(CrewRequest::query()->count())->toBe(0)->and(crewNotes($me))->toBe([]);

    Sanctum::actingAs($me);
    $this->postJson("/api/v1/crews/{$crew->slug}/join")->assertOk();
    $this->deleteJson("/api/v1/crews/{$crew->slug}/join-request")->assertNoContent();
    $this->deleteJson("/api/v1/crews/{$crew->slug}/join-request")->assertNoContent();
    expect(CrewRequest::query()->count())->toBe(0)->and(crewNotes($founder))->toBe([]);
});

it('refuses to decide requests for members, other members and across a block', function () {
    $founder = User::factory()->create();
    $crew = crewMake($founder, [], CrewJoinMode::Request);
    $member = User::factory()->create();
    crewAdd($crew, $member);
    $applicant = User::factory()->create();
    $request = CrewRequest::factory()->create(['crew_id' => $crew->id, 'user_id' => $applicant->id]);
    $url = "/api/v1/crews/{$crew->slug}/requests/{$request->id}/approve";

    $this->postJson($url)->assertUnauthorized();
    Sanctum::actingAs($member);
    $this->postJson($url)->assertForbidden();
    $this->getJson("/api/v1/crews/{$crew->slug}/requests")->assertForbidden();
    Sanctum::actingAs(User::factory()->create());
    $this->postJson($url)->assertForbidden();

    socBlock($applicant, $founder);
    Sanctum::actingAs($founder);
    $this->getJson("/api/v1/crews/{$crew->slug}/requests")->assertOk()->assertJsonCount(0, 'data');
    $this->postJson($url)->assertNotFound();
    expect($crew->roleOf($applicant))->toBeNull();

    $restricted = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
    crewAdd($crew, $restricted, CrewRole::Admin);
    Sanctum::actingAs($restricted);
    $this->postJson($url)->assertForbidden()->assertJsonPath('code', 'account_restricted');
});

it('keeps invite-only crews closed without an invitation', function () {
    $crew = crewMake(null, [], CrewJoinMode::Invite);
    Sanctum::actingAs(User::factory()->create());

    $this->postJson("/api/v1/crews/{$crew->slug}/join")->assertForbidden()->assertJsonPath('code', 'forbidden');
});

it('invites by username in every mode; the member accepts or declines; admins withdraw', function () {
    $founder = User::factory()->create(['username' => 'ole.founder']);
    $crew = crewMake($founder, [], CrewJoinMode::Invite);
    $guest = User::factory()->create(['username' => 'pia.eingeladen']);

    Sanctum::actingAs($founder);
    $invite = $this->postJson("/api/v1/crews/{$crew->slug}/invites", ['username' => '@pia.eingeladen'])->assertCreated()
        ->assertJsonPath('data.member.username', 'pia.eingeladen')->assertJsonPath('data.invited_by.username', 'ole.founder')->json('data.id');
    $this->postJson("/api/v1/crews/{$crew->slug}/invites", ['username' => 'pia.eingeladen'])->assertUnprocessable()->assertJsonValidationErrors('username');
    $this->postJson("/api/v1/crews/{$crew->slug}/invites", ['username' => 'niemand.hier'])->assertUnprocessable()->assertJsonValidationErrors('username');
    $this->postJson("/api/v1/crews/{$crew->slug}/invites", ['username' => 'ole.founder'])->assertUnprocessable()->assertJsonValidationErrors('username');
    $this->getJson("/api/v1/crews/{$crew->slug}/invites")->assertOk()->assertJsonCount(1, 'data');
    expect(crewNotes($guest))->toBe(['invited']);

    Sanctum::actingAs($guest);
    $this->getJson('/api/v1/crews/'.$crew->slug)->assertOk()->assertJsonPath('data.viewer.state', 'invited')
        ->assertJsonPath('data.viewer.invite_id', $invite)->assertJsonPath('data.viewer.can.join', true);
    $this->getJson('/api/v1/me/crew-invites')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $invite);
    $this->postJson("/api/v1/me/crew-invites/{$invite}/accept")->assertOk()->assertJsonPath('data.viewer.role', 'member');
    expect($crew->roleOf($guest))->toBe(CrewRole::Member)->and(CrewInvite::query()->count())->toBe(0)->and(crewNotes($guest))->toBe([]);

    // Decline and withdraw.
    $second = User::factory()->create(['username' => 'rudi.zweiter']);
    $third = User::factory()->create(['username' => 'susi.dritte']);
    Sanctum::actingAs($founder);
    $this->postJson("/api/v1/crews/{$crew->slug}/invites", ['username' => 'rudi.zweiter'])->assertCreated();
    $withdraw = $this->postJson("/api/v1/crews/{$crew->slug}/invites", ['username' => 'susi.dritte'])->assertCreated()->json('data.id');
    $this->deleteJson("/api/v1/crews/{$crew->slug}/invites/{$withdraw}")->assertNoContent();
    expect(crewNotes($third))->toBe([]);

    Sanctum::actingAs($second);
    $id = CrewInvite::query()->where('user_id', $second->id)->value('id');
    $this->deleteJson("/api/v1/me/crew-invites/{$id}")->assertNoContent();
    expect(CrewInvite::query()->count())->toBe(0)->and(crewNotes($founder))->toBe([]);

    // Another member's invitation is a 404.
    $foreign = CrewInvite::factory()->create(['crew_id' => $crew->id]);
    $this->postJson("/api/v1/me/crew-invites/{$foreign->id}/accept")->assertNotFound();
});

it('lets an open invitation into a request crew join directly, ending the request', function () {
    $founder = User::factory()->create();
    $crew = crewMake($founder, [], CrewJoinMode::Request);
    $me = User::factory()->create();
    CrewRequest::factory()->create(['crew_id' => $crew->id, 'user_id' => $me->id]);
    CrewInvite::factory()->create(['crew_id' => $crew->id, 'user_id' => $me->id, 'invited_by' => $founder->id]);

    Sanctum::actingAs($me);
    $this->postJson("/api/v1/crews/{$crew->slug}/join")->assertOk()->assertJsonPath('data.viewer.state', 'member');
    expect(CrewRequest::query()->count())->toBe(0)->and(CrewInvite::query()->count())->toBe(0);
});

it('never invites across a block, and drops an invitation a block came between', function () {
    $founder = User::factory()->create();
    $crew = crewMake($founder);
    $blocked = User::factory()->create(['username' => 'tim.geblockt']);
    socBlock($blocked, $founder);

    Sanctum::actingAs($founder);
    $this->postJson("/api/v1/crews/{$crew->slug}/invites", ['username' => 'tim.geblockt'])->assertUnprocessable()->assertJsonValidationErrors('username');

    $later = User::factory()->create();
    $invite = CrewInvite::factory()->create(['crew_id' => $crew->id, 'user_id' => $later->id, 'invited_by' => $founder->id]);
    socBlock($founder, $later);
    Sanctum::actingAs($later);
    $this->getJson('/api/v1/me/crew-invites')->assertOk()->assertJsonCount(0, 'data');
    $this->postJson("/api/v1/me/crew-invites/{$invite->id}/accept")->assertNotFound()->assertJsonPath('code', 'crew_unavailable');
});

it('refuses invitations by plain members, others, guests and restricted admins', function () {
    $founder = User::factory()->create();
    $crew = crewMake($founder);
    User::factory()->create(['username' => 'uwe.ziel']);
    $member = User::factory()->create();
    crewAdd($crew, $member);
    $restricted = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
    crewAdd($crew, $restricted, CrewRole::Admin);
    $url = "/api/v1/crews/{$crew->slug}/invites";

    $this->postJson($url, ['username' => 'uwe.ziel'])->assertUnauthorized();
    Sanctum::actingAs($member);
    $this->postJson($url, ['username' => 'uwe.ziel'])->assertForbidden();
    Sanctum::actingAs(User::factory()->create());
    $this->postJson($url, ['username' => 'uwe.ziel'])->assertForbidden();
    Sanctum::actingAs($restricted);
    $this->postJson($url, ['username' => 'uwe.ziel'])->assertForbidden()->assertJsonPath('code', 'account_restricted');
    expect(CrewInvite::query()->count())->toBe(0);
});

it('holds a member to 5 crews and 10 open requests', function () {
    $me = User::factory()->create();
    foreach (range(1, 5) as $i) {
        crewAdd(crewMake(), $me);
    }
    $open = crewMake();
    $invited = crewMake();
    $invite = CrewInvite::factory()->create(['crew_id' => $invited->id, 'user_id' => $me->id, 'invited_by' => crewFounder($invited)->id]);

    Sanctum::actingAs($me);
    $this->postJson("/api/v1/crews/{$open->slug}/join")->assertStatus(409)->assertJsonPath('code', 'limit_reached');
    $this->postJson("/api/v1/me/crew-invites/{$invite->id}/accept")->assertStatus(409)->assertJsonPath('code', 'limit_reached');

    $asker = User::factory()->create();
    foreach (range(1, 10) as $i) {
        CrewRequest::factory()->create(['user_id' => $asker->id]);
    }
    Sanctum::actingAs($asker);
    $this->postJson('/api/v1/crews/'.crewMake(null, [], CrewJoinMode::Request)->slug.'/join')->assertStatus(409)->assertJsonPath('code', 'limit_reached');
});

it('keeps an approval from passing the limit; the request stays', function () {
    $founder = User::factory()->create();
    $crew = crewMake($founder, [], CrewJoinMode::Request);
    $me = User::factory()->create();
    $request = CrewRequest::factory()->create(['crew_id' => $crew->id, 'user_id' => $me->id]);
    foreach (range(1, 5) as $i) {
        crewAdd(crewMake(), $me);
    }

    Sanctum::actingAs($founder);
    $this->postJson("/api/v1/crews/{$crew->slug}/requests/{$request->id}/approve")->assertStatus(409)->assertJsonPath('code', 'limit_reached');
    expect(CrewRequest::query()->whereKey($request->id)->exists())->toBeTrue();
});

it('refuses joins of unverified and restricted members and on a hidden crew', function () {
    $crew = crewMake();
    Sanctum::actingAs(User::factory()->unverified()->create());
    $this->postJson("/api/v1/crews/{$crew->slug}/join")->assertForbidden()->assertJsonPath('code', 'email_not_verified');
    Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Publishing)->create());
    $this->postJson("/api/v1/crews/{$crew->slug}/join")->assertForbidden()->assertJsonPath('code', 'account_restricted');

    $hidden = crewMake(null, ['status' => CrewStatus::Hidden]);
    Sanctum::actingAs(User::factory()->create());
    $this->postJson("/api/v1/crews/{$hidden->slug}/join")->assertNotFound()->assertJsonPath('code', 'crew_unavailable');
});

it('replays a join with the same Idempotency-Key and rate limits crew actions', function () {
    $crew = crewMake();
    Sanctum::actingAs(User::factory()->create());
    $key = ['Idempotency-Key' => 'c4d5e6f7-crew-join-0001-1d2e3f4a5b6c'];
    $this->postJson("/api/v1/crews/{$crew->slug}/join", [], $key)->assertOk();
    $this->postJson("/api/v1/crews/{$crew->slug}/join", [], $key)->assertOk();

    socLimit('crew_actions');
    Sanctum::actingAs(User::factory()->create());
    $other = crewMake();
    $this->postJson("/api/v1/crews/{$other->slug}/join")->assertOk();
    $this->postJson("/api/v1/crews/{$other->slug}/leave")->assertTooManyRequests()->assertJsonPath('code', 'rate_limited');
});

it('lets members and admins leave; the founder hands over or deletes first', function () {
    $founder = User::factory()->create();
    $crew = crewMake($founder);
    $member = User::factory()->create();
    crewAdd($crew, $member);

    Sanctum::actingAs($member);
    $this->postJson("/api/v1/crews/{$crew->slug}/leave")->assertNoContent();
    expect($crew->roleOf($member))->toBeNull()->and($crew->refresh()->members_count)->toBe(1)->and(crewNotes($founder))->toBe([]);

    Sanctum::actingAs($founder);
    $this->postJson("/api/v1/crews/{$crew->slug}/leave")->assertStatus(409)->assertJsonPath('code', 'conflict');
});

it('lets the founder remove anyone, admins only members', function () {
    $founder = User::factory()->create(['username' => 'vera.founder']);
    $crew = crewMake($founder);
    $admin = User::factory()->create(['username' => 'will.admin']);
    $admin2 = User::factory()->create(['username' => 'xena.admin']);
    $member = User::factory()->create(['username' => 'yusuf.member']);
    crewAdd($crew, $admin, CrewRole::Admin);
    crewAdd($crew, $admin2, CrewRole::Admin);
    crewAdd($crew, $member);

    Sanctum::actingAs($admin);
    $this->deleteJson("/api/v1/crews/{$crew->slug}/members/vera.founder")->assertForbidden();
    $this->deleteJson("/api/v1/crews/{$crew->slug}/members/xena.admin")->assertForbidden();
    $this->deleteJson("/api/v1/crews/{$crew->slug}/members/yusuf.member")->assertNoContent();
    $this->deleteJson("/api/v1/crews/{$crew->slug}/members/niemand")->assertNotFound();

    Sanctum::actingAs($member);
    $this->deleteJson("/api/v1/crews/{$crew->slug}/members/will.admin")->assertForbidden();

    Sanctum::actingAs($founder);
    $this->deleteJson("/api/v1/crews/{$crew->slug}/members/xena.admin")->assertNoContent();
    $this->deleteJson("/api/v1/crews/{$crew->slug}/members/vera.founder")->assertForbidden();

    expect($crew->refresh()->members_count)->toBe(2)
        ->and(AuditEvent::query()->where('action', 'crew.member_removed')->where('target_id', $crew->id)->count())->toBe(2);
});

it('lets only the founder promote and demote admins', function () {
    $founder = User::factory()->create();
    $crew = crewMake($founder);
    $admin = User::factory()->create(['username' => 'zoe.admin']);
    $member = User::factory()->create(['username' => 'adam.member']);
    crewAdd($crew, $admin, CrewRole::Admin);
    crewAdd($crew, $member);

    Sanctum::actingAs($admin);
    $this->patchJson("/api/v1/crews/{$crew->slug}/members/adam.member", ['role' => 'admin'])->assertForbidden();

    Sanctum::actingAs($founder);
    $this->patchJson("/api/v1/crews/{$crew->slug}/members/adam.member", ['role' => 'admin'])->assertOk()->assertJsonPath('data.role', 'admin');
    $this->patchJson("/api/v1/crews/{$crew->slug}/members/zoe.admin", ['role' => 'member'])->assertOk()->assertJsonPath('data.role', 'member');
    $this->patchJson("/api/v1/crews/{$crew->slug}/members/adam.member", ['role' => 'founder'])->assertUnprocessable()->assertJsonValidationErrors('role');
    $this->patchJson("/api/v1/crews/{$crew->slug}/members/{$founder->username}", ['role' => 'member'])->assertUnprocessable()->assertJsonValidationErrors('role');

    expect($crew->roleOf($member))->toBe(CrewRole::Admin)->and($crew->roleOf($admin))->toBe(CrewRole::Member);
});

it('hands the founder role over; the old founder stays as admin; the new one founds at most 2', function () {
    $founder = User::factory()->create();
    $crew = crewMake($founder);
    $heir = User::factory()->create(['username' => 'bea.erbin']);
    crewAdd($crew, $heir);
    $busy = User::factory()->create(['username' => 'carlo.busy']);
    crewAdd($crew, $busy);
    crewMake($busy);
    crewMake($busy);

    Sanctum::actingAs($heir);
    $this->postJson("/api/v1/crews/{$crew->slug}/founder", ['username' => 'bea.erbin'])->assertForbidden();

    Sanctum::actingAs($founder);
    $this->postJson("/api/v1/crews/{$crew->slug}/founder", ['username' => 'carlo.busy'])->assertStatus(409)->assertJsonPath('code', 'limit_reached');
    $this->postJson("/api/v1/crews/{$crew->slug}/founder", ['username' => 'niemand'])->assertNotFound();
    $this->postJson("/api/v1/crews/{$crew->slug}/founder", ['username' => 'bea.erbin'])->assertOk()
        ->assertJsonPath('data.founder.username', 'bea.erbin')->assertJsonPath('data.viewer.role', 'admin');

    expect(CrewMember::query()->where('crew_id', $crew->id)->where('role', CrewRole::Founder->value)->pluck('user_id')->all())->toBe([$heir->id])
        ->and(AuditEvent::query()->where('action', 'crew.founder_transferred')->exists())->toBeTrue();
});
