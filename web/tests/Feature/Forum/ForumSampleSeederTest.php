<?php

use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\Media;
use App\Models\Vehicle;
use Database\Seeders\DemoShowcaseSeeder;
use Database\Seeders\ForumCategorySeeder;
use Database\Seeders\ForumSampleSeeder;
use Illuminate\Support\Facades\Storage;

require_once __DIR__.'/ForumTestHelpers.php';

/**
 * DQ-P5-005 (design QA P5 r1): the forum samples carry the author's own showcase car where the topic is about it and topic-true licensed
 * photos on the opening post (graded seed photos through the media pipeline); a host that already ran the seeder gets them on a re-run,
 * counts, answers and votes untouched.
 */
beforeEach(function () {
    forumFlags(['editorial_samples' => true]);
    Storage::fake('public');
    Storage::fake('local');
    config(['speedclub.media.disk' => 'public']);
    $this->seed(ForumCategorySeeder::class);
    $this->jonas = forumMember(['username' => 'jonas.e46', 'is_sample' => true]);
    $this->e46 = Vehicle::factory()->published()->create(['owner_id' => $this->jonas->id, 'public_id' => DemoShowcaseSeeder::publicIdFor('jonas-e46')]);

    foreach (['fabian.e92', 'robin.e30', 'nora.m3'] as $username) {
        forumMember(['username' => $username, 'is_sample' => true]);
    }
});

it('attaches the author\'s car and a topic-true photo, and re-runs without changes', function () {
    $this->seed(ForumSampleSeeder::class);

    $thread = ForumThread::query()->where('title', 'Gewindefahrwerk im Alltag: wie hart ist zu hart?')->firstOrFail();
    $opening = forumOpening($thread);
    $photos = Media::query()->where('mediable_type', 'forum_post')->where('mediable_id', $opening->id)->get();

    expect($thread->vehicle_id)->toBe($this->e46->id)
        ->and($thread->is_sample)->toBeTrue()
        ->and($photos->pluck('sample_source')->all())->toBe([ForumSampleSeeder::PHOTO_SOURCE.'generic-wheels-03.jpg'])
        ->and($photos->first()?->getAttribute('variants'))->not->toBeNull();

    $this->getJson("/api/v1/forum/threads/{$thread->id}")->assertOk()->assertJsonPath('data.vehicle.id', $this->e46->id)
        ->assertJsonCount(1, 'data.photos')->assertJsonPath('data.has_photos', true);

    $replies = $thread->replies_count;
    $this->seed(ForumSampleSeeder::class);
    expect(Media::query()->where('mediable_type', 'forum_post')->pluck('id')->all())->toBe($photos->modelKeys())
        ->and($thread->fresh()?->replies_count)->toBe($replies);
});

it('brings an earlier host\'s samples in line: car and photos added, nothing else changed', function () {
    $this->seed(ForumSampleSeeder::class);
    $thread = ForumThread::query()->where('title', 'Gewindefahrwerk im Alltag: wie hart ist zu hart?')->firstOrFail();
    $opening = forumOpening($thread);
    Media::query()->where('mediable_id', $opening->id)->forceDelete();
    $thread->forceFill(['vehicle_id' => null])->save();
    $posts = ForumPost::query()->count();

    $this->seed(ForumSampleSeeder::class);

    expect($thread->fresh()?->vehicle_id)->toBe($this->e46->id)
        ->and(Media::query()->where('mediable_id', $opening->id)->count())->toBe(1)
        ->and(ForumPost::query()->count())->toBe($posts)
        ->and(ForumThread::query()->where('is_sample', true)->count())->toBeGreaterThan(0);
});

it('swaps a photo the data no longer lists on a re-run (DQ-P5-041: the badge close-up goes, the wheel-arch shot comes)', function () {
    $this->seed(ForumSampleSeeder::class);
    $thread = ForumThread::query()->where('title', 'Gewindefahrwerk im Alltag: wie hart ist zu hart?')->firstOrFail();
    $opening = forumOpening($thread);
    $old = Media::query()->where('mediable_id', $opening->id)->firstOrFail();
    $old->forceFill(['sample_source' => ForumSampleSeeder::PHOTO_SOURCE.'bmw-detail-01.jpg'])->save();

    $this->seed(ForumSampleSeeder::class);

    expect(Media::query()->where('mediable_id', $opening->id)->pluck('sample_source')->all())->toBe([ForumSampleSeeder::PHOTO_SOURCE.'generic-wheels-03.jpg'])
        ->and(Media::query()->whereKey($old->id)->exists())->toBeFalse();
});

it('never leads a thread with a make-badge close-up (DQ-P5-041)', function () {
    /** @var list<array<string, mixed>> $threads */
    $threads = json_decode((string) file_get_contents(database_path('data/showcase/forum.json')), true);
    $photos = collect($threads)->flatMap(fn (array $thread): array => (array) ($thread['photos'] ?? []));

    expect($photos)->not->toBeEmpty()
        ->and($photos->filter(fn (string $file): bool => preg_match('/^(?!generic-)[a-z0-9]+-detail-/', $file) === 1)->all())->toBe([])
        ->and($photos->duplicates()->all())->toBe([]);
});
