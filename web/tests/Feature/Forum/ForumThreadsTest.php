<?php

use App\Enums\ForumThreadStatus;
use App\Enums\KeywordList;
use App\Enums\ReportTargetType;
use App\Models\ForumCategory;
use App\Models\ForumThread;
use App\Models\KeywordRule;
use App\Models\ModerationCase;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Rules\KeywordNormaliser;
use App\Services\Rules\KeywordRules;
use Illuminate\Support\Facades\Cache;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/ForumTestHelpers.php';

/**
 * M5.8 forum threads (10 §7, m5.8-contract §2–§4): FOR-01/02 lists and sorts, search, Home "Gerade im Forum", "Ähnliche Themen", FOR-03
 * detail, FOR-04 create (pre-moderation, keyword rules, attachments, rate limit, idempotency), edit, delete, FOR-05, the authorisation
 * matrix and blocks.
 */
beforeEach(function () {
    forumFlags();
    $this->category = forumCategory(['slug' => 'fahrwerk', 'name_de' => 'Fahrwerk', 'name_en' => 'Suspension']);
    $this->author = forumMember(['username' => 'jonas.e46']);
    $this->reader = forumMember(['username' => 'lea.gti']);
});

it('answers 404 feature_disabled on every route while the flag is off', function () {
    forumFlags(['forum' => false]);
    $thread = forumThread($this->author, ['category_id' => $this->category->id]);

    $this->getJson('/api/v1/forum/threads')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    $this->getJson('/api/v1/forum/categories')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    $this->getJson("/api/v1/forum/threads/{$thread->id}")->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    $this->getJson('/api/v1/search/threads?q=fahrwerk')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    $this->postJson('/api/v1/forum/threads', forumThreadPayload($this->category))->assertUnauthorized();

    Sanctum::actingAs($this->author);
    $this->postJson('/api/v1/forum/threads', forumThreadPayload($this->category))->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    $this->getJson('/api/v1/me/forum/threads')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
});

it('lists the category tree in the reader\'s language without counts', function () {
    forumCategory(['slug' => 'motor', 'parent_id' => $this->category->id, 'name_de' => 'Motor', 'name_en' => 'Engine']);
    forumCategory(['slug' => 'versteckt', 'parent_id' => $this->category->id, 'is_active' => false]);

    $response = $this->withHeader('Accept-Language', 'en')->getJson('/api/v1/forum/categories')->assertOk();

    $root = collect($response->json('data'))->firstWhere('slug', 'fahrwerk');
    expect($root['name'])->toBe('Suspension')
        ->and(array_column($root['children'], 'slug'))->toBe(['motor'])
        ->and(s2KeysForum($response->json()))->not->toContain('threads_count');

    $this->getJson('/api/v1/forum/categories/fahrwerk')->assertOk()->assertJsonPath('data.slug', 'fahrwerk');
    $this->getJson('/api/v1/forum/categories/versteckt')->assertNotFound();
});

it('creates a thread with its opening post, subscribes the author and shows it to guests', function () {
    Sanctum::actingAs($this->author);

    $response = $this->postJson('/api/v1/forum/threads', forumThreadPayload($this->category))->assertCreated()
        ->assertJsonPath('data.status', 'published')
        ->assertJsonPath('data.title', 'Bremsen quietschen nach Belagwechsel')
        ->assertJsonPath('data.tags', ['bremsen', 'quietschen'])
        ->assertJsonPath('data.category.slug', 'fahrwerk')
        ->assertJsonPath('data.viewer.is_author', true)
        ->assertJsonPath('data.viewer.subscribed', true)
        ->assertJsonPath('data.content.1.type', 'list');

    $id = $response->json('data.id');
    expect($response->json('data.body'))->toContain('Sportbeläge')
        ->and($response->json('data.opening_post_id'))->toBeString()
        ->and($response->json('data.share_url'))->toEndWith("/app/forum/$id");

    app('auth')->forgetGuards();
    $guest = $this->getJson("/api/v1/forum/threads/$id")->assertOk()->assertJsonPath('data.body', null)->assertJsonPath('data.viewer.can_reply', false);
    expect($guest->json('data.content.0.children.0.text'))->toStartWith('Nach dem Wechsel');
    $this->getJson('/api/v1/forum/threads')->assertOk()->assertJsonPath('data.0.id', $id)->assertJsonPath('data.0.replies_count', 0);
});

it('validates the composer', function () {
    Sanctum::actingAs($this->author);

    $this->postJson('/api/v1/forum/threads', [])->assertUnprocessable()->assertJsonValidationErrors(['title', 'category', 'body']);
    $this->postJson('/api/v1/forum/threads', forumThreadPayload($this->category, ['title' => str_repeat('a', 121)]))->assertUnprocessable()->assertJsonValidationErrors('title');
    $this->postJson('/api/v1/forum/threads', forumThreadPayload($this->category, ['body' => str_repeat('a', 10001)]))->assertUnprocessable()->assertJsonValidationErrors('body');
    $this->postJson('/api/v1/forum/threads', forumThreadPayload($this->category, ['tags' => ['a', 'b', 'c', 'd', 'e', 'f']]))->assertUnprocessable()->assertJsonValidationErrors('tags');
    $this->postJson('/api/v1/forum/threads', forumThreadPayload($this->category, ['tags' => ['<b>']]))->assertUnprocessable()->assertJsonValidationErrors('tags.0');
    // Every attempt counts against the 5 a day, refused ones too (throttle runs first).
    Cache::flush();
    $this->postJson('/api/v1/forum/threads', forumThreadPayload($this->category, ['category' => 'gibt-es-nicht']))->assertUnprocessable()->assertJsonValidationErrors('category');
});

it('puts new and unverified accounts into pre-moderation, visible to their author only', function (string $kind) {
    $member = $kind === 'new' ? User::factory()->create() : forumMember(['email_verified_at' => null]);
    Sanctum::actingAs($member);

    $id = $this->postJson('/api/v1/forum/threads', forumThreadPayload($this->category))->assertCreated()->assertJsonPath('data.status', 'pending')->json('data.id');
    $this->getJson("/api/v1/forum/threads/$id")->assertOk()->assertJsonPath('data.status', 'pending');
    $this->getJson('/api/v1/me/forum/threads')->assertOk()->assertJsonPath('data.0.status', 'pending');

    Sanctum::actingAs($this->reader);
    $this->getJson("/api/v1/forum/threads/$id")->assertNotFound();
    $this->getJson('/api/v1/forum/threads')->assertOk()->assertJsonCount(0, 'data');
})->with(['new', 'unverified']);

it('applies keyword rules: block refuses, flag files an automated report', function () {
    foreach (['schrottkarre' => KeywordList::Block, 'kennzeichenfreak' => KeywordList::Flag] as $term => $list) {
        $rule = new KeywordRule;
        $rule->forceFill(['term' => $term, 'normalized' => KeywordNormaliser::term($term), 'list' => $list])->save();
    }
    app(KeywordRules::class)->flush();
    Sanctum::actingAs($this->author);

    $this->postJson('/api/v1/forum/threads', forumThreadPayload($this->category, ['title' => 'Meine Schrottkarre braucht Hilfe']))
        ->assertUnprocessable()->assertJsonPath('code', 'content_blocked')->assertJsonValidationErrors('title');

    $this->postJson('/api/v1/forum/threads', forumThreadPayload($this->category, ['body' => 'Ein Kennzeichenfreak hat mir das empfohlen, was meint ihr?']))->assertCreated();
    expect(ModerationCase::query()->where('target_type', ReportTargetType::ForumPost->value)->count())->toBe(1);
});

it('attaches only the author\'s own vehicle and a mod of it', function () {
    $vehicle = publishedVehicle($this->author);
    $mod = Modification::factory()->create(['vehicle_id' => $vehicle->id]);
    $foreign = publishedVehicle($this->reader);
    Sanctum::actingAs($this->author);

    $this->postJson('/api/v1/forum/threads', forumThreadPayload($this->category, ['vehicle_id' => $foreign->id]))->assertUnprocessable()->assertJsonValidationErrors('vehicle_id');
    $this->postJson('/api/v1/forum/threads', forumThreadPayload($this->category, ['modification_id' => Modification::factory()->create(['vehicle_id' => $foreign->id])->id]))
        ->assertUnprocessable()->assertJsonValidationErrors('modification_id');

    $id = $this->postJson('/api/v1/forum/threads', forumThreadPayload($this->category, ['modification_id' => $mod->id]))->assertCreated()
        ->assertJsonPath('data.vehicle.id', $vehicle->id)->assertJsonPath('data.modification.id', $mod->id)->json('data.id');

    app('auth')->forgetGuards();
    $this->getJson("/api/v1/vehicles/{$vehicle->id}/forum-threads")->assertOk()->assertJsonPath('data.0.id', $id);
    $this->getJson("/api/v1/mods/{$mod->id}/forum-threads")->assertOk()->assertJsonPath('data.0.id', $id);

    // A build that goes private: its chip disappears and its discussions answer 404.
    Vehicle::query()->whereKey($vehicle->id)->update(['visibility' => 'private']);
    $this->getJson("/api/v1/forum/threads/$id")->assertOk()->assertJsonPath('data.vehicle', null);
    $this->getJson("/api/v1/vehicles/{$vehicle->id}/forum-threads")->assertNotFound();
});

it('limits threads to 5 a day and replays an Idempotency-Key', function () {
    Sanctum::actingAs($this->author);

    $first = $this->postJson('/api/v1/forum/threads', forumThreadPayload($this->category), ['Idempotency-Key' => 'thr-1'])->assertCreated()->json('data.id');
    $again = $this->postJson('/api/v1/forum/threads', forumThreadPayload($this->category), ['Idempotency-Key' => 'thr-1'])->assertCreated()->json('data.id');
    expect($again)->toBe($first)->and(ForumThread::query()->count())->toBe(1);

    // The replay counted as an attempt too: three more fill the day.
    for ($i = 0; $i < 3; $i++) {
        $this->postJson('/api/v1/forum/threads', forumThreadPayload($this->category, ['title' => "Frage Nummer $i zum Fahrwerk"]))->assertCreated();
    }

    $this->postJson('/api/v1/forum/threads', forumThreadPayload($this->category))->assertStatus(429)->assertJsonPath('code', 'rate_limited');
});

it('applies the authorisation matrix for creating', function (Closure $who, int $status, ?string $code) {
    $member = $who();
    if ($member !== null) {
        Sanctum::actingAs($member);
    }

    $response = $this->postJson('/api/v1/forum/threads', forumThreadPayload($this->category))->assertStatus($status);

    if ($code !== null) {
        $response->assertJsonPath('code', $code);
    }
})->with([
    'guest' => [fn () => null, 401, 'unauthenticated'],
    'member' => [fn () => forumMember(), 201, null],
    'publishing restricted' => [fn () => forumMember(['restrictions' => ['publishing' => ['until' => null]]]), 403, 'account_restricted'],
    'forum banned' => [fn () => forumMember(['restrictions' => ['forum' => ['until' => now()->addWeek()->toIso8601String()]]]), 403, 'account_restricted'],
    'forum ban over' => [fn () => forumMember(['restrictions' => ['forum' => ['until' => now()->subDay()->toIso8601String()]]]), 201, null],
    'suspended' => [fn () => User::factory()->suspended()->create(['created_at' => now()->subDays(10)]), 403, null],
]);

it('lets only the author edit and delete, and keeps a thread others answered', function () {
    $thread = forumThread($this->author, ['category_id' => $this->category->id]);
    $other = forumCategory(['slug' => 'bremsen']);

    Sanctum::actingAs($this->reader);
    $this->patchJson("/api/v1/forum/threads/{$thread->id}", ['title' => 'Übernommen von jemand anderem'])->assertForbidden();
    $this->deleteJson("/api/v1/forum/threads/{$thread->id}")->assertForbidden();

    Sanctum::actingAs($this->author);
    $this->patchJson("/api/v1/forum/threads/{$thread->id}", ['title' => 'Gewindefahrwerk im Alltag: Erfahrungen?', 'category' => 'bremsen', 'tags' => ['gewinde']])->assertOk()
        ->assertJsonPath('data.title', 'Gewindefahrwerk im Alltag: Erfahrungen?')
        ->assertJsonPath('data.category.slug', 'bremsen')
        ->assertJsonPath('data.tags', ['gewinde']);
    expect($thread->refresh()->edited_at)->not->toBeNull()->and($thread->category_id)->toBe($other->id);

    forumReply($thread, $this->reader);
    $this->deleteJson("/api/v1/forum/threads/{$thread->id}")->assertStatus(409)->assertJsonPath('code', 'forum_thread_has_replies');

    $alone = forumThread($this->author, ['category_id' => $this->category->id]);
    $this->deleteJson("/api/v1/forum/threads/{$alone->id}")->assertNoContent();
    $this->getJson("/api/v1/forum/threads/{$alone->id}")->assertNotFound();

    // Deleting stays open under a restriction; editing does not.
    $this->author->forceFill(['restrictions' => ['forum' => ['until' => null]]])->save();
    $this->patchJson("/api/v1/forum/threads/{$thread->id}", ['title' => 'Noch ein neuer Titel hier'])->assertForbidden()->assertJsonPath('code', 'account_restricted');
});

it('sorts by activity with pinned first, new, unanswered and solved', function () {
    $old = forumThread($this->author, ['category_id' => $this->category->id, 'last_activity_at' => now()->subDays(3), 'published_at' => now()->subDays(3)]);
    $pinned = forumThread($this->author, ['category_id' => $this->category->id, 'is_pinned' => true, 'last_activity_at' => now()->subDays(5), 'published_at' => now()->subDays(5)]);
    $answered = forumThread($this->author, ['category_id' => $this->category->id, 'published_at' => now()->subDays(2)]);
    $reply = forumReply($answered, $this->reader);
    $answered->forceFill(['solved_post_id' => $reply->id, 'solved_at' => now()])->save();

    $ids = fn (string $sort) => array_column($this->getJson("/api/v1/forum/threads?sort=$sort")->assertOk()->json('data'), 'id');

    expect($ids('active'))->toBe([$pinned->id, $answered->id, $old->id])
        ->and($ids('new'))->toBe([$answered->id, $old->id, $pinned->id])
        ->and($ids('unanswered'))->toBe([$old->id, $pinned->id])
        ->and($ids('solved'))->toBe([$answered->id]);

    $row = collect($this->getJson('/api/v1/forum/threads?sort=solved')->json('data'))->first();
    expect($row['is_solved'])->toBeTrue()->and($row['replies_count'])->toBe(1)->and($row['last_poster']['username'])->toBe('lea.gti');

    // Cursor pages.
    $first = $this->getJson('/api/v1/forum/threads?per_page=2')->assertOk();
    $this->getJson('/api/v1/forum/threads?per_page=2&cursor='.$first->json('meta.next_cursor'))->assertOk()->assertJsonPath('data.0.id', $old->id);
    $this->getJson('/api/v1/forum/threads?cursor=abc')->assertUnprocessable();
    $this->getJson('/api/v1/forum/threads?category=unbekannt')->assertNotFound();
});

it('filters by a parent category including its children, and by tag', function () {
    $child = forumCategory(['slug' => 'gewinde', 'parent_id' => $this->category->id]);
    $inChild = forumThread($this->author, ['category_id' => $child->id, 'tags' => ['koni']]);
    forumThread($this->author, ['category_id' => forumCategory()->id]);

    $this->getJson('/api/v1/forum/threads?category=fahrwerk')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $inChild->id);
    $this->getJson('/api/v1/forum/threads?tag=koni')->assertOk()->assertJsonCount(1, 'data');
});

it('searches titles, texts and tags without FULLTEXT', function () {
    $match = forumThread($this->author, ['category_id' => $this->category->id, 'title' => 'Bilstein B16 auf der Nordschleife?']);
    forumThread($this->author, ['category_id' => $this->category->id, 'title' => 'Welche Politur für schwarzen Lack']);

    $this->getJson('/api/v1/search/threads?q=bilstein')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $match->id);
    $this->getJson('/api/v1/search/threads?q=zugstufe')->assertOk()->assertJsonCount(2, 'data');
    $this->getJson('/api/v1/search/threads?q=Müller')->assertOk()->assertJsonCount(0, 'data');
    $this->getJson('/api/v1/search/threads')->assertUnprocessable()->assertJsonValidationErrors('q');
});

it('suggests similar threads while typing the title, members only', function () {
    $similar = forumThread($this->author, ['category_id' => $this->category->id, 'title' => 'Bremsen quietschen nach dem Wechsel']);
    forumThread($this->author, ['category_id' => $this->category->id, 'title' => 'Ölwechsel Intervall beim S2000']);

    $this->getJson('/api/v1/forum/similar?title=Bremsen+quietschen')->assertUnauthorized();

    Sanctum::actingAs($this->reader);
    $this->getJson('/api/v1/forum/similar?title=Meine+Bremsen+quietschen+laut')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $similar->id);
    $this->getJson('/api/v1/forum/similar?title=Hallo+wie+geht')->assertOk()->assertJsonCount(0, 'data');
    $this->getJson('/api/v1/forum/similar?title=ab')->assertUnprocessable();
});

it('shows Home "Gerade im Forum": at most 3 threads active in the last 14 days', function () {
    forumThread($this->author, ['category_id' => $this->category->id, 'last_activity_at' => now()->subDays(20)]);
    foreach (range(1, 4) as $i) {
        forumThread($this->author, ['category_id' => $this->category->id, 'last_activity_at' => now()->subHours($i)]);
    }

    $this->getJson('/api/v1/forum/active')->assertOk()->assertJsonCount(3, 'data');
});

it('hides threads across a block either way, and of hidden or suspended authors', function () {
    $thread = forumThread($this->author, ['category_id' => $this->category->id]);
    forumBlock($this->author, $this->reader);

    Sanctum::actingAs($this->reader);
    $this->getJson("/api/v1/forum/threads/{$thread->id}")->assertNotFound();
    $this->getJson('/api/v1/forum/threads')->assertOk()->assertJsonCount(0, 'data');
    $this->postJson("/api/v1/forum/threads/{$thread->id}/posts", ['body' => 'Hallo'])->assertNotFound();

    Sanctum::actingAs($this->author);
    $this->getJson("/api/v1/forum/threads/{$thread->id}")->assertOk();

    app('auth')->forgetGuards();
    $this->author->forceFill(['status' => 'suspended'])->save();
    $this->getJson("/api/v1/forum/threads/{$thread->id}")->assertNotFound();
});

it('hides sample threads while editorial samples are off and badges them otherwise', function () {
    $sampleAuthor = forumMember(['is_sample' => true]);
    $thread = forumThread($sampleAuthor, ['category_id' => $this->category->id, 'is_sample' => true]);

    $this->getJson("/api/v1/forum/threads/{$thread->id}")->assertNotFound();

    forumFlags(['editorial_samples' => true]);
    $this->getJson("/api/v1/forum/threads/{$thread->id}")->assertOk()->assertJsonPath('data.is_sample', true);
});

it('lists my threads and my subscriptions', function () {
    $mine = forumThread($this->author, ['category_id' => $this->category->id]);
    $theirs = forumThread($this->reader, ['category_id' => $this->category->id]);
    Sanctum::actingAs($this->author);

    $this->putJson("/api/v1/forum/threads/{$theirs->id}/subscription")->assertOk()->assertJsonPath('data.subscribed', true);
    $this->getJson('/api/v1/me/forum/threads')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $mine->id);
    // The author follows their own thread from the start.
    expect(array_column($this->getJson('/api/v1/me/forum/subscriptions')->assertOk()->json('data'), 'id'))->toEqualCanonicalizing([$mine->id, $theirs->id]);
    $this->deleteJson("/api/v1/forum/threads/{$theirs->id}/subscription")->assertOk()->assertJsonPath('data.subscribed', false);
    expect(array_column($this->getJson('/api/v1/me/forum/subscriptions')->assertOk()->json('data'), 'id'))->toBe([$mine->id]);
    expect(ForumCategory::query()->find($this->category->id)?->threads_count)->toBeInt();
});

it('lets a merged thread point to its target', function () {
    $target = forumThread($this->author, ['category_id' => $this->category->id]);
    $merged = forumThread($this->reader, ['category_id' => $this->category->id, 'status' => ForumThreadStatus::Merged, 'merged_into_id' => $target->id]);

    $this->getJson("/api/v1/forum/threads/{$merged->id}")->assertOk()->assertJsonPath('data.status', 'merged')->assertJsonPath('data.merged_into.id', $target->id);
});

/**
 * Every key anywhere in a decoded JSON body.
 *
 * @return list<string>
 */
function s2KeysForum(mixed $value): array
{
    if (! is_array($value)) {
        return [];
    }

    $keys = [];
    foreach ($value as $key => $child) {
        if (is_string($key)) {
            $keys[] = $key;
        }
        $keys = [...$keys, ...s2KeysForum($child)];
    }

    return $keys;
}
