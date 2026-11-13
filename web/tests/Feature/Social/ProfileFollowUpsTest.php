<?php

use App\Enums\BuildUpdateAudience;
use App\Enums\EventStatus;
use App\Enums\EventVisibility;
use App\Enums\Visibility;
use App\Enums\WhoCanMessage;
use App\Models\BuildUpdate;
use App\Models\MemberCollection;
use App\Models\MemberCollectionItem;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SocialTestHelpers.php';
require_once __DIR__.'/../Social2/Social2TestHelpers.php';
require_once __DIR__.'/../Events/EventTestHelpers.php';
require_once __DIR__.'/../Garage/GarageTestHelpers.php';

/**
 * Phase 4 lane B profile follow-ups: PROF-02's can_message is read fresh (no server cache), GET public/users/{u}/updates and
 * GET public/users/{u}/events, a saved update names its build, and events in collections.
 */
beforeEach(function () {
    seedModSchema();
    s2Flags();
    evFlags();
    $this->member = User::factory()->create(['username' => 'kenji.r34', 'who_can_message' => WhoCanMessage::Everyone, 'created_at' => now()->subMonth()]);
});

describe('PROF-02 can_message after a settings change', function () {
    it('answers the new value at once, never a cached copy or a 304 of the old one', function () {
        $viewer = User::factory()->create();
        Sanctum::actingAs($viewer);
        $before = $this->getJson('/api/v1/public/users/kenji.r34')->assertOk()->assertJsonPath('data.can_message', true);

        expect($before->headers->get('Cache-Control'))->toContain('no-cache')->toContain('private');

        Sanctum::actingAs($this->member);
        $this->patchJson('/api/v1/me/settings', ['who_can_message' => 'nobody'])->assertOk()->assertJsonPath('data.who_can_message', 'nobody');

        // The app revalidates with the tag it holds: the server must not confirm the old body.
        Sanctum::actingAs($viewer);
        $this->withHeader('If-None-Match', (string) $before->headers->get('ETag'))->getJson('/api/v1/public/users/kenji.r34')
            ->assertOk()->assertJsonPath('data.can_message', false);
        // The conversation start agrees with the profile.
        $this->postJson('/api/v1/conversations', ['recipient' => 'kenji.r34', 'message' => ['type' => 'text', 'body' => 'Hallo'], 'client_id' => (string) Str::uuid()])
            ->assertForbidden()->assertJsonPath('code', 'cannot_message');
    });
});

/** A published build in the list projection (vehicle_search), as Home and Entdecken read it. */
function pfuBuild(User $owner, array $attributes = []): Vehicle
{
    $vehicle = publishedVehicle($owner, $attributes);
    app(VehicleSearchProjector::class)->rebuild($vehicle->id);

    return $vehicle;
}

describe('GET public/users/{username}/updates', function () {
    it('lists the updates of the member\'s public builds, newest first, with the build card and the type', function () {
        $public = pfuBuild($this->member);
        $unlisted = pfuBuild($this->member, ['visibility' => Visibility::Unlisted]);
        $older = s2Post($public, ['created_at' => now()->subDays(2), 'note' => 'Neue Felgen montiert.']);
        $newer = BuildUpdate::factory()->create(['vehicle_id' => $public->id, 'created_at' => now()->subDay()]);
        s2Post($public, ['hidden' => true, 'created_at' => now()]);
        s2Post($unlisted);
        s2Post(pfuBuild(User::factory()->create()));

        $this->getJson('/api/v1/public/users/kenji.r34/updates')->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.id', $newer->id)
            ->assertJsonPath('data.0.type', 'mod_added')
            ->assertJsonPath('data.0.vehicle.id', $public->id)
            ->assertJsonPath('data.1.id', $older->id)
            ->assertJsonPath('data.1.type', 'post');
    });

    it('pages by cursor', function () {
        $vehicle = pfuBuild($this->member);

        foreach (range(1, 3) as $day) {
            s2Post($vehicle, ['created_at' => now()->subDays($day)]);
        }

        $first = $this->getJson('/api/v1/public/users/kenji.r34/updates?per_page=2')->assertOk()->assertJsonCount(2, 'data');
        $this->getJson('/api/v1/public/users/kenji.r34/updates?per_page=2&cursor='.urlencode((string) $first->json('meta.next_cursor')))
            ->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/public/users/kenji.r34/updates?cursor=kaputt')->assertUnprocessable();
    });

    it('shows a followers-only update to followers and the owner only', function () {
        $vehicle = pfuBuild($this->member);
        s2Post($vehicle, ['audience' => BuildUpdateAudience::Followers]);
        $follower = User::factory()->create();
        socFollow($follower, $this->member);

        $this->getJson('/api/v1/public/users/kenji.r34/updates')->assertOk()->assertJsonCount(0, 'data');
        Sanctum::actingAs(User::factory()->create());
        $this->getJson('/api/v1/public/users/kenji.r34/updates')->assertOk()->assertJsonCount(0, 'data');
        Sanctum::actingAs($follower);
        $this->getJson('/api/v1/public/users/kenji.r34/updates')->assertOk()->assertJsonCount(1, 'data');
        Sanctum::actingAs($this->member);
        $this->getJson('/api/v1/public/users/kenji.r34/updates')->assertOk()->assertJsonCount(1, 'data');
    });

    it('follows the profile\'s rules on who may see the member', function (Closure $viewer, int $status, ?string $code) {
        s2Post(pfuBuild($this->member));
        socActAs($viewer($this->member));

        $response = $this->getJson('/api/v1/public/users/kenji.r34/updates')->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with(socMatrix([
        'guest' => [200, null],
        'other member' => [200, null],
        'unverified member' => [200, null],
        'member restricted from publishing' => [200, null],
        'member restricted from messaging' => [200, null],
        'suspended member' => [200, null],
        'deactivated member' => [200, null],
        'member who blocked the other' => [404, 'member_unavailable'],
        'member the other blocked' => [404, 'member_unavailable'],
    ]));

    it('is 404 for a suspended member', function () {
        $this->member->forceFill(['status' => 'suspended'])->save();

        $this->getJson('/api/v1/public/users/kenji.r34/updates')->assertNotFound()->assertJsonPath('code', 'member_unavailable');
    });
});

describe('GET public/users/{username}/events', function () {
    it('lists the member\'s published upcoming events by start, and past ones with when=past', function () {
        $later = evEvent($this->member, ['starts_at' => now()->addDays(9), 'ends_at' => now()->addDays(9)->addHours(3)]);
        $sooner = evEvent($this->member, ['starts_at' => now()->addDays(2), 'ends_at' => now()->addDays(2)->addHours(3)]);
        $past = evEvent($this->member, ['starts_at' => now()->subDays(9), 'ends_at' => now()->subDays(9)->addHours(3)]);
        evEvent($this->member, ['status' => EventStatus::Draft]);
        evEvent($this->member, ['status' => EventStatus::PendingReview]);
        evEvent();

        $this->getJson('/api/v1/public/users/kenji.r34/events')->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.id', $sooner->id)
            ->assertJsonPath('data.1.id', $later->id);
        $this->getJson('/api/v1/public/users/kenji.r34/events?when=past')->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $past->id);
        $this->getJson('/api/v1/public/users/kenji.r34/events?when=soon')->assertUnprocessable()->assertJsonValidationErrors('when');
    });

    it('shows followers-only events to followers only and never the exact place of an after_rsvp event', function () {
        evEvent($this->member, ['visibility' => EventVisibility::Followers]);
        evPrivateEvent($this->member, ['street' => 'Geheimweg 7']);
        $follower = User::factory()->create();
        socFollow($follower, $this->member);

        $guest = $this->getJson('/api/v1/public/users/kenji.r34/events')->assertOk()->assertJsonCount(1, 'data');
        expect(evStrings($guest->json()))->not->toContain('Geheimweg');
        Sanctum::actingAs($follower);
        $this->getJson('/api/v1/public/users/kenji.r34/events')->assertOk()->assertJsonCount(2, 'data');
    });

    it('follows the profile\'s rules on who may see the member, and the events flag', function (Closure $viewer, int $status, ?string $code) {
        evEvent($this->member);
        socActAs($viewer($this->member));

        $response = $this->getJson('/api/v1/public/users/kenji.r34/events')->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with(socMatrix([
        'guest' => [200, null],
        'other member' => [200, null],
        'unverified member' => [200, null],
        'member restricted from publishing' => [200, null],
        'member restricted from messaging' => [200, null],
        'suspended member' => [200, null],
        'deactivated member' => [200, null],
        'member who blocked the other' => [404, 'member_unavailable'],
        'member the other blocked' => [404, 'member_unavailable'],
    ]));

    it('is 404 feature_disabled while events are off', function () {
        evFlags(['events' => false]);

        $this->getJson('/api/v1/public/users/kenji.r34/events')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    });
});

describe('collections (COL-02)', function () {
    it('names the build of a saved update', function () {
        $vehicle = publishedVehicle($this->member, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'Nissan', 'model_text' => 'Skyline GT-R']);
        $update = s2Post($vehicle);
        $saver = User::factory()->create();
        Sanctum::actingAs($saver);
        $collection = $this->getJson('/api/v1/me/collections')->json('data.0.id');

        $this->postJson("/api/v1/me/collections/$collection/items", ['type' => 'build_update', 'id' => $update->id])->assertCreated()
            ->assertJsonPath('data.build_update.vehicle.slug', $vehicle->slug);
        $this->getJson("/api/v1/me/collections/$collection/items")->assertOk()
            ->assertJsonPath('data.0.build_update.id', $update->id)
            ->assertJsonPath('data.0.build_update.vehicle.slug', $vehicle->slug)
            ->assertJsonPath('data.0.build_update.vehicle.full_title', 'Nissan Skyline GT-R')
            ->assertJsonPath('data.0.build_update.vehicle.is_sample', false)
            ->assertJsonPath('data.0.build_update.vehicle.cover.id', fn (?string $id): bool => is_string($id));
    });

    it('saves an event the member can see, lists it as an EventCard and forgets it when the event is deleted', function () {
        $event = evEvent($this->member);
        $saver = User::factory()->create();
        Sanctum::actingAs($saver);
        $collection = $this->getJson('/api/v1/me/collections')->json('data.0.id');

        $this->postJson("/api/v1/me/collections/$collection/items", ['type' => 'event', 'id' => $event->id])->assertCreated()
            ->assertJsonPath('data.type', 'event')
            ->assertJsonPath('data.event.slug', $event->slug)
            ->assertJsonPath('data.vehicle', null);
        $this->getJson("/api/v1/me/collections/$collection/items")->assertOk()
            ->assertJsonPath('data.0.event.id', $event->id)
            ->assertJsonPath('data.0.event.counts', ['going' => 0, 'interested' => 0]);
        $this->getJson("/api/v1/me/collections?contains_type=event&contains_id={$event->id}")->assertOk();

        Sanctum::actingAs($this->member);
        $this->deleteJson("/api/v1/events/{$event->slug}")->assertNoContent();
        expect(MemberCollectionItem::query()->where('item_type', 'event')->count())->toBe(0);
    });

    it('refuses an event the member cannot see with the 404 of an unknown item', function (Closure $event) {
        $target = $event($this->member);
        Sanctum::actingAs(User::factory()->create());
        $collection = MemberCollection::query()->where('is_default', true)->value('id') ?? $this->getJson('/api/v1/me/collections')->json('data.0.id');

        $this->postJson("/api/v1/me/collections/$collection/items", ['type' => 'event', 'id' => $target->id])->assertNotFound();
    })->with([
        'a draft' => [fn (User $organiser) => evEvent($organiser, ['status' => EventStatus::Draft])],
        'followers only' => [fn (User $organiser) => evEvent($organiser, ['visibility' => EventVisibility::Followers])],
        'removed' => [fn (User $organiser) => evEvent($organiser, ['removed_at' => now()])],
    ]);

    it('hides a saved event once the member may no longer see it', function () {
        $event = evEvent($this->member);
        $saver = User::factory()->create();
        Sanctum::actingAs($saver);
        $collection = $this->getJson('/api/v1/me/collections')->json('data.0.id');
        $this->postJson("/api/v1/me/collections/$collection/items", ['type' => 'event', 'id' => $event->id])->assertCreated();

        socBlock($this->member, $saver);
        $this->getJson("/api/v1/me/collections/$collection/items")->assertOk()->assertJsonCount(0, 'data');
    });
});
