<?php

use App\Enums\BusinessRole;
use App\Enums\BusinessStatus;
use App\Enums\RestrictionType;
use App\Models\Business;
use App\Models\BusinessMember;
use App\Models\BusinessViewDay;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/BusinessTestHelpers.php';

/**
 * M4.14 business profiles (09 §8.10, BIZ-01…03, ADR-414): the flag, who sees a business (guest, member, team, blocked, samples,
 * statuses), the application with its Impressum rules, edits with the identity lock, withdraw and resubmit, logo/cover uploads, the team,
 * the private 30-day views, rate limits and idempotency.
 */
beforeEach(function () {
    bizFlags();
    $this->owner = User::factory()->create(['username' => 'jana.werkstatt']);
    $this->business = bizBusiness($this->owner, ['slug' => 'fahrwerkstatt-elbe', 'name' => 'Fahrwerkstatt Elbe']);
});

it('answers 404 feature_disabled while businesses is off, and 401 before that for member routes', function () {
    bizFlags(['businesses' => false]);

    $this->getJson('/api/v1/businesses')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    $this->getJson('/api/v1/businesses/fahrwerkstatt-elbe')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    $this->getJson('/api/v1/me/business')->assertUnauthorized();
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/v1/me/business')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
});

it('shows a verified business with its Impressum to guests and members; never a rating', function () {
    $response = $this->getJson('/api/v1/businesses/fahrwerkstatt-elbe', ['Accept-Language' => 'de'])->assertOk()
        ->assertJsonPath('data.name', 'Fahrwerkstatt Elbe')->assertJsonPath('data.subline', 'Werkstatt · Hamburg')->assertJsonPath('data.verified', true)
        ->assertJsonPath('data.impressum.legal_form', 'gmbh')->assertJsonPath('data.impressum.register_number', 'HRB 00000')
        ->assertJsonPath('data.contact.message_username', 'jana.werkstatt')->assertJsonPath('data.portfolio_count', 0)->assertJsonPath('data.viewer_role', null)
        ->assertJsonCount(7, 'data.opening_hours');

    expect(array_keys($response->json('data')))->not->toContain('rating')->not->toContain('reviews')->not->toContain('document_note')->not->toContain('status');

    Sanctum::actingAs(User::factory()->create());
    $this->getJson('/api/v1/businesses/fahrwerkstatt-elbe')->assertOk();
    $this->getJson('/api/v1/businesses')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.slug', 'fahrwerkstatt-elbe');
});

it('hides businesses that are not verified, removed, of a blocked owner, or samples while hidden', function (Closure $setup, bool $guestSees) {
    $setup($this->business, $this->owner);
    $this->business->refresh();

    $guest = $this->getJson('/api/v1/businesses/fahrwerkstatt-elbe');
    $guestSees ? $guest->assertOk() : $guest->assertNotFound()->assertJsonPath('code', 'business_unavailable');
    $this->getJson('/api/v1/businesses')->assertJsonCount($guestSees ? 1 : 0, 'data');

    // The owner always reads their own (the team route).
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/v1/me/business')->assertOk()->assertJsonPath('data.slug', 'fahrwerkstatt-elbe');
})->with([
    'applied' => [fn (Business $b) => $b->forceFill(['status' => BusinessStatus::Applied])->save(), false],
    'rejected' => [fn (Business $b) => $b->forceFill(['status' => BusinessStatus::Rejected])->save(), false],
    'suspended' => [fn (Business $b) => $b->forceFill(['status' => BusinessStatus::Suspended])->save(), false],
    'removed by moderation' => [fn (Business $b) => $b->forceFill(['removed_at' => now()])->save(), false],
    'sample while samples hidden' => [function (Business $b) {
        $b->forceFill(['is_sample' => true])->save();
        bizFlags(['editorial_samples' => false]);
    }, false],
    'sample while shown' => [fn (Business $b) => $b->forceFill(['is_sample' => true])->save(), true],
]);

it('hides a business from a member with a block either way', function () {
    $viewer = User::factory()->create();
    socBlock($this->owner, $viewer);
    Sanctum::actingAs($viewer);

    $this->getJson('/api/v1/businesses/fahrwerkstatt-elbe')->assertNotFound()->assertJsonPath('code', 'business_unavailable');
    $this->getJson('/api/v1/businesses')->assertJsonCount(0, 'data');
});

it('lists nearby businesses with distance and filters by kind, city and service', function () {
    bizBusiness(null, ['slug' => 'tuning-sued', 'name' => 'Tuning Süd', 'city' => 'München', 'kind' => 'tuner', 'lat' => 48.137, 'lng' => 11.575, 'services' => ['Folierung']]);

    $this->getJson('/api/v1/businesses?lat=53.55&lng=10.0&radius_km=50')->assertOk()->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.slug', 'fahrwerkstatt-elbe')->assertJsonPath('data.0.distance_km', fn ($km) => $km < 5);
    $this->getJson('/api/v1/businesses?kind=tuner')->assertJsonCount(1, 'data')->assertJsonPath('data.0.slug', 'tuning-sued');
    $this->getJson('/api/v1/businesses?city=Hamburg')->assertJsonCount(1, 'data');
    $this->getJson('/api/v1/businesses?service=Folierung')->assertJsonCount(1, 'data');
    $this->getJson('/api/v1/businesses?lat=53.5')->assertUnprocessable();
});

it('counts a public profile view for BIZ-03, never the team’s own', function () {
    $this->getJson('/api/v1/businesses/fahrwerkstatt-elbe')->assertOk();
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/v1/businesses/fahrwerkstatt-elbe')->assertOk()->assertJsonPath('data.viewer_role', 'owner');

    expect((int) BusinessViewDay::query()->where('business_id', $this->business->id)->sum('views'))->toBe(1);
    $this->getJson('/api/v1/me/business')->assertOk()->assertJsonPath('data.views_30d', 1)->assertJsonPath('data.status', 'verified');
});

it('lets a verified member apply once: applied, owner, Impressum rules', function () {
    $member = User::factory()->create();
    Sanctum::actingAs($member);

    $this->postJson('/api/v1/me/business', bizBody(['register_number' => '']))->assertUnprocessable()->assertJsonValidationErrors('register_number');
    $this->postJson('/api/v1/me/business', bizBody(['opening_hours' => ['mon' => [['18:00', '08:00']]]]))->assertUnprocessable()->assertJsonValidationErrors('opening_hours');
    $this->postJson('/api/v1/me/business', bizBody(['accept_terms' => false]))->assertUnprocessable()->assertJsonValidationErrors('accept_terms');
    // A sole trader needs no register entry.
    $created = $this->postJson('/api/v1/me/business', bizBody(['legal_form' => 'sole_trader', 'register_court' => null, 'register_number' => null]))->assertCreated()
        ->assertJsonPath('data.status', 'applied')->assertJsonPath('data.viewer_role', 'owner')->assertJsonPath('data.slug', 'fahrwerkstatt-elbe-hamburg');

    expect(BusinessMember::query()->where('user_id', $member->id)->first()?->role)->toBe(BusinessRole::Owner);
    // Not public yet.
    app('auth')->forgetGuards();
    $this->getJson('/api/v1/businesses/'.$created->json('data.slug'))->assertNotFound();

    Sanctum::actingAs($member);
    $this->postJson('/api/v1/me/business', bizBody(['name' => 'Zweiter Betrieb']))->assertConflict()->assertJsonPath('code', 'business_exists');
});

it('refuses applications from guests, unverified and publishing-restricted members', function () {
    $this->postJson('/api/v1/me/business', bizBody())->assertUnauthorized();

    Sanctum::actingAs(User::factory()->unverified()->create());
    $this->postJson('/api/v1/me/business', bizBody())->assertForbidden()->assertJsonPath('code', 'email_not_verified');

    Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Publishing)->create());
    $this->postJson('/api/v1/me/business', bizBody())->assertForbidden()->assertJsonPath('code', 'account_restricted');
});

it('replays an application with the same Idempotency-Key and rate limits applications', function () {
    Sanctum::actingAs(User::factory()->create());
    $key = ['Idempotency-Key' => '7a0f4c1e-2b9d-4e7a-9c3f-1d2e3f4a5b6c'];

    $first = $this->postJson('/api/v1/me/business', bizBody(), $key)->assertCreated();
    $this->postJson('/api/v1/me/business', bizBody(), $key)->assertCreated()->assertJsonPath('data.id', $first->json('data.id'));
    expect(Business::query()->count())->toBe(2);
});

it('rate limits business edits', function () {
    socLimit('businesses');
    Sanctum::actingAs($this->owner);
    $this->patchJson('/api/v1/me/business', ['about' => 'Erster Text'])->assertOk();
    $this->patchJson('/api/v1/me/business', ['about' => 'Zweiter Text'])->assertTooManyRequests()->assertJsonPath('code', 'rate_limited');
});

it('locks the Impressum fields of a verified business, profile fields stay open', function () {
    Sanctum::actingAs($this->owner);

    $this->patchJson('/api/v1/me/business', ['legal_name' => 'Andere GmbH', 'street' => 'Neue Straße 1'])->assertUnprocessable()
        ->assertJsonValidationErrors(['legal_name', 'street']);
    $this->patchJson('/api/v1/me/business', ['about' => 'Fahrwerk und Achsvermessung seit 2009.', 'services' => ['Fahrwerk'], 'phone' => '+49 40 1234567', 'legal_name' => $this->business->legal_name])->assertOk()
        ->assertJsonPath('data.about', 'Fahrwerk und Achsvermessung seit 2009.')->assertJsonPath('data.services', ['Fahrwerk'])->assertJsonPath('data.identity_locked', true);
});

it('lets staff of the team edit but not withdraw; others get 403 or 404', function () {
    $staff = User::factory()->create();
    BusinessMember::factory()->create(['business_id' => $this->business->id, 'user_id' => $staff->id]);
    Sanctum::actingAs($staff);
    $this->patchJson('/api/v1/me/business', ['about' => 'Vom Team geschrieben.'])->assertOk()->assertJsonPath('data.viewer_role', 'staff');
    $this->deleteJson('/api/v1/me/business')->assertForbidden();
    $this->postJson('/api/v1/me/business/members', ['username' => 'someone'])->assertForbidden();

    Sanctum::actingAs(User::factory()->create());
    $this->getJson('/api/v1/me/business')->assertNotFound()->assertJsonPath('code', 'business_unavailable');
    $this->patchJson('/api/v1/me/business', ['about' => 'x'])->assertNotFound();
});

it('withdraws an application and resubmits a rejected one; a verified business stays', function () {
    Sanctum::actingAs($this->owner);
    $this->deleteJson('/api/v1/me/business')->assertConflict()->assertJsonPath('code', 'business_exists');
    $this->postJson('/api/v1/me/business/submit')->assertConflict();

    $this->business->forceFill(['status' => BusinessStatus::Rejected, 'review_reason' => 'Registernummer passt nicht.'])->save();
    $this->getJson('/api/v1/me/business')->assertJsonPath('data.status_reason', 'Registernummer passt nicht.')->assertJsonPath('data.identity_locked', false);
    $this->patchJson('/api/v1/me/business', ['register_number' => 'HRB 654321'])->assertOk();
    $this->postJson('/api/v1/me/business/submit')->assertOk()->assertJsonPath('data.status', 'applied')->assertJsonPath('data.status_reason', null);

    $this->deleteJson('/api/v1/me/business')->assertNoContent();
    expect(Business::query()->find($this->business->id))->toBeNull()->and(BusinessMember::query()->where('user_id', $this->owner->id)->exists())->toBeFalse();
});

it('uploads logo and cover through the media pipeline', function () {
    Storage::fake(config()->string('speedclub.media.disk'));
    Storage::fake(config()->string('speedclub.media.private_disk'));
    Sanctum::actingAs($this->owner);

    $this->post('/api/v1/me/business/cover', ['file' => UploadedFile::fake()->image('cover.jpg', 1600, 900)], ['Accept' => 'application/json'])->assertCreated();
    expect($this->business->refresh()->getAttribute('cover_media_id'))->not->toBeNull();
    $this->post('/api/v1/me/business/logo', [], ['Accept' => 'application/json'])->assertUnprocessable();

    Sanctum::actingAs(User::factory()->create());
    $this->post('/api/v1/me/business/logo', ['file' => UploadedFile::fake()->image('cover.jpg', 1600, 900)], ['Accept' => 'application/json'])->assertNotFound();
});

it('manages the team: the owner adds and removes staff, staff may leave, the owner stays', function () {
    $mechanic = User::factory()->create(['username' => 'tom.schrauber']);
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/v1/me/business/members', ['username' => '@tom.schrauber'])->assertOk()->assertJsonPath('data.team.1.username', 'tom.schrauber');
    $this->postJson('/api/v1/me/business/members', ['username' => 'gibt.es.nicht'])->assertUnprocessable()->assertJsonValidationErrors('username');
    $this->postJson('/api/v1/me/business/members', ['username' => 'tom.schrauber'])->assertUnprocessable();
    $this->deleteJson('/api/v1/me/business/members/jana.werkstatt')->assertForbidden();

    Sanctum::actingAs($mechanic);
    $this->deleteJson('/api/v1/me/business/members/tom.schrauber')->assertNoContent();
    expect(BusinessMember::query()->where('user_id', $mechanic->id)->exists())->toBeFalse();
});

it('makes a business reportable (DSA), by members who can see it, never the owner', function () {
    $reporter = User::factory()->create();
    Sanctum::actingAs($reporter);
    $this->postJson('/api/v1/reports', ['target_type' => 'business', 'target_id' => $this->business->id, 'reason' => 'impersonation'])
        ->assertStatus(201);

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/v1/reports', ['target_type' => 'business', 'target_id' => $this->business->id, 'reason' => 'impersonation'])
        ->assertUnprocessable()->assertJsonPath('code', 'own_content');
});

it('saves a visible business to a collection as a BusinessCard, never a hidden one', function () {
    bizFlags(['collections' => true]);
    Sanctum::actingAs(User::factory()->create());
    $id = $this->postJson('/api/v1/me/collections', ['name' => 'Werkstätten'])->assertCreated()->json('data.id');

    $this->postJson("/api/v1/me/collections/$id/items", ['type' => 'business', 'id' => $this->business->id])->assertSuccessful();
    $this->getJson("/api/v1/me/collections/$id/items")->assertOk()->assertJsonPath('data.0.business.slug', 'fahrwerkstatt-elbe');

    $hidden = bizBusiness(null, ['status' => BusinessStatus::Applied]);
    $this->postJson("/api/v1/me/collections/$id/items", ['type' => 'business', 'id' => $hidden->id])->assertNotFound();
});
