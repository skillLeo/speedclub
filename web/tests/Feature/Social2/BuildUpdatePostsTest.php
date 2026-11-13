<?php

use App\Enums\BuildUpdateType;
use App\Models\BuildUpdate;
use App\Models\Comment;
use App\Models\Media;
use App\Models\MemberCollection;
use App\Models\MemberCollectionItem;
use App\Models\Mention;
use App\Models\Reaction;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Notifications\NotifyFollowersOfPublication;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Support\TestImages;

require_once __DIR__.'/Social2TestHelpers.php';

/**
 * M4.11 build updates 2.0 (09 §8.5): POST/GET/PATCH/DELETE build-updates, POST build-updates/{id}/media, audience on every Verlauf read.
 */
beforeEach(function () {
    seedModSchema();
    s2Flags();
    $this->owner = User::factory()->create(['username' => 'jann.ptrs']);
    $this->vehicle = publishedVehicle($this->owner);
    $this->mod = modIn($this->vehicle, 'suspension');
});

describe('POST build-updates', function () {
    it('posts text, mods, mileage, date and audience, and queues the followers\' news', function () {
        Queue::fake();
        Sanctum::actingAs($this->owner);

        $response = $this->postJson('/api/v1/build-updates', [
            'vehicle_id' => $this->vehicle->id,
            'text' => "Neues Gewindefahrwerk drin.\nFährt sich wie auf Schienen.",
            'mileage_km' => 48200,
            'happened_on' => '2026-11-10',
            'audience' => 'followers',
            'modification_ids' => [$this->mod->id],
        ])->assertCreated()
            ->assertJsonPath('data.type', 'post')
            ->assertJsonPath('data.note', "Neues Gewindefahrwerk drin.\nFährt sich wie auf Schienen.")
            ->assertJsonPath('data.mileage_km', 48200)
            ->assertJsonPath('data.happened_on', '2026-11-10')
            ->assertJsonPath('data.audience', 'followers')
            ->assertJsonPath('data.modifications.0.id', $this->mod->id)
            ->assertJsonPath('data.edited_at', null)
            ->assertJsonPath('data.photos', []);

        expect($response->json('data.editable_until'))->toBeString();
        $update = BuildUpdate::query()->sole();
        expect($update->type)->toBe(BuildUpdateType::Post)->and($update->is_sample)->toBeFalse();
        Queue::assertPushed(NotifyFollowersOfPublication::class);
    });

    it('marks an update of a sample build as a sample', function () {
        $sample = publishedVehicle($this->owner, ['is_sample' => true]);
        Sanctum::actingAs($this->owner);

        $this->postJson('/api/v1/build-updates', ['vehicle_id' => $sample->id, 'text' => 'Beispiel'])->assertCreated();

        expect(BuildUpdate::query()->sole()->is_sample)->toBeTrue();
    });

    it('validates', function (array $body, string $field) {
        Sanctum::actingAs($this->owner);
        $other = modIn(publishedVehicle(), 'wheels_tires');

        $this->postJson('/api/v1/build-updates', ['vehicle_id' => $this->vehicle->id, ...$body + (array_key_exists('modification_ids', $body) && $body['modification_ids'] === ['other'] ? ['modification_ids' => [$other->id]] : [])])
            ->assertUnprocessable()->assertJsonValidationErrors($field);
    })->with([
        'text too long' => [['text' => str_repeat('a', 2001)], 'text'],
        'negative mileage' => [['mileage_km' => -1], 'mileage_km'],
        'future date' => [['happened_on' => '2099-01-01'], 'happened_on'],
        'unknown audience' => [['audience' => 'friends'], 'audience'],
        'mod of another build' => [['modification_ids' => ['other']], 'modification_ids.0'],
    ]);

    it('refuses a draft with 403 and a vehicle the member may not see with 404 vehicle_unavailable', function () {
        Sanctum::actingAs($this->owner);
        $draft = Vehicle::factory()->create(['owner_id' => $this->owner->id]);

        $this->postJson('/api/v1/build-updates', ['vehicle_id' => $draft->id, 'text' => 'x'])->assertForbidden();
        $this->postJson('/api/v1/build-updates', ['vehicle_id' => publishedVehicle(null, ['visibility' => 'private'])->id, 'text' => 'x'])
            ->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
    });

    it('applies the authorisation matrix', function (Closure $who, int $status, ?string $code) {
        $viewer = $who($this->owner);
        socActAs($viewer);

        $response = $this->postJson('/api/v1/build-updates', ['vehicle_id' => $this->vehicle->id, 'text' => 'Ein Update']);
        $response->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with([
        'guest' => [fn (User $owner): ?User => null, 401, 'unauthenticated'],
        'owner' => [fn (User $owner): ?User => $owner, 201, null],
        'other member' => [fn (User $owner): ?User => User::factory()->create(), 403, 'forbidden'],
        'owner restricted from publishing' => [function (User $owner): ?User {
            $owner->forceFill(['restrictions' => ['publishing' => ['until' => null]]])->save();

            return $owner->fresh();
        }, 403, 'account_restricted'],
        'member the owner blocked' => [function (User $owner): ?User {
            $member = User::factory()->create();
            socBlock($owner, $member);

            return $member;
        }, 404, 'vehicle_unavailable'],
    ]);

    it('refuses a staff session', function () {
        $this->actingAs(Staff::factory()->create(), 'staff')->postJson('/api/v1/build-updates', ['vehicle_id' => $this->vehicle->id, 'text' => 'x'])->assertUnauthorized();
    });

    it('replays an Idempotency-Key', function () {
        Sanctum::actingAs($this->owner);
        $body = ['vehicle_id' => $this->vehicle->id, 'text' => 'Einmal'];

        $first = $this->postJson('/api/v1/build-updates', $body, ['Idempotency-Key' => 'upd-1'])->assertCreated()->json('data.id');
        expect($this->postJson('/api/v1/build-updates', $body, ['Idempotency-Key' => 'upd-1'])->json('data.id'))->toBe($first)
            ->and(BuildUpdate::query()->count())->toBe(1);
    });

    it('is rate-limited', function () {
        Sanctum::actingAs($this->owner);
        $body = ['vehicle_id' => $this->vehicle->id, 'text' => 'Einmal'];
        socLimit('build_updates');
        $this->postJson('/api/v1/build-updates', $body)->assertCreated();
        $this->postJson('/api/v1/build-updates', $body)->assertStatus(429)->assertJsonPath('code', 'rate_limited');
    });
});

describe('PATCH build-updates/{id}', function () {
    it('edits within 24 hours and stamps edited_at', function () {
        $update = s2Post($this->vehicle);
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/build-updates/{$update->id}", ['text' => 'Neu formuliert', 'mileage_km' => 50000, 'modification_ids' => [$this->mod->id]])
            ->assertOk()->assertJsonPath('data.note', 'Neu formuliert')->assertJsonPath('data.mileage_km', 50000)
            ->assertJsonPath('data.modifications.0.id', $this->mod->id);

        expect($update->fresh()->edited_at)->not->toBeNull();
    });

    it('answers 403 edit_window_closed after 24 hours, while hiding stays open', function () {
        $update = s2Post($this->vehicle, ['created_at' => now()->subHours(25)]);
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/build-updates/{$update->id}", ['text' => 'Zu spät'])->assertForbidden()->assertJsonPath('code', 'edit_window_closed');
        $this->patchJson("/api/v1/updates/{$update->id}", ['hidden' => true])->assertOk();
    });

    it('takes before/after pairs and the photo order of the update\'s own photos only', function () {
        $update = s2Post($this->vehicle);
        $before = Media::factory()->forModel($update)->create(['owner_id' => $this->owner->id, 'sort' => 0]);
        $after = Media::factory()->forModel($update)->create(['owner_id' => $this->owner->id, 'sort' => 1]);
        $foreign = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id]);
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/build-updates/{$update->id}", ['photo_pairs' => [[$before->id, $foreign->id]]])->assertUnprocessable();
        $this->patchJson("/api/v1/build-updates/{$update->id}", ['photo_pairs' => [[$before->id, $after->id]], 'photo_order' => [$after->id, $before->id]])
            ->assertOk()->assertJsonPath('data.photo_pairs', [['before' => $before->id, 'after' => $after->id]])
            ->assertJsonPath('data.photos.0.id', $after->id);
    });

    it('is the owner\'s only', function () {
        $update = s2Post($this->vehicle);
        Sanctum::actingAs(User::factory()->create());

        $this->patchJson("/api/v1/build-updates/{$update->id}", ['text' => 'fremd'])->assertForbidden();
    });

    it('does not edit automatic entries', function () {
        $auto = BuildUpdate::factory()->create(['vehicle_id' => $this->vehicle->id, 'created_at' => now()]);
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/build-updates/{$auto->id}", ['text' => 'x'])->assertForbidden();
    });
});

describe('DELETE build-updates/{id}', function () {
    it('deletes the post with its reactions, mentions, comments and collection entries', function () {
        $update = s2Post($this->vehicle);
        $fan = User::factory()->create();
        Reaction::factory()->create(['user_id' => $fan->id, 'reactable_id' => $update->id]);
        Mention::factory()->create(['mentionable_id' => $update->id, 'mentioned_user_id' => $fan->id, 'author_id' => $this->owner->id]);
        Comment::factory()->create(['build_update_id' => $update->id, 'user_id' => $fan->id]);
        $collection = MemberCollection::factory()->create(['user_id' => $fan->id]);
        MemberCollectionItem::factory()->create(['collection_id' => $collection->id, 'item_type' => 'build_update', 'item_id' => $update->id]);
        Sanctum::actingAs($this->owner);

        $this->deleteJson("/api/v1/build-updates/{$update->id}")->assertNoContent();

        expect(BuildUpdate::query()->count())->toBe(0)
            ->and(Reaction::query()->count())->toBe(0)
            ->and(Mention::query()->count())->toBe(0)
            ->and(Comment::withTrashed()->count())->toBe(0)
            ->and(MemberCollectionItem::query()->count())->toBe(0);
    });

    it('stays open under a restriction and is refused to anybody else', function () {
        $update = s2Post($this->vehicle);
        Sanctum::actingAs(User::factory()->create());
        $this->deleteJson("/api/v1/build-updates/{$update->id}")->assertForbidden();

        $this->owner->forceFill(['restrictions' => ['publishing' => ['until' => null]]])->save();
        Sanctum::actingAs($this->owner->fresh());
        $this->deleteJson("/api/v1/build-updates/{$update->id}")->assertNoContent();
    });
});

describe('POST build-updates/{id}/media', function () {
    it('adds re-encoded photos up to the limit, within the edit window', function () {
        Storage::fake('public');
        Storage::fake('local');
        config(['speedclub.social_2.update_max_photos' => 1]);
        $update = s2Post($this->vehicle);
        Sanctum::actingAs($this->owner);

        $this->post("/api/v1/build-updates/{$update->id}/media", ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300))], ['Accept' => 'application/json'])
            ->assertCreated()->assertJsonPath('data.status', 'ready');
        $this->post("/api/v1/build-updates/{$update->id}/media", ['file' => UploadedFile::fake()->createWithContent('b.jpg', TestImages::jpeg(400, 300))], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonValidationErrors('file');

        $this->getJson("/api/v1/build-updates/{$update->id}")->assertJsonCount(1, 'data.photos');
    });

    it('is the owner\'s only', function () {
        $update = s2Post($this->vehicle);
        Sanctum::actingAs(User::factory()->create());

        $this->post("/api/v1/build-updates/{$update->id}/media", ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300))], ['Accept' => 'application/json'])->assertForbidden();
    });
});

describe('audience', function () {
    it('shows a followers-only post to the owner and to followers of the owner or the build, and to nobody else', function () {
        $update = s2Post($this->vehicle, ['audience' => 'followers']);
        $memberFollower = User::factory()->create();
        socFollow($memberFollower, $this->owner);
        $buildFollower = User::factory()->create();
        s2FollowVehicle($buildFollower, $this->vehicle);
        $stranger = User::factory()->create();

        $this->getJson("/api/v1/build-updates/{$update->id}")->assertNotFound();
        $this->getJson("/api/v1/public/vehicles/{$this->vehicle->slug}/updates")->assertJsonCount(0, 'data');

        foreach ([$this->owner, $memberFollower, $buildFollower] as $reader) {
            Sanctum::actingAs($reader);
            $this->getJson("/api/v1/build-updates/{$update->id}")->assertOk();
            $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/updates")->assertJsonPath('data.0.id', $update->id);
        }

        Sanctum::actingAs($stranger);
        $this->getJson("/api/v1/build-updates/{$update->id}")->assertNotFound();
        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/updates")->assertJsonCount(0, 'data');
        $this->getJson("/api/v1/public/vehicles/{$this->vehicle->slug}")->assertJsonCount(0, 'data.updates')->assertJsonPath('data.updates_count', 0);
    });

    it('keeps a hidden post from everybody but the owner', function () {
        $update = s2Post($this->vehicle, ['hidden' => true]);

        $this->getJson("/api/v1/build-updates/{$update->id}")->assertNotFound();
        Sanctum::actingAs($this->owner);
        $this->getJson("/api/v1/build-updates/{$update->id}")->assertOk()->assertJsonPath('data.hidden', true);
    });
});
