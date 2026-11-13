<?php

use App\Enums\NotificationType;
use App\Models\BuildUpdate;
use App\Models\Notification;
use App\Models\User;
use App\Models\VehicleFollow;
use App\Services\Notifications\Notifier;
use App\Services\Notifications\NotifyFollowersOfPublication;
use App\Services\Notifications\PublicationFanout;
use App\Services\Search\VehicleSearchProjector;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/Social2TestHelpers.php';

/**
 * M4.11 build follow (09 §8.6): PUT/DELETE vehicles/{id}/follow, "Folge ich" and the update fan-out to a build's followers.
 */
beforeEach(function () {
    s2Flags();
    $this->owner = User::factory()->create(['username' => 'jann.ptrs']);
    $this->vehicle = publishedVehicle($this->owner);
    $this->fan = User::factory()->create(['username' => 'lukas.sc']);
});

describe('PUT vehicles/{id}/follow', function () {
    it('follows idempotently, tells the owner once, and answers the state without a count', function () {
        Sanctum::actingAs($this->fan);

        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/follow")->assertOk()
            ->assertExactJson(['data' => ['vehicle_id' => $this->vehicle->id, 'is_following' => true]]);
        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/follow")->assertOk();

        expect(VehicleFollow::query()->count())->toBe(1)
            ->and(Notification::query()->where('notifiable_id', $this->owner->id)->where('type', NotificationType::VehicleFollower)->count())->toBe(1);
        $this->getJson("/api/v1/public/vehicles/{$this->vehicle->slug}")->assertJsonPath('data.social.is_following', true);
    });

    it('applies the authorisation matrix', function (Closure $who, int $status, ?string $code) {
        socActAs($who($this->owner));

        $response = $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/follow")->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with(socMatrix([
        'guest' => [401, 'unauthenticated'],
        'other member' => [200, null],
        'unverified member' => [403, 'email_not_verified'],
        'member restricted from publishing' => [200, null],
        'member restricted from messaging' => [200, null],
        'suspended member' => [403, 'forbidden'],
        'deactivated member' => [403, 'forbidden'],
        'member who blocked the other' => [404, 'vehicle_unavailable'],
        'member the other blocked' => [404, 'vehicle_unavailable'],
    ]));

    it('refuses the own build, a private one and the flag off', function () {
        Sanctum::actingAs($this->owner);
        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/follow")->assertForbidden();

        Sanctum::actingAs($this->fan);
        $this->putJson('/api/v1/vehicles/'.publishedVehicle(null, ['visibility' => 'private'])->id.'/follow')->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');

        s2Flags(['vehicle_follow' => false]);
        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/follow")->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    });
});

describe('DELETE vehicles/{id}/follow', function () {
    it('unfollows any id', function () {
        s2FollowVehicle($this->fan, $this->vehicle);
        Sanctum::actingAs($this->fan);

        $this->deleteJson("/api/v1/vehicles/{$this->vehicle->id}/follow")->assertOk()->assertJsonPath('data.is_following', false);
        $this->deleteJson('/api/v1/vehicles/01JAAAAAAAAAAAAAAAAAAAAAAA/follow')->assertOk();
        expect(VehicleFollow::query()->count())->toBe(0);
    });
});

describe('Folge ich and notifications', function () {
    it('shows a followed build\'s updates once, also when its owner is followed too', function () {
        $update = PublicationFanout::muted(fn () => s2Post($this->vehicle));
        app(VehicleSearchProjector::class)->rebuild($this->vehicle->id);
        s2FollowVehicle($this->fan, $this->vehicle);
        Sanctum::actingAs($this->fan);

        expect(collect($this->getJson('/api/v1/feed?tab=following')->assertOk()->json('data'))->pluck('update.id')->filter()->values()->all())->toBe([$update->id]);

        socFollow($this->fan, $this->owner);
        $ids = collect($this->getJson('/api/v1/feed?tab=following')->json('data'))->pluck('update.id');
        expect($ids->filter(fn ($id) => $id === $update->id))->toHaveCount(1);
    });

    it('tells a build\'s followers about a new update, without a second row for one who follows the owner too', function () {
        $both = User::factory()->create();
        socFollow($both, $this->owner);
        s2FollowVehicle($both, $this->vehicle);
        s2FollowVehicle($this->fan, $this->vehicle);
        $update = PublicationFanout::muted(fn () => s2Post($this->vehicle));

        (new NotifyFollowersOfPublication($this->owner->id, $this->vehicle->id, $update->id))->handle(app(Notifier::class));
        (new NotifyFollowersOfPublication($this->owner->id, $this->vehicle->id, $update->id, '', 'v:'))->handle(app(Notifier::class));

        expect(Notification::query()->where('type', NotificationType::FollowedPublished)->pluck('notifiable_id')->sort()->values()->all())
            ->toBe(collect([$both->id, $this->fan->id])->sort()->values()->all());
    });

    it('tells nobody about a followers-only post\'s non-followers and nothing about an empty post', function () {
        s2FollowVehicle($this->fan, $this->vehicle);
        $empty = PublicationFanout::muted(fn () => s2Post($this->vehicle, ['note' => null]));

        (new NotifyFollowersOfPublication($this->owner->id, $this->vehicle->id, $empty->id, '', 'v:'))->handle(app(Notifier::class));

        expect(Notification::query()->count())->toBe(0)->and(BuildUpdate::query()->count())->toBe(1);
    });
});
