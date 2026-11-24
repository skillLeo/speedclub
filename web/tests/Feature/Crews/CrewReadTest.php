<?php

use App\Enums\CrewJoinMode;
use App\Enums\CrewRole;
use App\Enums\CrewStatus;
use App\Enums\Visibility;
use App\Models\Crew;
use App\Models\CrewRequest;
use App\Models\Staff;
use App\Models\User;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/CrewTestHelpers.php';

/**
 * R4-2.3 Crews, reads (contract-crews.md §3 #1–7): CREW-00 list (search, Bundesland, A–Z / newest, never by size), CREW-01 page and
 * members with their public builds, a member's crews, "Meine Crews" and the reader's open requests and invitations.
 */
beforeEach(function () {
    crewFlags();
});

it('answers 404 feature_disabled on every route while the flag is off', function () {
    crewFlags(['crews' => false]);
    $crew = crewMake();

    $this->getJson('/api/v1/crews')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    $this->getJson("/api/v1/crews/{$crew->slug}")->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    $this->postJson('/api/v1/crews', ['name' => 'Nordlicht', 'join_mode' => 'open'])->assertUnauthorized();
    Sanctum::actingAs(User::factory()->create());
    $this->postJson('/api/v1/crews', ['name' => 'Nordlicht', 'join_mode' => 'open'])->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    $this->getJson('/api/v1/me/crews')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
});

it('lists active crews A–Z or newest, searches by name and filters by Bundesland, never by size', function () {
    $small = crewMake(null, ['name' => 'Alpha Schrauber', 'name_key' => 'alpha schrauber', 'bundesland' => 'BY', 'created_at' => now()->subDays(3)]);
    $big = crewMake(null, ['name' => 'Zeta Stance', 'name_key' => 'zeta stance', 'bundesland' => 'HH', 'created_at' => now()->subDay()]);
    foreach (range(1, 3) as $i) {
        crewAdd($big, User::factory()->create());
    }
    $hidden = crewMake(null, ['name' => 'Mitte Hidden', 'name_key' => 'mitte hidden', 'status' => CrewStatus::Hidden]);

    $this->getJson('/api/v1/crews')->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.name', 'Alpha Schrauber')->assertJsonPath('data.1.name', 'Zeta Stance')
        ->assertJsonPath('data.1.member_count', 4)->assertJsonPath('data.0.viewer', null)
        ->assertJsonPath('data.0.share_path', '/crews/'.$small->slug)->assertJsonPath('data.0.bundesland_label', 'Bavaria');
    $this->getJson('/api/v1/crews', ['Accept-Language' => 'de'])->assertOk()->assertJsonPath('data.0.bundesland_label', 'Bayern');

    $this->getJson('/api/v1/crews?sort=newest')->assertOk()->assertJsonPath('data.0.id', $big->id)->assertJsonPath('data.1.id', $small->id);
    $this->getJson('/api/v1/crews?q=stance')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $big->id);
    $this->getJson('/api/v1/crews?bundesland=BY')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $small->id);
    // C2: there is no size sort to ask for.
    $this->getJson('/api/v1/crews?sort=members')->assertUnprocessable()->assertJsonValidationErrors('sort');
    $this->getJson('/api/v1/crews?bundesland=XX')->assertUnprocessable()->assertJsonValidationErrors('bundesland');
    $this->getJson('/api/v1/crews?cursor=forged')->assertUnprocessable()->assertJsonValidationErrors('cursor');
    expect($hidden->exists)->toBeTrue();
});

it('pages with a cursor and puts real crews before samples, hiding samples while they are off', function () {
    crewMake(null, ['name' => 'Aaa Beispiel', 'name_key' => 'aaa beispiel', 'is_sample' => true]);
    crewMake(null, ['name' => 'Bbb Echt', 'name_key' => 'bbb echt']);
    crewMake(null, ['name' => 'Ccc Echt', 'name_key' => 'ccc echt']);

    $first = $this->getJson('/api/v1/crews?per_page=2')->assertOk()->assertJsonPath('data.0.name', 'Bbb Echt')->assertJsonPath('data.1.name', 'Ccc Echt');
    $this->getJson('/api/v1/crews?per_page=2&cursor='.$first->json('meta.next_cursor'))->assertOk()
        ->assertJsonPath('data.0.name', 'Aaa Beispiel')->assertJsonPath('data.0.is_sample', true);

    crewFlags(['editorial_samples' => false]);
    $this->getJson('/api/v1/crews')->assertOk()->assertJsonCount(2, 'data');
});

it('shows a crew page to guests and members with the reader state; an old slug still finds it', function () {
    $founder = User::factory()->create(['username' => 'lena.gruender']);
    $crew = crewMake($founder, ['name' => 'Nordlicht Crew', 'name_key' => 'nordlicht crew', 'slug' => 'nordlicht-crew', 'previous_slug' => 'nordlicht'], CrewJoinMode::Request);

    $this->getJson('/api/v1/crews/nordlicht-crew')->assertOk()
        ->assertJsonPath('data.name', 'Nordlicht Crew')->assertJsonPath('data.status', 'active')->assertJsonPath('data.join_mode', 'request')
        ->assertJsonPath('data.founder.username', 'lena.gruender')->assertJsonPath('data.viewer', null)
        ->assertJsonPath('data.pending_requests_count', null);
    $this->getJson('/api/v1/crews/nordlicht')->assertOk()->assertJsonPath('data.slug', 'nordlicht-crew');
    $this->getJson('/api/v1/crews/gibt-es-nicht')->assertNotFound()->assertJsonPath('code', 'crew_unavailable');

    Sanctum::actingAs(User::factory()->create());
    $this->getJson('/api/v1/crews/nordlicht-crew')->assertOk()
        ->assertJsonPath('data.viewer.role', null)->assertJsonPath('data.viewer.state', 'none')
        ->assertJsonPath('data.viewer.can.request', true)->assertJsonPath('data.viewer.can.join', false)->assertJsonPath('data.viewer.can.edit', false);

    Sanctum::actingAs($founder);
    $this->getJson('/api/v1/crews/nordlicht-crew')->assertOk()
        ->assertJsonPath('data.viewer.role', 'founder')->assertJsonPath('data.viewer.can.edit', true)->assertJsonPath('data.viewer.can.delete', true)
        ->assertJsonPath('data.viewer.can.leave', false)->assertJsonPath('data.pending_requests_count', 0)->assertJsonPath('data.open_invites_count', 0);
});

it('shows a hidden crew only to its members, a deleted one to nobody', function () {
    $founder = User::factory()->create();
    $member = User::factory()->create();
    $crew = crewMake($founder, ['status' => CrewStatus::Hidden]);
    crewAdd($crew, $member);

    $this->getJson("/api/v1/crews/{$crew->slug}")->assertNotFound()->assertJsonPath('code', 'crew_unavailable');
    Sanctum::actingAs(User::factory()->create());
    $this->getJson("/api/v1/crews/{$crew->slug}")->assertNotFound();
    Sanctum::actingAs($member);
    $this->getJson("/api/v1/crews/{$crew->slug}")->assertOk()->assertJsonPath('data.status', 'hidden')->assertJsonPath('data.viewer.can.leave', true);

    $crew->delete();
    $this->getJson("/api/v1/crews/{$crew->slug}")->assertNotFound()->assertJsonPath('code', 'crew_unavailable');
});

it('lists members founder first with their public builds, leaving out blocked and invisible accounts', function () {
    $founder = User::factory()->create(['username' => 'anna.founder']);
    $crew = crewMake($founder);
    $admin = User::factory()->create(['username' => 'ben.admin']);
    crewAdd($crew, $admin, CrewRole::Admin);
    $member = User::factory()->create(['username' => 'carl.member']);
    crewAdd($crew, $member);
    $suspended = User::factory()->suspended()->create();
    crewAdd($crew, $suspended);

    $public = publishedVehicle($member);
    publishedVehicle($member, ['visibility' => Visibility::Private]);
    publishedVehicle($member, ['ghost_mode' => true]);

    $this->getJson("/api/v1/crews/{$crew->slug}/members")->assertOk()
        ->assertJsonCount(3, 'data')
        ->assertJsonPath('data.0.member.username', 'anna.founder')->assertJsonPath('data.0.role', 'founder')
        ->assertJsonPath('data.1.member.username', 'ben.admin')->assertJsonPath('data.1.role', 'admin')
        ->assertJsonPath('data.2.member.username', 'carl.member')->assertJsonCount(1, 'data.2.vehicles')
        ->assertJsonPath('data.2.vehicles.0.id', $public->id);

    // C3: blocks hide members, not the crew.
    $reader = User::factory()->create();
    socBlock($admin, $reader);
    Sanctum::actingAs($reader);
    $this->getJson("/api/v1/crews/{$crew->slug}")->assertOk();
    $this->getJson("/api/v1/crews/{$crew->slug}/members")->assertOk()->assertJsonCount(2, 'data')
        ->assertJsonMissing(['username' => 'ben.admin']);

    $this->getJson("/api/v1/crews/{$crew->slug}/members?cursor=forged")->assertUnprocessable();
});

it('lists the crews of a member for the profile chips and 404s a member the reader cannot see', function () {
    $member = User::factory()->create(['username' => 'mia.chips']);
    $founded = crewMake($member, ['name' => 'Bbb Founded', 'name_key' => 'bbb founded']);
    $joined = crewMake(null, ['name' => 'Aaa Joined', 'name_key' => 'aaa joined']);
    crewAdd($joined, $member, CrewRole::Admin);
    $hidden = crewMake(null, ['status' => CrewStatus::Hidden]);
    crewAdd($hidden, $member);

    $this->getJson('/api/v1/public/users/mia.chips/crews')->assertOk()->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.id', $joined->id)->assertJsonPath('data.0.role', 'admin')
        ->assertJsonPath('data.1.id', $founded->id)->assertJsonPath('data.1.role', 'founder');

    $blocked = User::factory()->create();
    socBlock($member, $blocked);
    Sanctum::actingAs($blocked);
    $this->getJson('/api/v1/public/users/mia.chips/crews')->assertNotFound()->assertJsonPath('code', 'member_unavailable');
});

it('lists my crews with their status and the counts of the crews I run', function () {
    $me = User::factory()->create();
    $mine = crewMake($me, ['name' => 'Aaa Mine', 'name_key' => 'aaa mine'], CrewJoinMode::Request);
    $hidden = crewMake(null, ['name' => 'Bbb Hidden', 'name_key' => 'bbb hidden', 'status' => CrewStatus::Hidden]);
    crewAdd($hidden, $me);
    $other = crewMake();
    CrewRequest::factory()->create(['crew_id' => $mine->id]);

    $this->getJson('/api/v1/me/crews')->assertUnauthorized();
    Sanctum::actingAs($me);
    $this->getJson('/api/v1/me/crews')->assertOk()->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.id', $mine->id)->assertJsonPath('data.0.viewer.role', 'founder')->assertJsonPath('data.0.pending_requests_count', 1)
        ->assertJsonPath('data.1.id', $hidden->id)->assertJsonPath('data.1.status', 'hidden')->assertJsonPath('data.1.pending_requests_count', null);
    expect($other->exists)->toBeTrue();
});

it('never orders or filters any list by member_count', function () {
    $source = implode("\n", array_map(fn (string $file): string => (string) file_get_contents($file), [
        app_path('Services/Crews/CrewListing.php'),
        app_path('Http/Requests/Api/V1/Crews/CrewListRequest.php'),
    ]));

    expect($source)->not->toContain("orderBy('members_count")->not->toContain("orderByDesc('members_count")
        ->not->toContain("orderBy('crews.members_count")->not->toContain("orderByDesc('crews.members_count");
});

it('treats a staff session as a guest on member routes', function () {
    $this->actingAs(Staff::factory()->create(), 'staff');
    $this->getJson('/api/v1/me/crews')->assertUnauthorized();
    $this->postJson('/api/v1/crews', ['name' => 'Staff Crew', 'join_mode' => 'open'])->assertUnauthorized();
    expect(Crew::query()->count())->toBe(0);
});
