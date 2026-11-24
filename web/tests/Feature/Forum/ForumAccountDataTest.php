<?php

use App\Enums\ForumPostStatus;
use App\Enums\UserStatus;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\Mention;
use App\Models\User;
use App\Services\Account\HardDeleteAccount;
use App\Services\Auth\MemberSessions;
use App\Services\DataExport\ExportContents;
use App\Services\Forum\ForumCounters;
use App\Services\Media\MediaService;
use App\Services\PublicPages\OgImages;
use App\Services\Qr\QrCodes;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/ForumTestHelpers.php';

/**
 * M5.8 and GDPR: forum.json in the data export (Art. 15/20: own threads, own posts, own votes and subscriptions; other members only as
 * a thread's title), and the hard delete of an account (m5.8-contract D8: own posts go, threads keep their title and others' replies,
 * a thread nobody else wrote in goes, others' answers stay as top-level replies, counters recounted).
 */
beforeEach(function () {
    forumFlags();
    $this->member = forumMember(['username' => 'jonas.e46']);
    $this->other = forumMember(['username' => 'lea.gti']);
});

function forumExport(User $user): array
{
    return json_decode((string) json_encode(app(ExportContents::class)->documents($user->fresh() ?? $user)), true)['forum.json'];
}

function forumHardDelete(User $user): void
{
    $user->forceFill(['status' => UserStatus::Deactivated, 'deletion_requested_at' => now()->subDays(31)])->save();
    (new HardDeleteAccount($user->id))->handle(app(MediaService::class), app(QrCodes::class), app(MemberSessions::class), app(OgImages::class));
}

it('exports the member\'s own threads, posts, votes and subscriptions, others only by thread title', function () {
    $mine = forumThread($this->member, ['title' => 'Mein Fahrwerk-Thema', 'tags' => ['gewinde']]);
    $theirs = forumThread($this->other, ['title' => 'Bremsen quietschen']);
    $reply = forumReply($theirs, $this->member, ['body' => 'Lass die **Beläge** anfasen.']);
    $theirs->forceFill(['solved_post_id' => $reply->id])->save();
    $theirReply = forumReply($theirs, $this->other, ['body' => 'Geheimer Text eines anderen Mitglieds']);
    forumReply($mine, $this->other, ['body' => 'Antwort eines anderen Mitglieds']);
    $deleted = forumReply($theirs, $this->member, ['body' => 'Gelöscht, aber noch in der Frist']);
    $deleted->delete();

    Sanctum::actingAs($this->member);
    $this->putJson("/api/v1/forum/posts/{$theirReply->id}/vote")->assertOk();
    $this->putJson("/api/v1/forum/threads/{$theirs->id}/subscription")->assertOk();

    $forum = forumExport($this->member);

    expect(array_column($forum['threads'], 'title'))->toBe(['Mein Fahrwerk-Thema'])
        ->and($forum['threads'][0])->toMatchArray(['status' => 'published', 'tags' => ['gewinde'], 'solved' => false])
        ->and($forum['threads'][0])->toHaveKeys(['category', 'created_at', 'edited_at', 'deleted_at'])
        ->and($forum['posts'])->toHaveCount(3)
        ->and(collect($forum['posts'])->firstWhere('kind', 'opening')['thread_title'])->toBe('Mein Fahrwerk-Thema')
        ->and(collect($forum['posts'])->firstWhere('id', $reply->id))->toMatchArray(['kind' => 'reply', 'thread_title' => 'Bremsen quietschen', 'text' => 'Lass die **Beläge** anfasen.', 'is_solution' => true, 'status' => 'published'])
        ->and(collect($forum['posts'])->firstWhere('id', $deleted->id)['deleted_at'])->not->toBeNull()
        ->and($forum['helpful_votes'])->toHaveCount(1)
        ->and($forum['helpful_votes'][0])->toMatchArray(['post_id' => $theirReply->id, 'thread_title' => 'Bremsen quietschen'])
        ->and(array_column($forum['subscriptions'], 'thread_title'))->toEqualCanonicalizing(['Mein Fahrwerk-Thema', 'Bremsen quietschen']);

    $json = json_encode($forum);
    expect($json)->not->toContain('Geheimer Text')->not->toContain('Antwort eines anderen')->not->toContain('lea.gti')->not->toContain($this->other->id);
});

it('lists forum.json in the export with a README line in both languages', function () {
    expect(array_keys(app(ExportContents::class)->documents($this->member)))->toContain('forum.json');

    foreach (['de', 'en'] as $locale) {
        expect(trans('settings.export.readme.files', [], $locale))->toHaveKey('forum.json');
    }
});

it('keeps forum bans in moderation_decisions.json and the profile restrictions', function () {
    $this->member->forceFill(['restrictions' => ['forum' => ['until' => null, 'decision_id' => null]]])->save();

    expect(app(ExportContents::class)->documents($this->member->fresh())['profile.json']['restrictions'])->toHaveKey('forum');
});

it('deletes the member\'s posts with the account, keeps titles and others\' replies, drops threads nobody else wrote in', function () {
    $kept = forumThread($this->member, ['title' => 'Bleibt mit Titel']);
    $answerToKept = forumReply($kept, $this->other, ['body' => 'Wertvolle Antwort']);
    $alone = forumThread($this->member, ['title' => 'Nur von mir']);
    $theirs = forumThread($this->other, ['title' => 'Fremdes Thema']);
    $myReply = forumReply($theirs, $this->member, ['body' => 'Meine Antwort @lea.gti']);
    $theirAnswer = forumReply($theirs, $this->other, ['parent_id' => $myReply->id, 'body' => 'Antwort auf meine Antwort']);
    $theirs->forceFill(['solved_post_id' => $myReply->id, 'solved_at' => now()])->save();
    DB::table('forum_votes')->insert(['post_id' => $answerToKept->id, 'user_id' => $this->member->id, 'created_at' => now()]);
    ForumPost::query()->whereKey($answerToKept->id)->update(['helpful_count' => 1]);
    Mention::query()->create(['mentionable_type' => 'forum_post', 'mentionable_id' => $myReply->id, 'mentioned_user_id' => $this->other->id, 'author_id' => $this->member->id]);
    app(ForumCounters::class)->thread($theirs);
    expect($theirs->refresh()->replies_count)->toBe(2);

    $keptRow = ForumThread::query()->findOrFail($kept->id);
    expect($keptRow->search_keys)->toContain(' zugstufe ')->and($keptRow->tags)->toBe(['fahrwerk']);

    forumHardDelete($this->member);

    // MF-1 (GDPR Art. 17): no word of the erased opening text and none of the member's tags stays findable; the title does (D8).
    $keptRow = ForumThread::query()->findOrFail($kept->id);
    expect($keptRow->search_keys)->not->toContain('zugstufe')->toContain(' bleibt ')
        ->and($keptRow->tags)->toBeNull();
    expect(array_column($this->getJson('/api/v1/search/threads?q=zugstufe')->assertOk()->json('data'), 'id'))->not->toContain($kept->id);

    expect(User::withTrashed()->find($this->member->id))->toBeNull()
        ->and(ForumPost::withTrashed()->where('user_id', $this->member->id)->exists())->toBeFalse()
        ->and(ForumThread::withTrashed()->find($alone->id))->toBeNull()
        ->and(ForumThread::query()->find($kept->id))->toMatchArray(['user_id' => null, 'title' => 'Bleibt mit Titel'])
        ->and(ForumPost::query()->find($answerToKept->id)?->helpful_count)->toBe(0)
        ->and(ForumPost::query()->find($theirAnswer->id)?->parent_id)->toBeNull()
        ->and($theirs->refresh()->solved_post_id)->toBeNull()
        ->and($theirs->replies_count)->toBe(1)
        ->and($theirs->last_poster_id)->toBe($this->other->id)
        ->and(Mention::query()->where('mentionable_id', $myReply->id)->exists())->toBeFalse()
        ->and(DB::table('forum_subscriptions')->where('user_id', $this->member->id)->exists())->toBeFalse();

    // Readers see the kept thread with its title, no author, no opening text, and the other member's reply.
    $this->getJson("/api/v1/forum/threads/{$kept->id}")->assertOk()
        ->assertJsonPath('data.author', null)->assertJsonPath('data.opening_deleted', true)->assertJsonPath('data.content', [])
        ->assertJsonPath('data.opening_post_id', null)->assertJsonPath('data.replies_count', 1);
    $this->getJson("/api/v1/forum/threads/{$kept->id}/posts")->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $answerToKept->id);
    $this->getJson("/api/v1/forum/threads/{$theirs->id}/posts")->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $theirAnswer->id);
});

it('hides the member\'s threads and posts while the account is only deactivated', function () {
    $thread = forumThread($this->member);
    $theirs = forumThread($this->other);
    forumReply($theirs, $this->member, ['status' => ForumPostStatus::Published]);
    $this->member->forceFill(['status' => UserStatus::Deactivated, 'deletion_requested_at' => now()])->save();

    $this->getJson("/api/v1/forum/threads/{$thread->id}")->assertNotFound();
    $this->getJson("/api/v1/forum/threads/{$theirs->id}/posts")->assertOk()->assertJsonCount(0, 'data');
});
