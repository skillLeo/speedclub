<?php

use App\Actions\Admin\Forum\HideForumPost;
use App\Actions\Admin\Forum\ReviewForumPost;
use App\Enums\ForumPostStatus;
use App\Enums\ForumThreadStatus;
use App\Enums\GroundDocument;
use App\Enums\ReportTargetType;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\Media;
use App\Models\ModerationCase;
use App\Models\Product;
use App\Models\Staff;
use App\Models\User;
use App\Services\Forum\ForumModeration;
use App\Services\Moderation\ContentRemoval;
use App\Services\Moderation\ContentRestoration;
use App\Services\Moderation\Statement;
use Database\Seeders\StaffSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\Support\TestImages;

require_once __DIR__.'/ForumTestHelpers.php';

/**
 * M5.8 code review (docs/reports/phase-5/review-m5.8.md): MF-2 photos of removed and rejected threads, MF-3 no edit of removed content,
 * SF-2 tombstones, SF-3 solutions on removal, SF-4 soft-deleted photos, SF-5 the stored tree, SF-8 exact tags, SF-9 the photo endpoints
 * and the matrix gaps, and the server nits.
 */
beforeEach(function () {
    forumFlags();
    Storage::fake('public');
    Storage::fake('local');
    $this->author = forumMember(['username' => 'jonas.e46']);
    $this->other = forumMember(['username' => 'lea.gti']);
    $this->thread = forumThread($this->author);
});

function forumPhoto(string $thread, string $name = 'a.jpg', array $headers = []): TestResponse
{
    return test()->post("/api/v1/forum/threads/$thread/photos", ['file' => UploadedFile::fake()->createWithContent($name, TestImages::jpeg(400, 300))], ['Accept' => 'application/json', ...$headers]);
}

function forumCase(ForumPost $post): ModerationCase
{
    return tap(new ModerationCase, fn (ModerationCase $case) => $case->forceFill(['target_type' => ReportTargetType::ForumPost, 'target_id' => $post->id]));
}

/** Runs what a decision does after its commit. */
function forumAfter(array $closures): void
{
    foreach ($closures as $closure) {
        $closure();
    }
}

describe('SF-9 photos of a thread', function () {
    it('adds up to 6 re-encoded photos for the author, replays an Idempotency-Key and removes one', function () {
        Sanctum::actingAs($this->author);
        $first = forumPhoto($this->thread->id, headers: ['Idempotency-Key' => 'ph-1'])->assertCreated()->assertJsonPath('data.status', 'ready')->json('data.id');
        expect(forumPhoto($this->thread->id, headers: ['Idempotency-Key' => 'ph-1'])->json('data.id'))->toBe($first);

        foreach (range(2, 6) as $i) {
            forumPhoto($this->thread->id, "p$i.jpg")->assertCreated();
        }

        forumPhoto($this->thread->id, 'p7.jpg')->assertUnprocessable()->assertJsonValidationErrors('file');
        $this->getJson("/api/v1/forum/threads/{$this->thread->id}")->assertJsonCount(6, 'data.photos')->assertJsonPath('data.has_photos', true);

        $this->deleteJson("/api/v1/forum/threads/{$this->thread->id}/photos/$first")->assertNoContent();
        $this->getJson("/api/v1/forum/threads/{$this->thread->id}")->assertJsonCount(5, 'data.photos');
    });

    it('is the author\'s only and refused under a restriction', function () {
        Sanctum::actingAs($this->author);
        $photo = forumPhoto($this->thread->id)->assertCreated()->json('data.id');

        Sanctum::actingAs($this->other);
        forumPhoto($this->thread->id)->assertForbidden();
        $this->deleteJson("/api/v1/forum/threads/{$this->thread->id}/photos/$photo")->assertForbidden();

        app('auth')->forgetGuards();
        forumPhoto($this->thread->id)->assertUnauthorized();

        $this->author->forceFill(['restrictions' => ['forum' => ['until' => null]]])->save();
        Sanctum::actingAs($this->author->fresh());
        forumPhoto($this->thread->id)->assertForbidden()->assertJsonPath('code', 'account_restricted');
        // Taking one's own photo down stays open.
        $this->deleteJson("/api/v1/forum/threads/{$this->thread->id}/photos/$photo")->assertNoContent();
    });
});

it('MF-2 withdraws the photos of a removed thread and draws them again on restore', function () {
    Sanctum::actingAs($this->author);
    $photoId = forumPhoto($this->thread->id)->assertCreated()->json('data.id');
    $opening = forumOpening($this->thread);
    expect(Media::query()->find($photoId)?->variants)->not->toBeNull();

    $snapshot = app(ContentRestoration::class)->snapshot(forumCase($opening));
    forumAfter(app(ContentRemoval::class)->remove(forumCase($opening)));
    expect(Media::query()->find($photoId)?->variants)->toBeNull()
        ->and(Storage::disk('public')->allFiles())->toBe([]);

    forumAfter(app(ForumModeration::class)->restore($opening->refresh(), $snapshot ?? []));
    expect(Media::query()->find($photoId)?->variants)->not->toBeNull()
        ->and($this->thread->refresh()->status)->toBe(ForumThreadStatus::Published);
});

it('MF-2 withdraws the photos of a thread rejected in pre-moderation', function () {
    $new = User::factory()->create();
    Sanctum::actingAs($new);
    $id = $this->postJson('/api/v1/forum/threads', forumThreadPayload(forumCategory()))->assertCreated()->assertJsonPath('data.status', 'pending')->json('data.id');
    $photoId = forumPhoto($id)->assertCreated()->json('data.id');
    $opening = forumOpening(ForumThread::query()->findOrFail($id));

    app(ReviewForumPost::class)->reject(Staff::factory()->create(), $opening, 'Werbung für einen Shop, bitte ohne.', ReviewForumPost::version($opening));

    expect(Media::query()->find($photoId)?->variants)->toBeNull();
});

it('MF-3 refuses edits of removed or rejected posts and of a removed thread\'s opening post', function () {
    $reply = forumReply($this->thread, $this->other);
    $rejected = forumReply($this->thread, $this->other, ['status' => ForumPostStatus::Rejected, 'published_at' => null]);
    app(ContentRemoval::class)->remove(forumCase($reply));

    Sanctum::actingAs($this->other);
    $this->patchJson("/api/v1/forum/posts/{$reply->id}", ['body' => 'Neu geschrieben'])->assertForbidden();
    $this->patchJson("/api/v1/forum/posts/{$rejected->id}", ['body' => 'Neu geschrieben'])->assertForbidden();

    app(ContentRemoval::class)->remove(forumCase(forumOpening($this->thread)));
    Sanctum::actingAs($this->author);
    $this->patchJson('/api/v1/forum/posts/'.forumOpening($this->thread)->id, ['body' => 'Neu geschrieben'])->assertForbidden();
    $this->patchJson("/api/v1/forum/threads/{$this->thread->id}", ['title' => 'Ein ganz neuer Titel'])->assertForbidden();
});

it('sends an edited rejected thread back to pre-moderation and shows a rejected reply its reason', function () {
    $rejected = forumThread($this->author, ['status' => ForumThreadStatus::Rejected, 'review_reason' => 'Bitte ohne Werbelinks.']);
    $reply = forumReply($this->thread, $this->author, ['status' => ForumPostStatus::Rejected, 'published_at' => null, 'review_reason' => 'Bitte sachlich bleiben.']);
    Sanctum::actingAs($this->author);

    $this->getJson("/api/v1/forum/threads/{$this->thread->id}/posts")->assertOk()->assertJsonPath('data.0.id', $reply->id)
        ->assertJsonPath('data.0.review_reason', 'Bitte sachlich bleiben.');

    $this->patchJson("/api/v1/forum/threads/{$rejected->id}", ['body' => 'Jetzt ohne Links, nur die Frage.'])->assertOk()->assertJsonPath('data.status', 'pending');
    expect(forumOpening($rejected)->status)->toBe(ForumPostStatus::Pending);

    Sanctum::actingAs($this->other);
    $this->getJson("/api/v1/forum/threads/{$this->thread->id}/posts")->assertOk()->assertJsonCount(0, 'data');
});

it('SF-2 keeps a hidden or removed top-level reply as a tombstone while it has visible answers', function () {
    $hidden = forumMember();
    $top = forumReply($this->thread, $hidden);
    $answer = forumReply($this->thread, $this->other, ['parent_id' => $top->id]);
    $removed = forumReply($this->thread, $this->other);
    $answerToRemoved = forumReply($this->thread, $this->author, ['parent_id' => $removed->id]);
    forumReply($this->thread, forumMember(), ['status' => ForumPostStatus::Removed]);
    app(ContentRemoval::class)->remove(forumCase($removed));
    $hidden->forceFill(['status' => 'suspended'])->save();

    $page = $this->getJson("/api/v1/forum/threads/{$this->thread->id}/posts")->assertOk()->assertJsonCount(2, 'data');
    $rows = collect($page->json('data'))->keyBy('id');

    expect($rows[$top->id])->toMatchArray(['deleted' => true, 'author' => null, 'content' => []])
        ->and($rows[$top->id]['replies'][0]['id'])->toBe($answer->id)
        ->and($rows[$removed->id])->toMatchArray(['deleted' => true, 'author' => null])
        ->and($rows[$removed->id]['replies'][0]['id'])->toBe($answerToRemoved->id);
});

it('SF-3 takes "Gelöst" away with a removed solution and brings it back on restore; nit: restore re-pins', function () {
    $this->thread->forceFill(['is_pinned' => true, 'pinned_at' => now()])->save();
    $reply = forumReply($this->thread, $this->other);
    $this->thread->forceFill(['solved_post_id' => $reply->id, 'solved_at' => now()])->save();

    $snapshot = app(ContentRestoration::class)->snapshot(forumCase($reply));
    app(ContentRemoval::class)->remove(forumCase($reply));
    expect($this->thread->refresh()->solved_post_id)->toBeNull()->and($this->thread->solved_at)->toBeNull();
    $this->getJson('/api/v1/forum/threads?sort=solved')->assertOk()->assertJsonCount(0, 'data');

    app(ForumModeration::class)->restore($reply->refresh(), $snapshot ?? []);
    expect($this->thread->refresh()->solved_post_id)->toBe($reply->id);

    $opening = forumOpening($this->thread);
    $openingSnapshot = app(ContentRestoration::class)->snapshot(forumCase($opening));
    app(ContentRemoval::class)->remove(forumCase($opening));
    expect($this->thread->refresh()->is_pinned)->toBeFalse();
    app(ForumModeration::class)->restore($opening->refresh(), $openingSnapshot ?? []);
    expect($this->thread->refresh()->is_pinned)->toBeTrue();
});

it('SF-4 soft-deletes the photos of a deleted thread and keeps the original', function () {
    $alone = forumThread($this->author);
    Sanctum::actingAs($this->author);
    $photoId = forumPhoto($alone->id)->assertCreated()->json('data.id');

    $this->deleteJson("/api/v1/forum/threads/{$alone->id}")->assertNoContent();

    $photo = Media::withTrashed()->find($photoId);
    expect($photo?->trashed())->toBeTrue()->and($photo?->variants)->toBeNull()
        ->and(Storage::disk('local')->exists((string) $photo?->getAttribute('original_path')))->toBeTrue();
});

it('SF-5 stores the parsed tree with the text and keeps it in step with edits', function () {
    Sanctum::actingAs($this->other);
    $id = $this->postJson("/api/v1/forum/threads/{$this->thread->id}/posts", ['body' => 'Erst **fett**'])->assertCreated()->json('data.id');
    expect(ForumPost::query()->find($id)?->content[0]['children'][1])->toMatchArray(['text' => 'fett', 'bold' => true]);

    $this->patchJson("/api/v1/forum/posts/$id", ['body' => 'Jetzt *kursiv*'])->assertOk()->assertJsonPath('data.content.0.children.1.italic', true);
    expect(ForumPost::query()->find($id)?->content[0]['children'][1])->toMatchArray(['text' => 'kursiv', 'italic' => true]);
});

it('SF-8 filters by the exact tag, not by a word of the text', function () {
    $tagged = forumThread($this->author, ['tags' => ['koni', 'räder']]);
    forumThread($this->author, ['title' => 'Koni gegen Bilstein', 'tags' => ['fahrwerk']]);
    forumThread($this->author, ['tags' => ['konix']]);

    $this->getJson('/api/v1/forum/threads?tag=koni')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $tagged->id);
    $this->getJson('/api/v1/forum/threads?tag=R%C3%A4der')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $tagged->id);
});

it('SF-9 matrix gaps: votes across a block and under a restriction, edits under a restriction, product discussions', function () {
    $reply = forumReply($this->thread, $this->other);
    $blocked = forumMember();
    forumBlock($this->other, $blocked);

    Sanctum::actingAs($blocked);
    $this->putJson("/api/v1/forum/posts/{$reply->id}/vote")->assertNotFound();

    Sanctum::actingAs(forumMember(['restrictions' => ['forum' => ['until' => null]]]));
    $this->putJson("/api/v1/forum/posts/{$reply->id}/vote")->assertForbidden()->assertJsonPath('code', 'account_restricted');

    $this->other->forceFill(['restrictions' => ['publishing' => ['until' => null]]])->save();
    Sanctum::actingAs($this->other->fresh());
    $this->patchJson("/api/v1/forum/posts/{$reply->id}", ['body' => 'Geändert'])->assertForbidden()->assertJsonPath('code', 'account_restricted');

    app('auth')->forgetGuards();
    $product = Product::factory()->create();
    $linked = forumThread($this->author, ['product_id' => $product->id]);
    $this->getJson("/api/v1/products/{$product->id}/forum-threads")->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    forumFlags(['parts_catalogue' => true]);
    $this->getJson("/api/v1/products/{$product->id}/forum-threads")->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $linked->id);
});

it('nits: hide refuses unpublished posts; a title edit changes the pre-moderation version', function () {
    $pending = forumReply($this->thread, User::factory()->create(), ['status' => ForumPostStatus::Pending, 'published_at' => null]);
    $statement = new Statement('Der Beitrag beleidigt ein Mitglied.', 'Community-Regeln', GroundDocument::Community);

    $this->seed(StaffSeeder::class);
    $moderator = Staff::factory()->create();
    $moderator->assignRole('moderator');

    expect(fn () => app(HideForumPost::class)->handle($moderator->fresh() ?? $moderator, $pending, $statement, 'Beleidigung geprüft'))->toThrow(DomainException::class);

    $before = ReviewForumPost::version($pending);
    $this->travel(2)->seconds();
    ForumThread::query()->whereKey($this->thread->id)->update(['title' => 'Anderer Titel', 'updated_at' => now()]);
    expect(ReviewForumPost::version($pending))->not->toBe($before);
});
