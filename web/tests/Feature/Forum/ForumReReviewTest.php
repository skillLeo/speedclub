<?php

use App\Actions\Admin\Forum\ReviewForumPost;
use App\Enums\ForumPostStatus;
use App\Enums\ForumThreadStatus;
use App\Jobs\Forum\NotifyForumPost;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\Staff;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Storage;
use Inertia\Testing\AssertableInertia;
use Laravel\Sanctum\Sanctum;
use Tests\Support\TestImages;

require_once __DIR__.'/ForumTestHelpers.php';
require_once __DIR__.'/../Admin/Support/helpers.php';

/**
 * SEC-P5-09 (docs/reports/security/phase-5.md, Phase 5 exit gate): pre-moderation does not end at the first approval. While the author
 * is still inside the window, an edit of a published reply or thread and a new photo go back to review, show in the ADM queue again,
 * stay hidden from others and come back with the approval; a turned-down change takes the post (and an opening post its thread) down.
 */
beforeEach(function () {
    forumFlags();
    Storage::fake('public');
    Storage::fake('local');
    $this->thread = forumThread(forumMember());
    $this->new = User::factory()->create(['created_at' => now()->subHour()]);
});

function rrApprove(ForumPost $post): ForumPost
{
    $post = $post->fresh() ?? $post;

    return app(ReviewForumPost::class)->approve(Staff::factory()->create(), $post, null, ReviewForumPost::version($post));
}

function rrReject(ForumPost $post): ForumPost
{
    $post = $post->fresh() ?? $post;

    return app(ReviewForumPost::class)->reject(Staff::factory()->create(), $post, 'Werbung für einen Shop, bitte ohne Links.', ReviewForumPost::version($post));
}

function rrAs(?User $member): void
{
    app('auth')->forgetGuards();

    if ($member !== null) {
        Sanctum::actingAs($member);
    }
}

/** A thread of $author that staff approved; returns it with its opening post. */
function rrApprovedThread(User $author): array
{
    rrAs($author);
    $id = test()->postJson('/api/v1/forum/threads', forumThreadPayload(forumCategory()))->assertCreated()->assertJsonPath('data.status', 'pending')->json('data.id');
    $thread = ForumThread::query()->findOrFail($id);
    rrApprove(forumOpening($thread));

    return [$thread->refresh(), forumOpening($thread)];
}

it('sends a new account\'s edit of an approved reply back to review, into the ADM queue, and back in its place on approval', function () {
    rrAs($this->new);
    $id = $this->postJson("/api/v1/forum/threads/{$this->thread->id}/posts", ['body' => 'Danke, das hilft mir weiter.'])->assertCreated()->json('data.id');
    $approved = rrApprove(ForumPost::query()->findOrFail($id));
    $publishedAt = $approved->published_at;

    expect($this->thread->refresh()->replies_count)->toBe(1);

    rrAs($this->new);
    $this->patchJson("/api/v1/forum/posts/$id", ['body' => 'Danke, das hilft mir weiter. Nachtrag: Drehmoment 120 Nm.'])
        ->assertOk()->assertJsonPath('data.status', 'pending')->assertJsonPath('data.viewer.can_edit', true);

    $post = ForumPost::query()->findOrFail($id);
    expect($post->status)->toBe(ForumPostStatus::Pending)->and($post->reviewed_at)->toBeNull()
        ->and($this->thread->refresh()->replies_count)->toBe(0);

    // The author sees it "In Prüfung", a guest does not see it at all.
    $this->getJson("/api/v1/forum/threads/{$this->thread->id}/posts")->assertOk()->assertJsonPath('data.0.status', 'pending');
    rrAs(null);
    $this->getJson("/api/v1/forum/threads/{$this->thread->id}/posts")->assertOk()->assertJsonCount(0, 'data');

    // ADM Forum-Moderation lists it again, with the reason.
    seedStaffRoles();
    actingAsStaff(staffWithRole('moderator'));
    $this->get('/admin/forum')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component('Forum/Queue')
        ->where('counts.pending', 1)->where('rows.data.0.id', $id)->where('rows.data.0.author.reason', 'new_account'));

    // Approved again: back in its place, no second "new reply" to the subscribers.
    Bus::fake([NotifyForumPost::class]);
    $back = rrApprove($post);
    Bus::assertNotDispatched(NotifyForumPost::class);

    expect($back->status)->toBe(ForumPostStatus::Published)->and($back->published_at?->equalTo($publishedAt))->toBeTrue()
        ->and($this->thread->refresh()->replies_count)->toBe(1);
    rrAs(null);
    $this->getJson("/api/v1/forum/threads/{$this->thread->id}/posts")->assertOk()->assertSee('Drehmoment 120 Nm');
});

it('holds the opening post of a published thread on a text edit: listed, text hidden from others, "In Prüfung" for the author', function () {
    [$thread, $opening] = rrApprovedThread($this->new);

    rrAs($this->new);
    $this->patchJson("/api/v1/forum/threads/{$thread->id}", ['body' => 'Neue Fassung mit Bildern vom Sattel.'])->assertOk()
        ->assertJsonPath('data.status', 'pending');

    expect($thread->refresh()->status)->toBe(ForumThreadStatus::Published)->and($opening->refresh()->status)->toBe(ForumPostStatus::Pending);
    $this->getJson("/api/v1/forum/threads/{$thread->id}")->assertOk()->assertJsonPath('data.status', 'pending')->assertSee('Neue Fassung');

    rrAs(forumMember());
    $this->getJson("/api/v1/forum/threads/{$thread->id}")->assertOk()->assertJsonPath('data.status', 'published')
        ->assertJsonPath('data.content', [])->assertJsonPath('data.title', 'Bremsen quietschen nach Belagwechsel')->assertDontSee('Neue Fassung');
    expect(array_column($this->getJson('/api/v1/forum/threads')->assertOk()->json('data'), 'id'))->toContain($thread->id);

    rrApprove($opening);
    rrAs(null);
    $this->getJson("/api/v1/forum/threads/{$thread->id}")->assertOk()->assertSee('Neue Fassung');
});

it('holds a photo a new account adds to its approved thread until staff approve it', function () {
    [$thread, $opening] = rrApprovedThread($this->new);

    rrAs($this->new);
    $this->post("/api/v1/forum/threads/{$thread->id}/photos", ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300))], ['Accept' => 'application/json'])
        ->assertCreated();
    $this->getJson("/api/v1/forum/threads/{$thread->id}")->assertOk()->assertJsonCount(1, 'data.photos');

    expect($opening->refresh()->status)->toBe(ForumPostStatus::Pending);
    rrAs(null);
    $this->getJson("/api/v1/forum/threads/{$thread->id}")->assertOk()->assertJsonCount(0, 'data.photos')->assertJsonPath('data.has_photos', false);

    rrApprove($opening);
    $this->getJson("/api/v1/forum/threads/{$thread->id}")->assertOk()->assertJsonCount(1, 'data.photos');
});

it('takes the whole thread back to pending on a new title, and a turned-down change rejects it until the author resubmits', function () {
    [$thread, $opening] = rrApprovedThread($this->new);
    $publishedAt = $thread->published_at;

    rrAs($this->new);
    $this->patchJson("/api/v1/forum/threads/{$thread->id}", ['title' => 'Felgen zum halben Preis'])->assertOk()->assertJsonPath('data.status', 'pending');
    expect($thread->refresh()->status)->toBe(ForumThreadStatus::Pending)->and($opening->refresh()->status)->toBe(ForumPostStatus::Pending);

    rrAs(null);
    $this->getJson("/api/v1/forum/threads/{$thread->id}")->assertNotFound();

    rrReject($opening);
    expect($thread->refresh()->status)->toBe(ForumThreadStatus::Rejected);

    rrAs($this->new);
    $this->patchJson("/api/v1/forum/threads/{$thread->id}", ['title' => 'Bremsen quietschen nach Belagwechsel'])->assertOk()->assertJsonPath('data.status', 'pending');
    rrApprove(forumOpening($thread));

    expect($thread->refresh()->status)->toBe(ForumThreadStatus::Published)->and($thread->published_at?->equalTo($publishedAt))->toBeTrue();
});

it('takes a published thread down when staff turn down the change of its opening post', function () {
    [$thread, $opening] = rrApprovedThread($this->new);

    rrAs($this->new);
    $this->patchJson("/api/v1/forum/posts/{$opening->id}", ['body' => 'Jetzt mit Link zum Shop.'])->assertOk()->assertJsonPath('data.status', 'pending');
    expect($thread->refresh()->status)->toBe(ForumThreadStatus::Published);

    rrReject($opening);

    expect($thread->refresh()->status)->toBe(ForumThreadStatus::Rejected)->and($opening->refresh()->status)->toBe(ForumPostStatus::Rejected);
    rrAs(null);
    $this->getJson("/api/v1/forum/threads/{$thread->id}")->assertNotFound();
});

it('holds an unverified account too, and leaves a member past the window alone', function () {
    $unverified = User::factory()->create(['created_at' => now()->subDays(10), 'email_verified_at' => null]);
    $reply = forumReply($this->thread, $unverified, ['body' => 'Erste Fassung.']);
    rrAs($unverified);
    $this->patchJson("/api/v1/forum/posts/{$reply->id}", ['body' => 'Zweite Fassung.'])->assertOk()->assertJsonPath('data.status', 'pending');

    [$thread, $opening] = rrApprovedThread($this->new);
    $this->travel(4)->days();
    rrAs($this->new->refresh());
    $this->patchJson("/api/v1/forum/threads/{$thread->id}", ['title' => 'Bremsen quietschen immer noch', 'body' => 'Nachtrag nach vier Tagen.'])
        ->assertOk()->assertJsonPath('data.status', 'published');
    expect($opening->refresh()->status)->toBe(ForumPostStatus::Published);
});
