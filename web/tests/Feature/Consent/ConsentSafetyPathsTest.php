<?php

use App\Enums\LegalDocumentKey;
use App\Enums\Visibility;
use App\Enums\WhoCanMessage;
use App\Http\Middleware\EnsureCurrentConsent;
use App\Models\Block;
use App\Models\LegalDocument;
use App\Models\Media;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Routing\Route as LaravelRoute;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Messaging/MessagingTestHelpers.php';

/**
 * ADR-248 amended (code review phase-3-final SF-1): safety and rights paths never wait for an AGB acceptance. While a re-consent is
 * outstanding a member may still block and unblock, delete their own content, narrow their privacy, withdraw the AI opt-in, make a
 * vehicle private and authorise their realtime channel. Anything that widens or changes more than that keeps answering 403
 * `consent_required`.
 */
beforeEach(function () {
    $this->withHeader('Accept-Language', 'de');
    $this->withoutDefer();
    Storage::fake('public');
    Storage::fake('local');

    foreach ([LegalDocumentKey::Terms, LegalDocumentKey::Privacy] as $key) {
        LegalDocument::factory()->create(['key' => $key, 'locale' => 'de', 'version' => '1', 'published_at' => now()->subMonth()]);
    }

    LegalDocument::factory()->create([
        'key' => LegalDocumentKey::Terms, 'locale' => 'de', 'version' => '2', 'requires_reconsent' => true,
        'summary' => 'Neue Regeln zu Fotos.', 'published_at' => now()->subMinute(),
    ]);

    $this->member = User::factory()->create([
        'username' => 'jonas.e30', 'terms_version' => '1', 'privacy_version' => '1', 'consented_at' => now()->subMonth(), 'locale' => 'de',
        'who_can_message' => WhoCanMessage::Following, 'discoverable' => true, 'indexable' => true, 'show_owner_on_qr' => true,
        'read_receipts' => true, 'ai_suggestions' => true,
    ]);
});

function cspAct(User $member): void
{
    app('auth')->forgetGuards();
    Sanctum::actingAs($member->fresh());
}

it('lets an outstanding member block and unblock another member', function () {
    $pushy = User::factory()->create(['username' => 'pushy.tuner']);
    cspAct($this->member);

    $this->postJson('/api/v1/users/pushy.tuner/block')->assertOk();
    expect(Block::query()->where('blocker_id', $this->member->id)->where('blocked_id', $pushy->id)->exists())->toBeTrue();

    $this->deleteJson('/api/v1/users/pushy.tuner/block')->assertSuccessful();
    expect(Block::query()->where('blocker_id', $this->member->id)->exists())->toBeFalse();
});

it('lets an outstanding member delete their own vehicle, photo and mod', function () {
    $vehicle = Vehicle::factory()->create(['owner_id' => $this->member->id]);
    $other = Vehicle::factory()->create(['owner_id' => $this->member->id]);
    $media = Media::factory()->forModel($other)->create(['owner_id' => $this->member->id, 'sort' => 0]);
    $mod = Modification::factory()->create(['vehicle_id' => $other->id]);
    cspAct($this->member);

    $this->deleteJson("/api/v1/media/{$media->id}")->assertNoContent();
    $this->deleteJson("/api/v1/mods/{$mod->id}")->assertSuccessful();
    $this->deleteJson("/api/v1/vehicles/{$vehicle->id}")->assertNoContent();

    $this->assertSoftDeleted($media);
    expect(Modification::query()->whereKey($mod->id)->exists())->toBeFalse()
        ->and(Vehicle::query()->whereKey($vehicle->id)->exists())->toBeFalse();
});

it('lets an outstanding member delete their own message and a conversation', function () {
    msgFlags();
    $lukas = User::factory()->create(['username' => 'lukas.sc']);
    $first = msgStart($this->member, $lukas);
    $mine = msgSend($this->member, $first->conversation_id, 'Das nehme ich zurück.');
    cspAct($this->member);

    $this->deleteJson("/api/v1/messages/{$mine->id}")->assertNoContent();
    $ids = collect($this->getJson("/api/v1/conversations/{$first->conversation_id}/messages")->assertOk()->json('data'))->pluck('id');
    expect($ids)->not->toContain($mine->id)->and($ids)->toContain($first->id);

    $this->deleteJson("/api/v1/conversations/{$first->conversation_id}")->assertNoContent();
    expect(msgSide($first->conversation_id, $this->member)->deleted_at)->not->toBeNull();
});

it('still refuses other content writes of an outstanding member', function () {
    $vehicle = Vehicle::factory()->create(['owner_id' => $this->member->id]);
    cspAct($this->member);

    $this->patchJson("/api/v1/vehicles/{$vehicle->id}", ['nickname' => 'Neuer Name'])->assertForbidden()->assertJsonPath('code', 'consent_required');
});

it('lets an outstanding member narrow privacy and withdraw the AI opt-in', function () {
    cspAct($this->member);

    $this->patchJson('/api/v1/me/settings', [
        'discoverable' => false, 'indexable' => false, 'show_owner_on_qr' => false, 'read_receipts' => false, 'ai_suggestions' => false,
        'who_can_message' => 'nobody',
    ])->assertOk();

    $fresh = $this->member->fresh();
    expect($fresh->discoverable)->toBeFalse()->and($fresh->indexable)->toBeFalse()->and($fresh->show_owner_on_qr)->toBeFalse()
        ->and($fresh->read_receipts)->toBeFalse()->and($fresh->ai_suggestions)->toBeFalse()
        ->and($fresh->who_can_message)->toBe(WhoCanMessage::Nobody);

    cspAct($this->member);
    $this->patchJson('/api/v1/me/settings', ['ai_suggestions' => false])->assertOk();
});

it('keeps refusing settings that widen privacy or change anything else', function (array $payload, string $query = '') {
    cspAct($this->member);

    $this->patchJson('/api/v1/me/settings'.$query, $payload)->assertForbidden()->assertJsonPath('code', 'consent_required');

    $fresh = $this->member->fresh();
    expect($fresh->discoverable)->toBeTrue()->and($fresh->ai_suggestions)->toBeTrue()->and($fresh->who_can_message)->toBe(WhoCanMessage::Following);
})->with([
    'opting in again' => [['ai_suggestions' => true]],
    'becoming discoverable' => [['discoverable' => true]],
    'widening who can message' => [['who_can_message' => 'everyone']],
    'a restriction mixed with the theme' => [['discoverable' => false, 'theme' => 'black']],
    'a restriction with the theme in the query string' => [['discoverable' => false], '?theme=black'],
    'a restriction with notification prefs' => [['ai_suggestions' => false, 'notification_prefs' => ['message_previews' => true]]],
    'a string instead of a boolean' => [['discoverable' => 'false']],
    'an unknown audience' => [['who_can_message' => 'friends']],
    'an empty body' => [[]],
]);

it('keeps the current audience as a narrowing (no widening), and still validates', function () {
    cspAct($this->member);
    $this->patchJson('/api/v1/me/settings', ['who_can_message' => 'following'])->assertOk();

    $this->member->forceFill(['who_can_message' => WhoCanMessage::Nobody])->save();
    cspAct($this->member);
    $this->patchJson('/api/v1/me/settings', ['who_can_message' => 'following'])->assertForbidden()->assertJsonPath('code', 'consent_required');
});

it('lets an outstanding member make a vehicle private, never public', function () {
    $vehicle = Vehicle::factory()->create(['owner_id' => $this->member->id, 'visibility' => Visibility::Public]);
    cspAct($this->member);

    $this->patchJson("/api/v1/vehicles/{$vehicle->id}/visibility", ['visibility' => 'unlisted'])->assertForbidden()->assertJsonPath('code', 'consent_required');
    $this->patchJson("/api/v1/vehicles/{$vehicle->id}/visibility", ['visibility' => 'private'])->assertOk();
    expect($vehicle->fresh()->visibility)->toBe(Visibility::Private);

    $this->patchJson("/api/v1/vehicles/{$vehicle->id}/visibility", ['visibility' => 'public'])->assertForbidden()->assertJsonPath('code', 'consent_required');
    expect($vehicle->fresh()->visibility)->toBe(Visibility::Private);
});

it('does not open another member\'s content: the policy still answers', function () {
    $stranger = Vehicle::factory()->create(['visibility' => Visibility::Public]);
    cspAct($this->member);

    expect($this->deleteJson("/api/v1/vehicles/{$stranger->id}")->status())->toBeIn([403, 404]);
    expect($this->patchJson("/api/v1/vehicles/{$stranger->id}/visibility", ['visibility' => 'private'])->status())->toBeIn([403, 404]);
    expect(Vehicle::query()->whereKey($stranger->id)->value('visibility'))->toBe(Visibility::Public);
});

it('authorises the own realtime channel of an outstanding member', function () {
    config(['broadcasting.default' => 'pusher', 'broadcasting.connections.pusher.key' => 'k', 'broadcasting.connections.pusher.secret' => 's', 'broadcasting.connections.pusher.app_id' => '1', 'broadcasting.connections.pusher.options.cluster' => 'eu']);
    cspAct($this->member);

    $this->postJson('/api/v1/broadcasting/auth', ['channel_name' => 'private-user.'.strtoupper($this->member->id), 'socket_id' => '1.2'])->assertOk();
});

it('names only restricting routes that exist and are member writes', function () {
    foreach (array_keys(EnsureCurrentConsent::RESTRICTING) as $name) {
        $route = Route::getRoutes()->getByName($name);

        expect($route)->toBeInstanceOf(LaravelRoute::class, $name)
            ->and(in_array('member', $route->gatherMiddleware(), true))->toBeTrue($name)
            ->and(array_diff($route->methods(), ['GET', 'HEAD']))->not->toBe([], $name)
            ->and(in_array($name, EnsureCurrentConsent::EXEMPT, true))->toBeFalse($name);
    }
});
