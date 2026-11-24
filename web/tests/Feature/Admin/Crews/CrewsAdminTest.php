<?php

use App\Enums\Bundesland;
use App\Enums\CaseOrigin;
use App\Enums\CrewEndReason;
use App\Enums\CrewJoinMode;
use App\Enums\CrewRole;
use App\Enums\CrewStatus;
use App\Enums\DecisionAction;
use App\Enums\ReportTargetType;
use App\Models\AuditEvent;
use App\Models\Crew;
use App\Models\CrewInvite;
use App\Models\CrewMember;
use App\Models\CrewRequest;
use App\Models\Decision;
use App\Models\ModerationCase;
use App\Models\Staff;
use App\Models\User;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/../Support/helpers.php';

/**
 * ADM-80/81 Crews (R4-2.3, contract-crews.md §6/§8, C6). The module needs moderation.decide (the atom of the crew Staff actions; Owner,
 * Admin, Moderator), reads included; everybody else hears 403. Hide is a remove_content decision with the statement of reasons, unhide
 * its reversal, remove only follows a hide (removed + soft delete), restore brings a staff-deleted crew back hidden. Every write needs a
 * reason and a recent password and is audited by the Staff actions. No four-eyes for crews (a staff delete is reversible and only
 * follows a hide); a direct POST cannot skip the hide either.
 */
const ADM80_ROLES = ['owner', 'admin', 'moderator'];
const ADM80_REASON = 'Gemeldet wegen Werbung, Beschreibung geprüft.';

function adm80As(string $role = 'moderator', bool $confirmed = true): Staff
{
    seedStaffRoles();
    $staff = staffWithRole($role);
    actingAsStaff($staff);
    if ($confirmed) {
        test()->withSession(['auth.password_confirmed_at' => time()]);
    }

    return $staff;
}

/** A crew with its founder and, optionally, more members. */
function adm80Crew(array $attributes = [], ?User $founder = null): Crew
{
    return Crew::factory()->foundedBy($founder ?? User::factory()->create())->create($attributes);
}

/** @return array<string, string> */
function adm80Statement(): array
{
    return [
        'facts' => 'Die Crew wirbt in Name und Beschreibung für einen Teileverkauf.',
        'ground' => 'Keine Werbung und kein Spam',
        'ground_document' => 'community',
        'ground_section' => '4',
        'reason' => ADM80_REASON,
    ];
}

/** An open report case on the crew; the founder is its subject (contract-crews §6). */
function adm80Case(Crew $crew): ModerationCase
{
    return ModerationCase::factory()->create([
        'target_type' => ReportTargetType::Crew,
        'target_id' => $crew->id,
        'subject_id' => $crew->founder()?->id ?? User::factory()->create()->id,
        'open_target' => ModerationCase::openKey(ReportTargetType::Crew, $crew->id),
    ]);
}

function adm80Hidden(?Crew $crew = null): Crew
{
    $crew ??= adm80Crew();
    adm80As();
    test()->post("/admin/crews/{$crew->id}/hide", adm80Statement())->assertStatus(303)->assertSessionHas('success', 'crews.flash.hidden');
    app('auth')->forgetGuards();

    return $crew->refresh();
}

// ---- authorisation matrix ---------------------------------------------------------------------------------------------------------

it('lets only moderation.decide read the list and the record', function () {
    $crew = adm80Crew();

    assertAdminMatrix('GET', '/admin/crews', ADM80_ROLES, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component('Crews/Index')));
    assertAdminMatrix('GET', "/admin/crews/{$crew->id}", ADM80_ROLES, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component('Crews/Show')->where('crew.id', $crew->id)));
});

it('guards every Staff action by moderation.decide ahead of the password check', function (string $action) {
    $crew = adm80Crew();

    assertAdminMatrix('POST', "/admin/crews/{$crew->id}/$action", ADM80_ROLES, function (TestResponse $r): void {
        // Allowed roles without a recent confirmation are sent to the password dialog; nothing runs.
        expect($r->status())->toBe(303);
        $r->assertSessionHas('confirm_password', true);
    }, [...adm80Statement(), 'reason' => ADM80_REASON]);

    expect($crew->refresh()->status)->toBe(CrewStatus::Active)
        ->and(AuditEvent::query()->where('action', 'like', 'crew.%')->count())->toBe(0)
        ->and(Decision::query()->count())->toBe(0);
})->with(['hide', 'unhide', 'remove', 'restore']);

// ---- ADM-80 list ---------------------------------------------------------------------------------------------------------------------

it('lists every crew newest first with founder, Bundesland, join mode, members and the staff state', function () {
    $founder = User::factory()->create(['username' => 'nordlicht.kai']);
    $this->travel(-3)->days();
    $old = adm80Crew(['name' => 'Alte Garde', 'bundesland' => Bundesland::HH, 'join_mode' => CrewJoinMode::Request], $founder);
    $this->travelBack();
    CrewMember::factory()->role(CrewRole::Member)->create(['crew_id' => $old->id, 'user_id' => User::factory()->create()->id]);
    $old->forceFill(['members_count' => 2])->saveQuietly();
    $new = adm80Crew(['name' => 'Benzin Brüder']);
    $hidden = adm80Crew(['name' => 'Schattenwerk', 'status' => CrewStatus::Hidden]);
    $removed = adm80Crew(['name' => 'Weg vom Team', 'status' => CrewStatus::Removed]);
    $removed->delete();
    $deleted = adm80Crew(['name' => 'Selbst gelöscht']);
    $deleted->delete();
    // R4DQ-55: a crew the system ended because nobody was left in it.
    $ended = adm80Crew(['name' => 'Niemand mehr da']);
    $ended->forceFill(['ended_reason' => CrewEndReason::NoMembers])->save();
    $ended->delete();
    adm80As('moderator');

    $rows = collect($this->get('/admin/crews')->assertOk()->inertiaProps('rows.data'))->keyBy('id');

    expect($rows)->toHaveCount(6)
        ->and($rows[$ended->id]['state'])->toBe('ended')
        ->and($rows[$old->id])->toMatchArray(['name' => 'Alte Garde', 'bundesland' => Bundesland::HH->label(), 'join_mode' => 'request', 'members' => 2, 'state' => 'active', 'founder' => ['id' => $founder->id, 'username' => 'nordlicht.kai']])
        ->and($rows[$hidden->id]['state'])->toBe('hidden')
        ->and($rows[$removed->id]['state'])->toBe('removed')
        ->and($rows[$deleted->id]['state'])->toBe('deleted')
        ->and($rows->keys()->last())->toBe($old->id)
        ->and($rows[$new->id]['state'])->toBe('active');
});

it('returns exactly the crews of each status filter', function (string $status, array $expected) {
    adm80Crew(['name' => 'Aktiv Eins']);
    adm80Crew(['name' => 'Versteckt', 'status' => CrewStatus::Hidden]);
    $removed = adm80Crew(['name' => 'Entfernt', 'status' => CrewStatus::Removed]);
    $removed->delete();
    $deleted = adm80Crew(['name' => 'Gründer weg']);
    $deleted->delete();
    $hiddenDeleted = adm80Crew(['name' => 'Versteckt und weg', 'status' => CrewStatus::Hidden]);
    $hiddenDeleted->delete();
    $ended = adm80Crew(['name' => 'Niemand mehr da']);
    $ended->forceFill(['ended_reason' => CrewEndReason::NoMembers])->save();
    $ended->delete();
    adm80As();

    $names = collect($this->get('/admin/crews?filter[status]='.$status)->assertOk()->inertiaProps('rows.data'))->pluck('name')->all();

    expect($names)->toEqualCanonicalizing($expected);
})->with([
    'active' => ['active', ['Aktiv Eins']],
    'hidden' => ['hidden', ['Versteckt']],
    'removed' => ['removed', ['Entfernt']],
    'deleted' => ['deleted', ['Gründer weg', 'Versteckt und weg']],
    'ended' => ['ended', ['Niemand mehr da']],
]);

it('searches by name or slug and sorts by name, never by size', function () {
    adm80Crew(['name' => 'Zylinderkopf Crew', 'slug' => 'zylinderkopf-crew']);
    adm80Crew(['name' => 'Alpha Boost', 'slug' => 'alpha-boost']);
    adm80Crew(['name' => 'Mitte', 'slug' => 'nachtschicht-ruhr']);
    adm80As();

    expect(collect($this->get('/admin/crews?filter[q]=boost')->inertiaProps('rows.data'))->pluck('name')->all())->toBe(['Alpha Boost'])
        ->and(collect($this->get('/admin/crews?filter[q]=nachtschicht')->inertiaProps('rows.data'))->pluck('name')->all())->toBe(['Mitte'])
        ->and(collect($this->get('/admin/crews?sort=name')->inertiaProps('rows.data'))->pluck('name')->all())->toBe(['Alpha Boost', 'Mitte', 'Zylinderkopf Crew']);

    // C2: the member count is a fact, never an order; the whitelist refuses it.
    expect($this->get('/admin/crews?sort=-members_count')->status())->toBe(400);
});

// ---- ADM-81 record ------------------------------------------------------------------------------------------------------------------

it('shows the crew with founder, members by role, open requests and invitations, cases and the activity', function () {
    $founder = User::factory()->create(['username' => 'gruender']);
    $crew = adm80Crew(['name' => 'Ruhrpott Boost', 'description' => 'Turbo-Treffen jeden Freitag.', 'join_mode' => CrewJoinMode::Request], $founder);
    $member = User::factory()->create(['username' => 'mitglied']);
    $admin = User::factory()->create(['username' => 'vize']);
    $this->travel(1)->minutes();
    CrewMember::factory()->role(CrewRole::Member)->create(['crew_id' => $crew->id, 'user_id' => $member->id]);
    $this->travel(1)->minutes();
    CrewMember::factory()->role(CrewRole::Admin)->create(['crew_id' => $crew->id, 'user_id' => $admin->id]);
    CrewRequest::factory()->create(['crew_id' => $crew->id]);
    CrewRequest::factory()->create(['crew_id' => $crew->id]);
    CrewInvite::factory()->create(['crew_id' => $crew->id]);
    $case = adm80Case($crew);
    adm80As();

    $props = $this->get("/admin/crews/{$crew->id}")->assertOk()->inertiaProps();

    expect($props['crew'])->toMatchArray([
        'name' => 'Ruhrpott Boost', 'description' => 'Turbo-Treffen jeden Freitag.', 'join_mode' => 'request', 'state' => 'active',
        'open_requests' => 2, 'open_invites' => 1,
        'can' => ['hide' => true, 'unhide' => false, 'remove' => false, 'restore' => false],
    ])
        ->and($props['crew']['founder']['username'])->toBe('gruender')
        ->and($props['crew']['public_url'])->toEndWith('/app/crews/'.$crew->slug)
        ->and(collect($props['members']['rows'])->map(fn (array $r) => [$r['member']['username'], $r['role']])->all())->toBe([['gruender', 'founder'], ['vize', 'admin'], ['mitglied', 'member']])
        ->and($props['members']['total'])->toBe(3)
        ->and($props['cases'][0]['id'])->toBe($case->id);
});

it('opens a crew its founder deleted and one staff removed', function () {
    $deleted = adm80Crew();
    $deleted->delete();
    adm80As();

    $this->get("/admin/crews/{$deleted->id}")->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->where('crew.state', 'deleted')->where('crew.public_url', null)
        ->where('crew.can', ['hide' => false, 'unhide' => false, 'remove' => false, 'restore' => false]));
});

// ---- hide · unhide · remove · restore ----------------------------------------------------------------------------------------------

it('hides an active crew as a DSA decision with the statement of reasons, audited', function () {
    $crew = adm80Crew();
    $staff = adm80As('moderator');

    $this->post("/admin/crews/{$crew->id}/hide", adm80Statement())->assertStatus(303)->assertSessionHas('success', 'crews.flash.hidden');

    $decision = Decision::query()->sole();
    $event = AuditEvent::query()->where('action', 'crew.hidden')->sole();
    expect($crew->refresh()->status)->toBe(CrewStatus::Hidden)
        ->and($decision->action)->toBe(DecisionAction::RemoveContent)
        ->and($decision->facts())->toBe(adm80Statement()['facts'])
        ->and($decision->case->target_type)->toBe(ReportTargetType::Crew)
        ->and($decision->case->origin)->toBe(CaseOrigin::Staff)
        ->and($event->reason)->toBe(ADM80_REASON)
        ->and($event->actor_id)->toBe((string) $staff->id);

    $this->get("/admin/crews/{$crew->id}")->assertInertia(fn (AssertableInertia $page) => $page->where('crew.state', 'hidden')
        ->where('crew.can', ['hide' => false, 'unhide' => true, 'remove' => true, 'restore' => false])
        ->has('activity', fn (AssertableInertia $a) => $a->etc()));
});

it('unhides a hidden crew with the facts the founder reads', function () {
    $crew = adm80Hidden();
    adm80As('admin');

    $this->post("/admin/crews/{$crew->id}/unhide", ['facts' => 'Die Werbung wurde aus der Beschreibung entfernt.', 'reason' => ADM80_REASON])
        ->assertStatus(303)->assertSessionHas('success', 'crews.flash.unhidden');

    expect($crew->refresh()->status)->toBe(CrewStatus::Active)
        ->and(Decision::query()->where('action', DecisionAction::Reverse->value)->count())->toBe(1)
        ->and(AuditEvent::query()->where('action', 'crew.unhidden')->sole()->reason)->toBe(ADM80_REASON);
});

it('deletes only a hidden crew and restores it as hidden', function () {
    $active = adm80Crew();
    adm80As();

    // A direct POST cannot skip the hide (the founder must have the statement of reasons first).
    $this->post("/admin/crews/{$active->id}/remove", ['reason' => ADM80_REASON])->assertStatus(303)->assertSessionHas('error', 'crews.flash.not_possible');
    expect($active->refresh()->trashed())->toBeFalse()->and(AuditEvent::query()->where('action', 'crew.removed')->count())->toBe(0);

    $crew = adm80Hidden();
    adm80As();
    $this->post("/admin/crews/{$crew->id}/remove", ['reason' => ADM80_REASON])->assertStatus(303)->assertSessionHas('success', 'crews.flash.removed');
    $crew = Crew::withTrashed()->findOrFail($crew->id);
    expect($crew->status)->toBe(CrewStatus::Removed)->and($crew->trashed())->toBeTrue()
        ->and(CrewMember::query()->where('crew_id', $crew->id)->count())->toBe(1);

    $this->get("/admin/crews/{$crew->id}")->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->where('crew.state', 'removed')->where('crew.can.restore', true));

    $this->post("/admin/crews/{$crew->id}/restore", ['reason' => ADM80_REASON])->assertStatus(303)->assertSessionHas('success', 'crews.flash.restored');
    $crew->refresh();
    expect($crew->status)->toBe(CrewStatus::Hidden)->and($crew->trashed())->toBeFalse()
        ->and(AuditEvent::query()->whereIn('action', ['crew.removed', 'crew.restored'])->pluck('reason')->all())->toBe([ADM80_REASON, ADM80_REASON]);
});

it('refuses actions the state does not allow and changes nothing', function (string $action, Closure $crew) {
    $target = $crew();
    adm80As();
    $before = AuditEvent::query()->count();

    $this->post("/admin/crews/{$target->id}/$action", [...adm80Statement(), 'facts' => 'Die Werbung wurde entfernt, alles gut.'])
        ->assertStatus(303)->assertSessionHas('error', 'crews.flash.not_possible');

    expect(AuditEvent::query()->count())->toBe($before);
})->with([
    'hide a hidden crew' => ['hide', fn () => adm80Crew(['status' => CrewStatus::Hidden])],
    'unhide an active crew' => ['unhide', fn () => adm80Crew()],
    'restore an active crew' => ['restore', fn () => adm80Crew()],
    'restore a crew its founder deleted' => ['restore', function () {
        $crew = adm80Crew();
        $crew->delete();

        return $crew;
    }],
]);

it('needs a statement of reasons; an internal reason is optional, at most 1000 characters (ADR-540)', function (string $action, array $data, string $field) {
    $crew = $action === 'hide' ? adm80Crew() : adm80Hidden();
    adm80As();

    $this->post("/admin/crews/{$crew->id}/$action", $data)->assertSessionHasErrors($field);

    expect(AuditEvent::query()->where('action', 'like', 'crew.%')->where('action', '!=', 'crew.hidden')->count())->toBe(0);
})->with([
    'hide without facts' => ['hide', [...adm80Statement(), 'facts' => ''], 'facts'],
    'hide without ground' => ['hide', [...adm80Statement(), 'ground' => ''], 'ground'],
    'unhide without facts' => ['unhide', ['reason' => ADM80_REASON], 'facts'],
    'remove with a reason over 1000 characters' => ['remove', ['reason' => str_repeat('a', 1001)], 'reason'],
    'restore with a long reason' => ['restore', ['reason' => str_repeat('a', 1001)], 'reason'],
]);

it('asks for the password first when the last confirmation is stale', function () {
    $crew = adm80Crew();
    adm80As('owner', confirmed: false);

    $this->post("/admin/crews/{$crew->id}/hide", adm80Statement())->assertStatus(303)->assertSessionHas('confirm_password', true);

    expect($crew->refresh()->status)->toBe(CrewStatus::Active)->and(Decision::query()->count())->toBe(0);
});

// ---- moderation case page ---------------------------------------------------------------------------------------------------------

it('shows the crew preview on its moderation case', function () {
    $crew = adm80Crew(['name' => 'Fallstudie Crew', 'description' => 'Wir fahren nachts.']);
    $case = adm80Case($crew);
    adm80As();

    $this->get("/admin/moderation/cases/{$case->id}")->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
        ->where('preview.kind', 'crew')->where('preview.id', $crew->id)->where('preview.name', 'Fallstudie Crew')
        ->where('preview.join_mode', 'open')->where('preview.status', 'active')->where('preview.deleted', false)->etc());
});
