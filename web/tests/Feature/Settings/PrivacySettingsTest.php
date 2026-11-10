<?php

use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\Follow;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\PublicPages\SitemapWriter;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SettingsTestHelpers.php';
require_once __DIR__.'/../Messaging/MessagingTestHelpers.php';

beforeEach(function () {
    $this->withHeader('Accept-Language', 'de');
});

it('exposes and stores the privacy fields, with the defaults of 08 §1', function () {
    $member = setMember();
    Sanctum::actingAs($member);

    $this->getJson('/api/v1/me/settings')->assertOk()
        ->assertJsonPath('data.who_can_message', 'everyone')
        ->assertJsonPath('data.discoverable', true)
        ->assertJsonPath('data.indexable', true)
        ->assertJsonPath('data.read_receipts', true);

    $this->patchJson('/api/v1/me/settings', ['who_can_message' => 'following', 'discoverable' => false, 'indexable' => false, 'read_receipts' => false])
        ->assertOk()
        ->assertJsonPath('data.who_can_message', 'following')
        ->assertJsonPath('data.discoverable', false)
        ->assertJsonPath('data.indexable', false)
        ->assertJsonPath('data.read_receipts', false);
});

it('refuses wrong values', function (array $body) {
    Sanctum::actingAs(setMember());

    $this->patchJson('/api/v1/me/settings', $body)->assertUnprocessable();
})->with([
    'unknown audience' => [['who_can_message' => 'friends']],
    'string boolean' => [['discoverable' => 'false']],
    'number boolean' => [['indexable' => 0]],
    'null' => [['read_receipts' => null]],
]);

it('who_can_message decides who may start a conversation', function () {
    $member = setMember(['username' => 'lena.911']);
    $follower = setMember();
    $stranger = setMember();
    Follow::factory()->create(['follower_id' => $member->id, 'followee_id' => $follower->id]);

    $canMessage = function (User $viewer): bool {
        Sanctum::actingAs($viewer);

        return (bool) $this->getJson('/api/v1/public/users/lena.911')->assertOk()->json('data.can_message');
    };

    expect($canMessage($stranger))->toBeTrue();

    Sanctum::actingAs($member);
    $this->patchJson('/api/v1/me/settings', ['who_can_message' => 'following'])->assertOk();
    expect($canMessage($stranger))->toBeFalse()->and($canMessage($follower))->toBeTrue();

    Sanctum::actingAs($member);
    $this->patchJson('/api/v1/me/settings', ['who_can_message' => 'nobody'])->assertOk();
    expect($canMessage($follower))->toBeFalse();
});

it('discoverable decides whether member search finds the member', function () {
    $member = setMember(['username' => 'kenji.r34', 'display_name' => 'Kenji']);
    $found = fn (): array => collect($this->getJson('/api/v1/search/users?q=kenji')->assertOk()->json('data'))->pluck('username')->all();

    expect($found())->toContain('kenji.r34');

    Sanctum::actingAs($member);
    $this->patchJson('/api/v1/me/settings', ['discoverable' => false])->assertOk();
    app('auth')->forgetGuards();

    expect($found())->not->toContain('kenji.r34');
});

it('indexable marks /u and /v noindex and drops the pages from the sitemap at once (SEC-P1-14)', function () {
    config(['speedclub.public_pages.allow_indexing' => true, 'speedclub.public_pages.redirect_members_to_app' => false]);
    Storage::fake('local');

    $member = setMember(['username' => 'jann.ptrs']);
    $vehicle = Vehicle::factory()->published()->create(['owner_id' => $member->id]);

    $sitemap = app(SitemapWriter::class)->read();
    expect($sitemap)->toContain('/u/jann.ptrs')->toContain('/v/'.$vehicle->canonicalSlug());
    $this->get('/u/jann.ptrs')->assertOk()->assertDontSee('name="robots" content="noindex"', false);

    Sanctum::actingAs($member);
    $this->patchJson('/api/v1/me/settings', ['indexable' => false])->assertOk();
    app('auth')->forgetGuards();

    expect(Storage::disk('local')->exists(config('speedclub.public_pages.sitemap_path')))->toBeFalse();
    $fresh = app(SitemapWriter::class)->read();
    expect($fresh)->not->toContain('/u/jann.ptrs')->not->toContain('/v/'.$vehicle->canonicalSlug());

    $this->get('/u/jann.ptrs')->assertOk()->assertSee('name="robots" content="noindex"', false);
    $this->get('/v/'.$vehicle->canonicalSlug())->assertOk()->assertSee('name="robots" content="noindex"', false);
});

it('read_receipts off hides the read mark from the other side (through PATCH me/settings)', function () {
    msgFlags();
    $writer = setMember();
    $reader = setMember();
    $first = msgStart($writer, $reader, 'Moin, wie fährt sich der Umbau?');

    msgActAs($reader);
    $this->postJson("/api/v1/conversations/{$first->conversation_id}/read", ['message_id' => $first->id])->assertNoContent();

    msgActAs($writer);
    $this->getJson("/api/v1/conversations/{$first->conversation_id}")->assertJsonPath('data.other_read_message_id', $first->id);

    msgActAs($reader);
    $this->patchJson('/api/v1/me/settings', ['read_receipts' => false])->assertOk();

    msgActAs($writer);
    $this->getJson("/api/v1/conversations/{$first->conversation_id}")->assertJsonPath('data.other_read_message_id', null);
});

it('keeps the earlier settings fields working', function () {
    $member = setMember();
    Sanctum::actingAs($member);

    $this->patchJson('/api/v1/me/settings', ['theme' => 'black', 'locale' => 'en', 'power_display' => 'kw_ps', 'show_owner_on_qr' => false])->assertOk()
        ->assertJsonPath('data.theme', 'black')
        ->assertJsonPath('data.locale', 'en')
        ->assertJsonPath('data.show_owner_on_qr', false);

    expect(Vehicle::query()->where('status', VehicleStatus::Published)->where('visibility', Visibility::Public)->count())->toBe(0);
});
