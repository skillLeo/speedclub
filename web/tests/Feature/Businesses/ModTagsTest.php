<?php

use App\Enums\BusinessStatus;
use App\Enums\ModTagStatus;
use App\Enums\NotificationType;
use App\Enums\Visibility;
use App\Models\BusinessMember;
use App\Models\ModBusinessTag;
use App\Models\Notification;
use App\Models\User;
use App\Models\Vehicle;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/BusinessTestHelpers.php';

/**
 * M4.14 "Eingebaut von" with double confirmation (09 §8.10, ADR-414): either side asks, the other confirms; only an accepted tag sets
 * the mod's installed_by and the portfolio; either side removes it; the authorisation matrix of every tag route.
 */
beforeEach(function () {
    bizFlags();
    $this->bizOwner = User::factory()->create(['username' => 'jana.werkstatt']);
    $this->business = bizBusiness($this->bizOwner, ['slug' => 'fahrwerkstatt-elbe']);
    $this->member = User::factory()->create(['username' => 'paul.e30']);
    $this->mod = bizBuildWithMod($this->member);
});

it('member asks, business accepts: the build joins the portfolio and the mod reads "Eingebaut von"', function () {
    Sanctum::actingAs($this->member);
    $tag = $this->putJson("/api/v1/mods/{$this->mod->id}/business-tag", ['business' => 'fahrwerkstatt-elbe'])->assertSuccessful()
        ->assertJsonPath('data.status', 'pending')->assertJsonPath('data.initiated_by', 'member')->json('data.id');

    // Pending: nothing public yet.
    $this->getJson("/api/v1/mods/{$this->mod->id}")->assertJsonPath('data.installed_by', null)->assertJsonPath('data.business_tag.status', 'pending');
    $this->getJson('/api/v1/businesses/fahrwerkstatt-elbe/portfolio')->assertJsonCount(0, 'data');
    expect(Notification::query()->where('notifiable_id', $this->bizOwner->id)->where('type', NotificationType::BusinessTag->value)->exists())->toBeTrue();

    Sanctum::actingAs($this->bizOwner);
    $this->getJson('/api/v1/me/business/tag-requests')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.owner_username', 'paul.e30');
    $this->getJson('/api/v1/me/business')->assertJsonPath('data.pending_requests', 1);
    $this->patchJson("/api/v1/me/business/tag-requests/$tag", ['decision' => 'accepted'])->assertOk()->assertJsonPath('data.status', 'accepted');
    $this->patchJson("/api/v1/me/business/tag-requests/$tag", ['decision' => 'declined'])->assertConflict();

    Sanctum::actingAs(User::factory()->create());
    $this->getJson("/api/v1/mods/{$this->mod->id}")->assertOk()->assertJsonPath('data.installed_by.slug', 'fahrwerkstatt-elbe')->assertJsonPath('data.business_tag', null);
    app('auth')->forgetGuards();
    $this->getJson('/api/v1/businesses/fahrwerkstatt-elbe/portfolio')->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $this->mod->vehicle_id);
    $this->getJson('/api/v1/businesses/fahrwerkstatt-elbe')->assertJsonPath('data.portfolio_count', 1);
    expect(Notification::query()->where('notifiable_id', $this->member->id)->where('type', NotificationType::BusinessTag->value)->value('data'))->toMatchArray(['state' => 'accepted']);
});

it('business proposes, member confirms by the proposal or by naming the same business', function (string $how) {
    Sanctum::actingAs($this->bizOwner);
    $tag = $this->postJson('/api/v1/me/business/tag-requests', ['mod_id' => $this->mod->id])->assertCreated()->assertJsonPath('data.initiated_by', 'business')->json('data.id');
    $this->getJson('/api/v1/me/business/tag-requests?direction=outgoing')->assertJsonCount(1, 'data');
    // The business cannot confirm its own proposal.
    $this->patchJson("/api/v1/me/business/tag-requests/$tag", ['decision' => 'accepted'])->assertForbidden();

    Sanctum::actingAs($this->member);
    $this->getJson('/api/v1/me/mod-tags')->assertOk()->assertJsonCount(1, 'data');
    $how === 'decide'
        ? $this->patchJson("/api/v1/me/mod-tags/$tag", ['decision' => 'accepted'])->assertOk()->assertJsonPath('data.status', 'accepted')
        : $this->putJson("/api/v1/mods/{$this->mod->id}/business-tag", ['business' => 'fahrwerkstatt-elbe'])->assertSuccessful()->assertJsonPath('data.status', 'accepted');

    expect($this->mod->refresh()->installed_by_business_id)->toBe($this->business->id);
})->with(['decide' => ['decide'], 'tag the same business' => ['put']]);

it('either side removes a confirmed tag; a decline never shows', function (string $side) {
    $tag = ModBusinessTag::factory()->create(['mod_id' => $this->mod->id, 'business_id' => $this->business->id, 'status' => ModTagStatus::Accepted, 'requested_by' => $this->member->id]);
    $this->mod->forceFill(['installed_by_business_id' => $this->business->id])->saveQuietly();

    if ($side === 'member') {
        Sanctum::actingAs($this->member);
        $this->deleteJson("/api/v1/mods/{$this->mod->id}/business-tag")->assertNoContent();
    } else {
        Sanctum::actingAs($this->bizOwner);
        $this->deleteJson("/api/v1/me/business/tag-requests/{$tag->id}")->assertNoContent();
    }

    expect(ModBusinessTag::query()->find($tag->id))->toBeNull()->and($this->mod->refresh()->installed_by_business_id)->toBeNull();
})->with(['member' => ['member'], 'business' => ['business']]);

it('declines without a trace on the public mod', function () {
    Sanctum::actingAs($this->member);
    $tag = $this->putJson("/api/v1/mods/{$this->mod->id}/business-tag", ['business' => 'fahrwerkstatt-elbe'])->json('data.id');
    Sanctum::actingAs($this->bizOwner);
    $this->patchJson("/api/v1/me/business/tag-requests/$tag", ['decision' => 'declined'])->assertOk()->assertJsonPath('data.status', 'declined');

    Sanctum::actingAs(User::factory()->create());
    $this->getJson("/api/v1/mods/{$this->mod->id}")->assertOk()->assertJsonPath('data.installed_by', null)->assertJsonPath('data.business_tag', null);
    Sanctum::actingAs($this->member);
    $this->getJson("/api/v1/mods/{$this->mod->id}")->assertOk()->assertJsonPath('data.business_tag.status', 'declined');
});

it('guards the tag routes: guest, other member, blocked, restricted, unverified business', function () {
    $this->putJson("/api/v1/mods/{$this->mod->id}/business-tag", ['business' => 'fahrwerkstatt-elbe'])->assertUnauthorized();
    $this->getJson('/api/v1/me/mod-tags')->assertUnauthorized();
    $this->postJson('/api/v1/me/business/tag-requests', ['mod_id' => $this->mod->id])->assertUnauthorized();

    // Another member cannot tag somebody else's mod.
    Sanctum::actingAs(User::factory()->create());
    $this->putJson("/api/v1/mods/{$this->mod->id}/business-tag", ['business' => 'fahrwerkstatt-elbe'])->assertForbidden();
    $this->getJson('/api/v1/me/business/tag-requests')->assertNotFound()->assertJsonPath('code', 'business_unavailable');

    // Restricted from publishing.
    $this->member->forceFill(['restrictions' => ['publishing' => ['until' => null]]])->save();
    Sanctum::actingAs($this->member->refresh());
    $this->putJson("/api/v1/mods/{$this->mod->id}/business-tag", ['business' => 'fahrwerkstatt-elbe'])->assertForbidden()->assertJsonPath('code', 'account_restricted');
    $this->member->forceFill(['restrictions' => null])->save();

    // A block with the business owner: the business is not there for the member, the build not for the business.
    socBlock($this->member, $this->bizOwner);
    Sanctum::actingAs($this->member->refresh());
    $this->putJson("/api/v1/mods/{$this->mod->id}/business-tag", ['business' => 'fahrwerkstatt-elbe'])->assertNotFound()->assertJsonPath('code', 'business_unavailable');
    Sanctum::actingAs($this->bizOwner);
    $this->postJson('/api/v1/me/business/tag-requests', ['mod_id' => $this->mod->id])->assertUnprocessable()->assertJsonValidationErrors('mod_id');
});

it('needs a verified business on both ends and a public build for proposals', function () {
    $this->business->forceFill(['status' => BusinessStatus::Suspended])->save();
    Sanctum::actingAs($this->bizOwner);
    $this->postJson('/api/v1/me/business/tag-requests', ['mod_id' => $this->mod->id])->assertConflict()->assertJsonPath('code', 'business_not_verified');

    $this->business->forceFill(['status' => BusinessStatus::Verified])->save();
    Vehicle::query()->whereKey($this->mod->vehicle_id)->update(['visibility' => Visibility::Unlisted->value]);
    $this->postJson('/api/v1/me/business/tag-requests', ['mod_id' => $this->mod->id])->assertUnprocessable()->assertJsonValidationErrors('mod_id');
});

it('confirms at once when a team member tags their own build', function () {
    $mechanic = User::factory()->create();
    BusinessMember::factory()->create(['business_id' => $this->business->id, 'user_id' => $mechanic->id]);
    $own = bizBuildWithMod($mechanic);
    Sanctum::actingAs($mechanic);

    $this->putJson("/api/v1/mods/{$own->id}/business-tag", ['business' => 'fahrwerkstatt-elbe'])->assertSuccessful()->assertJsonPath('data.status', 'accepted');
});

it('rate limits tag requests', function () {
    socLimit('business_tags');
    Sanctum::actingAs($this->member);

    $this->putJson("/api/v1/mods/{$this->mod->id}/business-tag", ['business' => 'fahrwerkstatt-elbe'])->assertSuccessful();
    $this->putJson("/api/v1/mods/{$this->mod->id}/business-tag", ['business' => 'fahrwerkstatt-elbe'])->assertTooManyRequests();
});
