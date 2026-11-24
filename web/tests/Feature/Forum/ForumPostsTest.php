<?php

use App\Enums\ForumPostStatus;
use App\Enums\ForumThreadStatus;
use App\Enums\NotificationType;
use App\Enums\ReportTargetType;
use App\Models\ForumPost;
use App\Models\ModerationCase;
use App\Models\Notification;
use App\Models\Report;
use App\Models\User;
use App\Services\Forum\ForumModeration;
use App\Services\Moderation\ContentRemoval;
use App\Services\Moderation\ContentRestoration;
use App\Services\Notifications\NotificationPrefs;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/ForumTestHelpers.php';

/**
 * M5.8 FOR-03 (10 §7.2, m5.8-contract §2–§5): replies with one level of answers, pre-moderation, locks, "Hilfreich" (count shown in the
 * forum only), "Gelöst", subscriptions, notifications with their SET-09 switches, blocks, reports into the DSA pipeline and removal.
 */
beforeEach(function () {
    forumFlags();
    $this->author = forumMember(['username' => 'jonas.e46']);
    $this->helper = forumMember(['username' => 'fabian.e92']);
    $this->thread = forumThread($this->author);
});

function forumPostsUrl(string $thread): string
{
    return "/api/v1/forum/threads/$thread/posts";
}

it('replies one level deep and counts published replies', function () {
    Sanctum::actingAs($this->helper);
    $top = $this->postJson(forumPostsUrl($this->thread->id), ['body' => 'Lass die Spur **vermessen**.'])->assertCreated()
        ->assertJsonPath('data.status', 'published')->assertJsonPath('data.content.0.children.1.bold', true)->json('data.id');

    $third = forumMember();
    Sanctum::actingAs($third);
    $answer = $this->postJson(forumPostsUrl($this->thread->id), ['body' => 'Sehe ich auch so', 'parent_id' => $top])->assertCreated()->json('data.id');
    $deeper = $this->postJson(forumPostsUrl($this->thread->id), ['body' => 'Noch tiefer', 'parent_id' => $answer])->assertCreated();
    expect($deeper->json('data.parent_id'))->toBe($top);

    $this->getJson(forumPostsUrl($this->thread->id))->assertOk()->assertJsonCount(1, 'data')->assertJsonCount(2, 'data.0.replies');
    expect($this->thread->refresh()->replies_count)->toBe(3)->and($this->thread->last_poster_id)->toBe($third->id);

    $this->postJson(forumPostsUrl($this->thread->id), ['body' => str_repeat('a', 5001)])->assertUnprocessable()->assertJsonValidationErrors('body');
    $this->postJson(forumPostsUrl($this->thread->id), ['body' => 'x', 'parent_id' => '01JAAAAAAAAAAAAAAAAAAAAAAA'])->assertUnprocessable()->assertJsonValidationErrors('parent_id');
});

it('sanitises the Markdown subset: no HTML, no script links', function () {
    Sanctum::actingAs($this->helper);
    $content = $this->postJson(forumPostsUrl($this->thread->id), ['body' => "<script>alert(1)</script> [klick](javascript:alert(1)) [ok](https://example.com)\n# keine Überschrift"])
        ->assertCreated()->json('data.content');

    $json = json_encode($content);
    expect($json)->not->toContain('javascript:alert(1)"')
        ->and(collect($content[0]['children'])->where('type', 'link')->pluck('href')->all())->toBe(['https://example.com'])
        ->and($content[0]['children'][0]['text'])->toContain('<script>');
});

it('pre-moderates replies of new accounts and refuses locked or pending threads', function () {
    $new = User::factory()->create();
    Sanctum::actingAs($new);
    $id = $this->postJson(forumPostsUrl($this->thread->id), ['body' => 'Erste Antwort'])->assertCreated()->assertJsonPath('data.status', 'pending')->json('data.id');
    $this->getJson(forumPostsUrl($this->thread->id))->assertOk()->assertJsonPath('data.0.id', $id);
    expect($this->thread->refresh()->replies_count)->toBe(0);

    Sanctum::actingAs($this->helper);
    $this->getJson(forumPostsUrl($this->thread->id))->assertOk()->assertJsonCount(0, 'data');

    $locked = forumThread($this->author, ['is_locked' => true]);
    $this->postJson(forumPostsUrl($locked->id), ['body' => 'Hallo'])->assertStatus(409)->assertJsonPath('code', 'forum_thread_closed');

    $pending = forumThread($this->author, ['status' => ForumThreadStatus::Pending]);
    Sanctum::actingAs($this->author);
    $this->postJson(forumPostsUrl($pending->id), ['body' => 'Hallo'])->assertStatus(409)->assertJsonPath('code', 'forum_thread_closed');
});

it('limits replies to 60 a day and replays an Idempotency-Key', function () {
    Sanctum::actingAs($this->helper);
    $first = $this->postJson(forumPostsUrl($this->thread->id), ['body' => 'Einmal'], ['Idempotency-Key' => 'rep-1'])->assertCreated()->json('data.id');
    expect($this->postJson(forumPostsUrl($this->thread->id), ['body' => 'Einmal'], ['Idempotency-Key' => 'rep-1'])->json('data.id'))->toBe($first);

    for ($i = 1; $i < 60; $i++) {
        // The key of the named limiter as ThrottleRequests hashes it.
        RateLimiter::hit(md5('forum-replies'.'forum_replies|user:'.$this->helper->id), 86400);
    }

    $this->postJson(forumPostsUrl($this->thread->id), ['body' => 'Zu viel'])->assertStatus(429)->assertJsonPath('code', 'rate_limited');
});

it('applies the authorisation matrix for replying', function (Closure $who, int $status) {
    $member = $who($this->author);
    if ($member !== null) {
        Sanctum::actingAs($member);
    }

    $this->postJson(forumPostsUrl($this->thread->id), ['body' => 'Meine Antwort'])->assertStatus($status);
})->with([
    'guest' => [fn () => null, 401],
    'member' => [fn () => forumMember(), 201],
    'author' => [fn (User $author) => $author, 201],
    'blocked by the author' => [function (User $author) {
        $member = forumMember();
        forumBlock($author, $member);

        return $member;
    }, 404],
    'publishing restricted' => [fn () => forumMember(['restrictions' => ['publishing' => ['until' => null]]]), 403],
    'forum banned' => [fn () => forumMember(['restrictions' => ['forum' => ['until' => null]]]), 403],
]);

it('lets only the author edit and delete a reply, and keeps answers under a tombstone', function () {
    $reply = forumReply($this->thread, $this->helper);
    $answer = forumReply($this->thread, forumMember(), ['parent_id' => $reply->id]);

    Sanctum::actingAs($this->author);
    $this->patchJson("/api/v1/forum/posts/{$reply->id}", ['body' => 'Fremd'])->assertForbidden();
    $this->deleteJson("/api/v1/forum/posts/{$reply->id}")->assertForbidden();

    Sanctum::actingAs($this->helper);
    $this->patchJson("/api/v1/forum/posts/{$reply->id}", ['body' => 'Korrigiert'])->assertOk()->assertJsonPath('data.body', 'Korrigiert');
    expect($reply->refresh()->edited_at)->not->toBeNull();
    $this->deleteJson("/api/v1/forum/posts/{$reply->id}")->assertNoContent();

    $page = $this->getJson(forumPostsUrl($this->thread->id))->assertOk();
    expect($page->json('data.0.deleted'))->toBeTrue()->and($page->json('data.0.author'))->toBeNull()
        ->and($page->json('data.0.content'))->toBe([])->and($page->json('data.0.replies.0.id'))->toBe($answer->id);

    // The opening post goes with its thread, not alone.
    Sanctum::actingAs($this->author);
    $this->deleteJson('/api/v1/forum/posts/'.forumOpening($this->thread)->id)->assertForbidden();
});

it('counts "Hilfreich" once per member, never on one\'s own post, and sorts by it', function () {
    $good = forumReply($this->thread, $this->helper);
    $other = forumReply($this->thread, forumMember());

    Sanctum::actingAs($this->helper);
    $this->putJson("/api/v1/forum/posts/{$good->id}/vote")->assertUnprocessable()->assertJsonPath('code', 'own_content');

    foreach ([$this->author, forumMember()] as $voter) {
        Sanctum::actingAs($voter);
        $this->putJson("/api/v1/forum/posts/{$good->id}/vote")->assertOk()->assertJsonPath('data.voted', true);
        $this->putJson("/api/v1/forum/posts/{$good->id}/vote")->assertOk();
    }

    expect($good->refresh()->helpful_count)->toBe(2);
    $this->getJson(forumPostsUrl($this->thread->id).'?sort=helpful')->assertOk()->assertJsonPath('data.0.id', $good->id)
        ->assertJsonPath('data.0.helpful_count', 2)->assertJsonPath('data.0.viewer_voted', true)->assertJsonPath('data.1.id', $other->id);
    $this->deleteJson("/api/v1/forum/posts/{$good->id}/vote")->assertOk()->assertJsonPath('data.helpful_count', 1)->assertJsonPath('data.voted', false);

    $this->putJson('/api/v1/forum/posts/'.forumOpening($this->thread)->id.'/vote')->assertForbidden();
    app('auth')->forgetGuards();
    $this->putJson("/api/v1/forum/posts/{$good->id}/vote")->assertUnauthorized();
});

it('lets the thread author mark the solution and tells the reply\'s author', function () {
    $reply = forumReply($this->thread, $this->helper);

    Sanctum::actingAs($this->helper);
    $this->putJson("/api/v1/forum/threads/{$this->thread->id}/solution", ['post_id' => $reply->id])->assertForbidden();

    Sanctum::actingAs($this->author);
    $this->putJson("/api/v1/forum/threads/{$this->thread->id}/solution", ['post_id' => forumOpening($this->thread)->id])->assertUnprocessable()->assertJsonValidationErrors('post_id');
    $this->putJson("/api/v1/forum/threads/{$this->thread->id}/solution", ['post_id' => $reply->id])->assertOk()
        ->assertJsonPath('data.is_solved', true)->assertJsonPath('data.solution.id', $reply->id)->assertJsonPath('data.solution.is_solution', true);

    expect(Notification::query()->where('notifiable_id', $this->helper->id)->where('type', NotificationType::ForumSolved)->count())->toBe(1);

    $this->deleteJson("/api/v1/forum/threads/{$this->thread->id}/solution")->assertOk()->assertJsonPath('data.is_solved', false);
});

it('notifies the author and subscribers of a reply, the answered member, and mentions', function () {
    $subscriber = forumMember(['username' => 'lea.gti']);
    Sanctum::actingAs($subscriber);
    $this->putJson("/api/v1/forum/threads/{$this->thread->id}/subscription")->assertOk();

    Sanctum::actingAs($this->helper);
    $top = $this->postJson(forumPostsUrl($this->thread->id), ['body' => 'Frag mal @lea.gti, die hatte das Problem.'])->assertCreated()->json('data.id');

    expect(Notification::query()->where('notifiable_id', $this->author->id)->where('type', NotificationType::ForumReply)->sole()->data['reply_to'])->toBe('thread')
        ->and(Notification::query()->where('notifiable_id', $subscriber->id)->where('type', NotificationType::ForumReply)->count())->toBe(1)
        ->and(Notification::query()->where('notifiable_id', $subscriber->id)->where('type', NotificationType::ForumMention)->count())->toBe(1)
        ->and(Notification::query()->where('notifiable_id', $this->helper->id)->count())->toBe(0);

    $answerer = forumMember();
    Sanctum::actingAs($answerer);
    $this->postJson(forumPostsUrl($this->thread->id), ['body' => 'Danke dir', 'parent_id' => $top])->assertCreated();
    expect(Notification::query()->where('notifiable_id', $this->helper->id)->where('type', NotificationType::ForumReply)->sole()->data['reply_to'])->toBe('post');

    // HOME-02 hydrates the thread and opens FOR-03 at the post.
    Sanctum::actingAs($this->author);
    $row = collect($this->getJson('/api/v1/notifications')->assertOk()->json('data'))->firstWhere('type', 'forum_reply');
    expect($row['forum_thread']['id'])->toBe($this->thread->id)->and($row['details']['thread_id'])->toBe($this->thread->id)->and($row['actor_count'])->toBe(2);
});

it('has SET-09 switches for every forum notification, on by default', function () {
    foreach ([NotificationType::ForumReply, NotificationType::ForumMention, NotificationType::ForumSolved] as $type) {
        expect($type->pushPreference())->toBe($type->value)
            ->and(NotificationPrefs::defaults()['types'][$type->value]['push'])->toBeTrue()
            ->and(NotificationPrefs::FORUM_CATEGORIES[$type->value])->toBe('forum')
            ->and($type->category())->toBe('social');
    }

    expect(NotificationType::ForumReply->pushThrottleMinutes())->toBe(30);
});

it('sends no notification across a block and none for a pending reply', function () {
    forumBlock($this->author, $this->helper);
    $outsider = forumMember();
    Sanctum::actingAs($outsider);
    $this->putJson("/api/v1/forum/threads/{$this->thread->id}/subscription")->assertOk();

    // The blocked member cannot even see the thread.
    Sanctum::actingAs($this->helper);
    $this->postJson(forumPostsUrl($this->thread->id), ['body' => 'Hallo'])->assertNotFound();

    Sanctum::actingAs(User::factory()->create());
    $this->postJson(forumPostsUrl($this->thread->id), ['body' => 'Ich bin neu hier'])->assertCreated()->assertJsonPath('data.status', 'pending');
    expect(Notification::query()->whereIn('notifiable_id', [$this->author->id, $outsider->id])->count())->toBe(0);
});

it('hides replies across a block either way', function () {
    $blocked = forumMember();
    forumReply($this->thread, $blocked);
    forumReply($this->thread, $this->helper);
    forumBlock($blocked, $this->author);

    Sanctum::actingAs($this->author);
    $this->getJson(forumPostsUrl($this->thread->id))->assertOk()->assertJsonCount(1, 'data');
});

it('takes reports of a thread and a reply into the DSA pipeline', function () {
    $reply = forumReply($this->thread, $this->helper);
    Sanctum::actingAs(forumMember());

    $this->postJson('/api/v1/reports', ['target_type' => 'forum_post', 'target_id' => $reply->id, 'reason' => 'harassment'])->assertCreated();
    $this->postJson('/api/v1/reports', ['target_type' => 'forum_post', 'target_id' => forumOpening($this->thread)->id, 'reason' => 'spam'])->assertCreated();

    $case = ModerationCase::query()->where('target_type', ReportTargetType::ForumPost->value)->where('target_id', $reply->id)->sole();
    expect($case->subject_id)->toBe($this->helper->id)
        ->and(Report::query()->where('case_id', $case->id)->value('target_label'))->toBe($this->thread->title);

    Sanctum::actingAs($this->helper);
    $this->postJson('/api/v1/reports', ['target_type' => 'forum_post', 'target_id' => $reply->id, 'reason' => 'spam'])->assertUnprocessable()->assertJsonPath('code', 'own_content');

    $blocker = forumMember();
    forumBlock($this->helper, $blocker);
    Sanctum::actingAs($blocker);
    $this->postJson('/api/v1/reports', ['target_type' => 'forum_post', 'target_id' => $reply->id, 'reason' => 'spam'])->assertNotFound();
});

it('removes a post or, for the opening post, the whole thread, and restores both', function () {
    $reply = forumReply($this->thread, $this->helper);
    $opening = forumOpening($this->thread);
    $case = fn (ForumPost $post) => tap(new ModerationCase, fn (ModerationCase $c) => $c->forceFill(['target_type' => ReportTargetType::ForumPost, 'target_id' => $post->id]));

    app(ContentRemoval::class)->remove($case($reply));
    expect($reply->refresh()->status)->toBe(ForumPostStatus::Removed)->and($this->thread->refresh()->replies_count)->toBe(0);

    $snapshot = app(ContentRestoration::class)->snapshot($case($opening));
    app(ContentRemoval::class)->remove($case($opening));
    expect($this->thread->refresh()->status)->toBe(ForumThreadStatus::Removed);
    $this->getJson("/api/v1/forum/threads/{$this->thread->id}")->assertNotFound();

    app(ForumModeration::class)->restore($opening->refresh(), $snapshot ?? []);
    expect($this->thread->refresh()->status)->toBe(ForumThreadStatus::Published);
});
