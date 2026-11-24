<?php

use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\PlateBlurState;
use App\Enums\RestrictionType;
use App\Http\Middleware\Idempotency;
use App\Http\RateLimits;
use App\Models\Block;
use App\Models\BuildUpdate;
use App\Models\Conversation;
use App\Models\Event;
use App\Models\Media;
use App\Models\Modification;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Media\MediaService;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Support\TestImages;

require_once dirname(__DIR__).'/Social2/Social2TestHelpers.php';
require_once dirname(__DIR__).'/Signature/SignatureTestHelpers.php';

/**
 * M5.9a "Kennzeichen prüfen" (m5.9a-contract §4): GET me/plate-check, POST me/plate-check/{media} {decision: keep},
 * POST me/plate-check/dismiss. Nothing changes a photo without the member's decision.
 */
beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    $this->owner = User::factory()->create(['username' => 'pck.halter']);
    $this->vehicle = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id]);
});

/**
 * A finished photo of the owner's, as the factory makes them (unchecked unless the state says otherwise).
 *
 * @param  array<string, mixed>  $attributes
 */
function pckPhoto(User $owner, Model $parent, array $attributes = []): Media
{
    return Media::factory()->forModel($parent)->create(['owner_id' => $owner->id, 'status' => MediaStatus::Ready, ...$attributes]);
}

describe('GET me/plate-check', function () {
    it('lists the member\'s unchecked photos of vehicles, mods, updates and the cover, newest first', function () {
        $vehicle = pckPhoto($this->owner, $this->vehicle);
        $mod = pckPhoto($this->owner, Modification::factory()->create(['vehicle_id' => $this->vehicle->id]));
        $update = pckPhoto($this->owner, s2Post($this->vehicle));
        $cover = pckPhoto($this->owner, $this->owner);
        $this->owner->forceFill(['cover_media_id' => $cover->id])->save();
        Sanctum::actingAs($this->owner);

        $response = $this->getJson('/api/v1/me/plate-check')->assertOk()
            ->assertJsonPath('meta.count', 4)
            ->assertJsonPath('meta.dismissed', false)
            ->assertJsonPath('meta.next_cursor', null);

        $items = collect($response->json('data'))->keyBy('media_id');
        expect($response->json('data.*.media_id'))->toBe([$cover->id, $update->id, $mod->id, $vehicle->id])
            ->and($items[$vehicle->id]['kind'])->toBe('vehicle')
            ->and($items[$mod->id]['kind'])->toBe('modification')
            ->and($items[$update->id]['kind'])->toBe('build_update')
            ->and($items[$cover->id]['kind'])->toBe('cover')
            ->and($items[$cover->id]['vehicle'])->toBeNull()
            ->and($items[$mod->id]['vehicle'])->toBe(['id' => $this->vehicle->id, 'slug' => $this->vehicle->slug, 'name' => $items[$mod->id]['vehicle']['name']])
            ->and($items[$vehicle->id]['vehicle']['id'])->toBe($this->vehicle->id)
            ->and(array_keys($items[$vehicle->id]['image']))->toBe(['url', 'width', 'height', 'thumbhash', 'blurhash']);
    });

    it('leaves out what is not the member\'s to check', function () {
        pckPhoto($this->owner, $this->vehicle, ['plate_blur' => PlateBlurState::Blurred]);
        pckPhoto($this->owner, $this->vehicle, ['plate_blur' => PlateBlurState::Declined]);
        pckPhoto($this->owner, $this->vehicle, ['status' => MediaStatus::Processing]);
        pckPhoto($this->owner, $this->vehicle, ['status' => MediaStatus::Failed]);
        pckPhoto($this->owner, $this->vehicle, ['moderation_status' => ModerationStatus::Rejected]);
        pckPhoto($this->owner, $this->vehicle)->delete();
        // The avatar, a chat photo, an event cover: not part of the check.
        $avatar = pckPhoto($this->owner, $this->owner);
        $this->owner->forceFill(['avatar_media_id' => $avatar->id])->save();
        pckPhoto($this->owner, Conversation::factory()->create());
        pckPhoto($this->owner, Event::factory()->create(['organiser_id' => $this->owner->id]));
        // A deleted vehicle's photo, and another member's photo.
        pckPhoto($this->owner, Vehicle::factory()->published()->create(['owner_id' => $this->owner->id, 'deleted_at' => now()]));
        $other = User::factory()->create();
        pckPhoto($other, Vehicle::factory()->published()->create(['owner_id' => $other->id]));
        Sanctum::actingAs($this->owner);

        $this->getJson('/api/v1/me/plate-check')->assertOk()->assertJsonPath('meta.count', 0)->assertJsonPath('data', []);
    });

    it('pages by cursor and counts all of them on every page', function () {
        foreach (range(1, 3) as $index) {
            pckPhoto($this->owner, $this->vehicle);
        }
        Sanctum::actingAs($this->owner);

        $first = $this->getJson('/api/v1/me/plate-check?per_page=2')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('meta.count', 3);
        $cursor = $first->json('meta.next_cursor');
        expect($cursor)->toBeString();

        $this->getJson('/api/v1/me/plate-check?per_page=2&cursor='.urlencode($cursor))->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('meta.count', 3)->assertJsonPath('meta.next_cursor', null);
        $this->getJson('/api/v1/me/plate-check?cursor=gefälscht')->assertUnprocessable()->assertJsonValidationErrors('cursor');
        $this->getJson('/api/v1/me/plate-check?per_page=51')->assertUnprocessable()->assertJsonValidationErrors('per_page');
    });

    it('pages 25 by default', function () {
        Media::factory()->count(26)->forModel($this->vehicle)->create(['owner_id' => $this->owner->id, 'status' => MediaStatus::Ready]);
        Sanctum::actingAs($this->owner);

        $this->getJson('/api/v1/me/plate-check')->assertOk()->assertJsonCount(25, 'data')->assertJsonPath('meta.count', 26);
    });

    it('is the member\'s own list', function (Closure $who, int $status) {
        $viewer = $who($this->owner);

        if ($viewer instanceof Staff) {
            $this->actingAs($viewer, 'staff');
        } elseif ($viewer !== null) {
            Sanctum::actingAs($viewer);
        }

        $this->getJson('/api/v1/me/plate-check')->assertStatus($status);
    })->with([
        'guest' => [fn (User $owner): ?User => null, 401],
        'staff session' => [fn (User $owner): Staff => Staff::factory()->create(), 401],
        // Reading their own list stays open; the decisions are refused (below).
        'restricted owner' => [function (User $owner): User {
            $owner->forceFill(['restrictions' => [RestrictionType::Publishing->value => ['until' => now()->addWeek()->format(DATE_ATOM)]]])->save();

            return $owner->refresh();
        }, 200],
    ]);
});

describe('POST me/plate-check/{media}', function () {
    beforeEach(function () {
        $this->photo = pckPhoto($this->owner, $this->vehicle);
    });

    it('keeps the photo as it is and takes it off the list', function () {
        $before = $this->photo->only(['variants', 'original_path', 'blurhash', 'status']);
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/me/plate-check/{$this->photo->id}", ['decision' => 'keep'])->assertNoContent();

        expect($this->photo->refresh()->plate_blur)->toBe(PlateBlurState::Declined)
            ->and($this->photo->only(['variants', 'original_path', 'blurhash', 'status']))->toBe($before);
        $this->getJson('/api/v1/me/plate-check')->assertJsonPath('meta.count', 0);
        // Decided: a second "keep" (a retry without a key) changes nothing.
        $this->postJson("/api/v1/me/plate-check/{$this->photo->id}", ['decision' => 'keep'])->assertNoContent();
        expect($this->photo->refresh()->plate_blur)->toBe(PlateBlurState::Declined);
    });

    it('validates the decision', function (array $body) {
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/me/plate-check/{$this->photo->id}", $body)->assertUnprocessable()->assertJsonValidationErrors('decision');
        expect($this->photo->refresh()->plate_blur)->toBe(PlateBlurState::Unchecked);
    })->with([
        'missing' => [[]],
        'blur is PATCH media' => [['decision' => 'blur']],
        'not a string' => [['decision' => ['keep']]],
    ]);

    it('never turns a blurred photo back', function () {
        $this->photo->forceFill(['plate_blur' => PlateBlurState::Blurred])->save();
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/me/plate-check/{$this->photo->id}", ['decision' => 'keep'])->assertNoContent();
        expect($this->photo->refresh()->plate_blur)->toBe(PlateBlurState::Blurred);
    });

    it('answers a retry with the same Idempotency-Key with 204 and changes nothing more', function () {
        Sanctum::actingAs($this->owner);
        $key = (string) Str::uuid();

        $this->postJson("/api/v1/me/plate-check/{$this->photo->id}", ['decision' => 'keep'], [Idempotency::HEADER => $key])->assertNoContent();
        $this->postJson("/api/v1/me/plate-check/{$this->photo->id}", ['decision' => 'keep'], [Idempotency::HEADER => $key])->assertNoContent();
        // A 204 is not stored by the Idempotency middleware (JSON answers only): the action itself is idempotent.
        expect($this->photo->refresh()->plate_blur)->toBe(PlateBlurState::Declined);
    });

    it('lets only the owner decide', function (Closure $who, int $status) {
        $viewer = $who($this->owner);

        if ($viewer instanceof Staff) {
            $this->actingAs($viewer, 'staff');
        } elseif ($viewer !== null) {
            Sanctum::actingAs($viewer);
        }

        $this->postJson("/api/v1/me/plate-check/{$this->photo->id}", ['decision' => 'keep'])->assertStatus($status);

        expect($this->photo->refresh()->plate_blur)->toBe($status === 204 ? PlateBlurState::Declined : PlateBlurState::Unchecked);
    })->with([
        'guest' => [fn (User $owner): ?User => null, 401],
        'owner' => [fn (User $owner): User => $owner, 204],
        'other member' => [fn (User $owner): User => User::factory()->create(), 404],
        'member the owner blocked' => [function (User $owner): User {
            $member = User::factory()->create();
            Block::factory()->create(['blocker_id' => $owner->id, 'blocked_id' => $member->id]);

            return $member;
        }, 404],
        'owner restricted from publishing' => [function (User $owner): User {
            $owner->forceFill(['restrictions' => [RestrictionType::Publishing->value => ['until' => now()->addWeek()->format(DATE_ATOM)]]])->save();

            return $owner->refresh();
        }, 403],
        'staff session' => [fn (User $owner): Staff => Staff::factory()->create(), 401],
    ]);

    it('finds no chat photo, avatar or unknown id', function () {
        $chat = pckPhoto($this->owner, Conversation::factory()->create());
        $avatar = pckPhoto($this->owner, $this->owner);
        Sanctum::actingAs($this->owner);

        foreach ([$chat->id, $avatar->id, (string) Str::ulid()] as $id) {
            $this->postJson("/api/v1/me/plate-check/$id", ['decision' => 'keep'])->assertNotFound();
        }

        expect($chat->refresh()->plate_blur)->toBe(PlateBlurState::Unchecked);
    });

    it('is throttled with the garage edits', function () {
        config(['speedclub.rate_limits.garage_edits.max' => 1]);
        RateLimits::register();
        $second = pckPhoto($this->owner, $this->vehicle);
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/me/plate-check/{$this->photo->id}", ['decision' => 'keep'])->assertNoContent();
        $this->postJson("/api/v1/me/plate-check/{$second->id}", ['decision' => 'keep'])->assertTooManyRequests();
    });
});

describe('POST me/plate-check/dismiss', function () {
    it('ends the card for good and changes no photo', function () {
        $photo = pckPhoto($this->owner, $this->vehicle);
        Sanctum::actingAs($this->owner);

        $this->postJson('/api/v1/me/plate-check/dismiss')->assertNoContent();
        $first = $this->owner->refresh()->plate_check_dismissed_at;
        expect($first)->not->toBeNull();

        $this->travel(1)->day();
        $this->postJson('/api/v1/me/plate-check/dismiss')->assertNoContent();

        expect($this->owner->refresh()->plate_check_dismissed_at?->equalTo($first))->toBeTrue()
            ->and($photo->refresh()->plate_blur)->toBe(PlateBlurState::Unchecked);
        $this->getJson('/api/v1/me/plate-check')->assertJsonPath('meta.dismissed', true)->assertJsonPath('meta.count', 1);
    });

    it('takes only the member\'s own session', function (Closure $who, int $status) {
        $viewer = $who($this->owner);

        if ($viewer instanceof Staff) {
            $this->actingAs($viewer, 'staff');
        } elseif ($viewer !== null) {
            Sanctum::actingAs($viewer);
        }

        $this->postJson('/api/v1/me/plate-check/dismiss')->assertStatus($status);

        expect($this->owner->refresh()->plate_check_dismissed_at !== null)->toBe($status === 204);
    })->with([
        'guest' => [fn (User $owner): ?User => null, 401],
        'owner' => [fn (User $owner): User => $owner, 204],
        'owner restricted from publishing' => [function (User $owner): User {
            $owner->forceFill(['restrictions' => [RestrictionType::Publishing->value => ['until' => now()->addWeek()->format(DATE_ATOM)]]])->save();

            return $owner->refresh();
        }, 403],
        'staff session' => [fn (User $owner): Staff => Staff::factory()->create(), 401],
    ]);
});

it('takes a photo off the list once GAR-08 pixelates it', function () {
    sigFlag('sig.plate_blur');
    Sanctum::actingAs($this->owner);
    $photo = app(MediaService::class)->storeFromUpload(
        UploadedFile::fake()->createWithContent('heck.jpg', TestImages::jpeg(800, 600)),
        $this->owner,
        s2Post($this->vehicle),
    );
    expect($photo->plate_blur)->toBe(PlateBlurState::Unchecked);
    $this->getJson('/api/v1/me/plate-check')->assertJsonPath('meta.count', 1)->assertJsonPath('data.0.kind', 'build_update');

    $this->patchJson("/api/v1/media/{$photo->id}", ['blur_regions' => [['x' => 0.3, 'y' => 0.7, 'w' => 0.4, 'h' => 0.12]]])->assertOk();

    $this->getJson('/api/v1/me/plate-check')->assertJsonPath('meta.count', 0);
    expect(BuildUpdate::query()->count())->toBe(1);
});
