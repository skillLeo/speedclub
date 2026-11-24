<?php

use App\Models\Block;
use App\Models\FeatureFlag;
use App\Models\ForumCategory;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\User;
use App\Services\Forum\ForumCounters;

require_once __DIR__.'/../Garage/GarageTestHelpers.php';

/**
 * M5.8 forum test helpers, prefixed forum… so they never collide with another file's functions.
 */
function forumFlags(array $flags = []): void
{
    foreach ([...['forum' => true, 'mentions' => true, 'editorial_samples' => false], ...$flags] as $key => $enabled) {
        FeatureFlag::query()->updateOrCreate(['key' => $key], ['enabled' => $enabled, 'description' => $key]);
    }
}

/** A member past pre-moderation: verified, account older than 3 days. */
function forumMember(array $attributes = []): User
{
    return User::factory()->create(['created_at' => now()->subDays(10), ...$attributes]);
}

function forumCategory(array $attributes = []): ForumCategory
{
    return ForumCategory::factory()->create($attributes);
}

function forumThread(?User $author = null, array $attributes = []): ForumThread
{
    $thread = ForumThread::factory()->create([
        'user_id' => ($author ?? forumMember())->id,
        'category_id' => $attributes['category_id'] ?? forumCategory()->id,
        ...$attributes,
    ]);

    return $thread->refresh();
}

function forumReply(ForumThread $thread, ?User $author = null, array $attributes = []): ForumPost
{
    $post = ForumPost::factory()->create(['thread_id' => $thread->id, 'user_id' => ($author ?? forumMember())->id, ...$attributes]);
    app(ForumCounters::class)->thread($thread);

    return $post;
}

function forumOpening(ForumThread $thread): ForumPost
{
    return ForumPost::query()->where('thread_id', $thread->id)->where('is_opening', true)->firstOrFail();
}

function forumBlock(User $blocker, User $blocked): void
{
    Block::query()->create(['blocker_id' => $blocker->id, 'blocked_id' => $blocked->id]);
}

/** @return array<string, mixed> */
function forumThreadPayload(ForumCategory $category, array $overrides = []): array
{
    return [
        'title' => 'Bremsen quietschen nach Belagwechsel',
        'category' => $category->slug,
        'body' => "Nach dem Wechsel auf neue Beläge quietscht es beim leichten Bremsen.\n\n- Beläge: Sportbeläge\n- Scheiben: neu",
        'tags' => ['Bremsen', 'quietschen'],
        ...$overrides,
    ];
}
