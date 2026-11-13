<?php

use App\Actions\Social\BlockMember;
use App\Enums\RestrictionType;
use App\Enums\SecurityNotice;
use App\Http\RateLimits;
use App\Models\Notification;
use App\Models\User;
use App\Services\Notifications\Notifier;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/NotificationTestHelpers.php';

/**
 * M2.2 HOME-02 routes: GET notifications, GET notifications/unread-count, PATCH notifications/{id}, POST notifications/read-all.
 */
beforeEach(function () {
    Mail::fake();
    // Groups count Berlin days: a run that crosses midnight must not split one.
    $this->travelTo(CarbonImmutable::parse('2026-11-10 12:00:00', 'Europe/Berlin'));
    $this->notifier = app(Notifier::class);
    $this->lena = ntfMember('lena.911');
    $this->lukas = ntfMember('lukas.sc', ['display_name' => 'Lukas Schmidt', 'city' => 'Stuttgart']);
});

/**
 * Who asks, for the routes of one's own rows.
 *
 * @return array<string, array{0: Closure(): ?User, 1: int}>
 */
function ntfOwnMatrix(int $ok): array
{
    return [
        'guest' => [fn (): ?User => null, 401],
        'member' => [fn (): ?User => User::factory()->create(), $ok],
        'unverified member' => [fn (): ?User => User::factory()->unverified()->create(), $ok],
        'member restricted from publishing' => [fn (): ?User => User::factory()->restrictedFrom(RestrictionType::Publishing)->create(), $ok],
        'member restricted from messaging' => [fn (): ?User => User::factory()->restrictedFrom(RestrictionType::Messaging)->create(), $ok],
        'suspended member' => [fn (): ?User => User::factory()->suspended()->create(), $ok],
        'deactivated member' => [fn (): ?User => User::factory()->deactivated()->create(), 403],
    ];
}

describe('GET notifications', function () {
    it('lists newest first with the exact shape', function () {
        $vehicle = publishedVehicle($this->lukas);
        $this->notifier->newFollower($this->lena, $this->lukas);
        $this->travel(1)->minutes();
        $this->notifier->security($this->lena, SecurityNotice::NewDevice, 'iPhone 15');
        $this->travel(1)->minutes();
        $saved = $this->notifier->buildSaved($this->lena, publishedVehicle($this->lena), 3, '2026-W45');
        $this->travel(1)->minutes();
        $published = $this->notifier->followedPublished($this->lena, $this->lukas, $vehicle, null);
        Sanctum::actingAs($this->lena);

        $response = $this->getJson('/api/v1/notifications')->assertOk();

        expect($response->json('data.*.type'))->toBe(['followed_published', 'build_saved', 'security', 'new_follower'])
            ->and($response->json('meta.next_cursor'))->toBeNull()
            ->and($response->json('data.0'))->toMatchArray([
                'id' => $published?->id,
                'group_key' => "followed_published:{$this->lukas->id}:".now('Europe/Berlin')->toDateString(),
                'actor_count' => 1,
                'details' => ['kind' => 'vehicle', 'update_id' => null, 'vehicles' => 1, 'updates' => 0],
                'read_at' => null,
            ])
            ->and($response->json('data.0.actors'))->toBe([['username' => 'lukas.sc', 'display_name' => 'Lukas Schmidt', 'city' => 'Stuttgart', 'avatar' => null, 'is_sample' => false, 'is_editorial' => false, 'main_vehicle_cover' => null]])
            ->and(array_keys($response->json('data.0.vehicle')))->toBe(['id', 'slug', 'full_title', 'cover', 'is_sample'])
            ->and($response->json('data.0.vehicle.id'))->toBe($vehicle->id)
            ->and($response->json('data.0.vehicle.cover'))->not->toBeNull()
            ->and($response->json('data.1'))->toMatchArray(['id' => $saved?->id, 'actors' => [], 'actor_count' => 3, 'details' => ['count' => 3, 'week' => '2026-W45']])
            ->and($response->json('data.2'))->toMatchArray(['group_key' => null, 'actors' => [], 'actor_count' => 0, 'vehicle' => null, 'details' => ['event' => 'new_device', 'device_name' => 'iPhone 15', 'security_event_id' => null]])
            ->and($response->json('data.3'))->toMatchArray(['actor_count' => 1, 'vehicle' => null, 'details' => []])
            ->and(array_keys($response->json('data.3')))->toBe(['id', 'type', 'group_key', 'actors', 'actor_count', 'vehicle', 'event', 'details', 'read_at', 'created_at']);
    });

    it('shows at most three actors, newest first, and counts them all', function () {
        foreach (['a.one', 'b.two', 'c.three', 'd.four', 'e.five'] as $minute => $name) {
            $this->travel(1)->minutes();
            $this->notifier->newFollower($this->lena, ntfMember($name));
        }
        Sanctum::actingAs($this->lena);

        $this->getJson('/api/v1/notifications')->assertOk()
            ->assertJsonPath('data.0.actor_count', 5)
            ->assertJsonPath('data.0.actors.*.username', ['e.five', 'd.four', 'c.three']);
    });

    it('leaves out actors the reader may no longer see, and rows with none left', function () {
        $paul = ntfMember('paul.roadster');
        $kenji = ntfMember('kenji.r34');
        $this->notifier->newFollower($this->lena, $this->lukas);
        $this->notifier->newFollower($this->lena, $paul);
        $this->travel(1)->days();
        $this->notifier->newFollower($this->lena, $kenji);

        app(BlockMember::class)->handle($this->lena, $this->lukas);
        $paul->forceFill(['status' => 'suspended'])->save();
        app(BlockMember::class)->handle($kenji, $this->lena);
        Sanctum::actingAs($this->lena);

        $this->getJson('/api/v1/notifications')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/notifications/unread-count')->assertOk()->assertJsonPath('data.notifications', 0);

        $paul->forceFill(['status' => 'active'])->save();
        $this->getJson('/api/v1/notifications')->assertOk()
            ->assertJsonPath('data.0.actor_count', 1)
            ->assertJsonPath('data.0.actors.0.username', 'paul.roadster');
    });

    it('drops the vehicle of a row once the reader may no longer see it', function () {
        $vehicle = publishedVehicle($this->lukas);
        $this->notifier->followedPublished($this->lena, $this->lukas, $vehicle, null);
        $vehicle->forceFill(['visibility' => 'private'])->save();
        Sanctum::actingAs($this->lena);

        $this->getJson('/api/v1/notifications')->assertOk()->assertJsonPath('data.0.vehicle', null);
    });

    it('pages by cursor without gaps or repeats', function () {
        foreach (range(1, 5) as $i) {
            $this->travel(1)->minutes();
            $this->notifier->security($this->lena, SecurityNotice::NewDevice, "Gerät $i");
        }
        Sanctum::actingAs($this->lena);

        $first = $this->getJson('/api/v1/notifications?per_page=2')->assertOk();
        $second = $this->getJson('/api/v1/notifications?per_page=2&cursor='.$first->json('meta.next_cursor'))->assertOk();
        $third = $this->getJson('/api/v1/notifications?per_page=2&cursor='.$second->json('meta.next_cursor'))->assertOk();

        expect([...$first->json('data.*.details.device_name'), ...$second->json('data.*.details.device_name'), ...$third->json('data.*.details.device_name')])
            ->toBe(['Gerät 5', 'Gerät 4', 'Gerät 3', 'Gerät 2', 'Gerät 1'])
            ->and($third->json('meta.next_cursor'))->toBeNull();
    });

    it('refuses a bad per_page or a forged cursor with 422', function (string $query, string $field) {
        Sanctum::actingAs($this->lena);

        $this->getJson("/api/v1/notifications?$query")->assertUnprocessable()->assertJsonPath('code', 'validation_failed')->assertJsonValidationErrors($field);
    })->with([
        ['per_page=0', 'per_page'],
        ['per_page=51', 'per_page'],
        ['cursor=kaputt', 'cursor'],
        ['cursor='.base64_encode('{"sort_at":"x","id":"y","_pointsToNextItems":true}'), 'cursor'],
    ]);

    it('never shows another member\'s rows', function () {
        $this->notifier->security($this->lena, SecurityNotice::NewDevice, 'iPhone');
        Sanctum::actingAs($this->lukas);

        $this->getJson('/api/v1/notifications')->assertOk()->assertJsonCount(0, 'data');
    });

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        $viewer = $who();
        socActAs($viewer);

        $this->getJson('/api/v1/notifications')->assertStatus($status);
    })->with(ntfOwnMatrix(200));
});

describe('GET notifications/unread-count', function () {
    it('counts unread rows; messages and requests stay 0', function () {
        $this->notifier->newFollower($this->lena, $this->lukas);
        $this->notifier->security($this->lena, SecurityNotice::NewDevice, 'iPhone');
        Notification::factory()->forRecipient($this->lena)->read()->create();
        Sanctum::actingAs($this->lena);

        $this->getJson('/api/v1/notifications/unread-count')->assertOk()
            ->assertExactJson(['data' => ['notifications' => 2, 'messages' => 0, 'requests' => 0]])
            ->assertHeader('ETag');
    });

    it('answers 304 to the same ETag', function () {
        Sanctum::actingAs($this->lena);
        $etag = $this->getJson('/api/v1/notifications/unread-count')->assertOk()->headers->get('ETag');

        $this->getJson('/api/v1/notifications/unread-count', ['If-None-Match' => (string) $etag])->assertStatus(304);
    });

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        socActAs($who());

        $this->getJson('/api/v1/notifications/unread-count')->assertStatus($status);
    })->with(ntfOwnMatrix(200));
});

describe('PATCH notifications/{id}', function () {
    it('marks read and unread again, keeping the first read time', function () {
        $row = $this->notifier->newFollower($this->lena, $this->lukas);
        Sanctum::actingAs($this->lena);

        $read = $this->patchJson("/api/v1/notifications/{$row?->id}", ['read' => true])->assertOk()
            ->assertJsonPath('data.id', $row?->id)
            ->json('data.read_at');
        $this->travel(5)->minutes();

        expect($read)->not->toBeNull();
        $this->patchJson("/api/v1/notifications/{$row?->id}", ['read' => true])->assertOk()->assertJsonPath('data.read_at', $read);
        $this->patchJson("/api/v1/notifications/{$row?->id}", ['read' => false])->assertOk()->assertJsonPath('data.read_at', null);
    });

    it('answers 404 for another member\'s row, a row the list leaves out, and an id that never existed', function (Closure $id) {
        Sanctum::actingAs($this->lena);

        $this->patchJson('/api/v1/notifications/'.$id($this), ['read' => true])->assertNotFound()->assertJsonPath('code', 'not_found');
    })->with([
        'another member\'s' => [fn ($test) => Notification::factory()->forRecipient($test->lukas)->create()->id],
        'about a blocked actor' => [function ($test) {
            $row = $test->notifier->newFollower($test->lena, $test->lukas);
            app(BlockMember::class)->handle($test->lena, $test->lukas);

            return $row?->id;
        }],
        'never existed' => [fn () => '01jaaaaaaaaaaaaaaaaaaaaaaa'],
        'not an id' => [fn () => 'kaputt'],
    ]);

    it('needs read as a strict boolean', function (mixed $read) {
        $row = Notification::factory()->forRecipient($this->lena)->create();
        Sanctum::actingAs($this->lena);

        $this->patchJson("/api/v1/notifications/{$row->id}", ['read' => $read])->assertUnprocessable()->assertJsonValidationErrors('read');
    })->with([null, 'yes', 1]);

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        $viewer = $who();
        $row = Notification::factory()->forRecipient($viewer ?? $this->lena)->create();
        socActAs($viewer);

        $this->patchJson("/api/v1/notifications/{$row->id}", ['read' => true])->assertStatus($status);
    })->with(ntfOwnMatrix(200));
});

describe('POST notifications/read-all', function () {
    it('marks every unread row of the member read and nobody else\'s', function () {
        Notification::factory()->forRecipient($this->lena)->count(3)->create();
        $other = Notification::factory()->forRecipient($this->lukas)->create();
        Sanctum::actingAs($this->lena);

        $this->postJson('/api/v1/notifications/read-all')->assertNoContent();

        expect(Notification::query()->where('notifiable_id', $this->lena->id)->whereNull('read_at')->count())->toBe(0)
            ->and($other->refresh()->read_at)->toBeNull();
        $this->getJson('/api/v1/notifications/unread-count')->assertJsonPath('data.notifications', 0);
    });

    it('is limited', function () {
        config(['speedclub.rate_limits.notification_reads.max' => 1]);
        RateLimits::register();
        Sanctum::actingAs($this->lena);

        $this->postJson('/api/v1/notifications/read-all')->assertNoContent();
        $this->postJson('/api/v1/notifications/read-all')->assertStatus(429)->assertJsonPath('code', 'rate_limited');
    });

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        socActAs($who());

        $this->postJson('/api/v1/notifications/read-all')->assertStatus($status);
    })->with(ntfOwnMatrix(204));
});
