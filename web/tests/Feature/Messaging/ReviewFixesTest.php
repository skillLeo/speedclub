<?php

use App\Actions\Messaging\DeliverMessage;
use App\Actions\Messaging\SendMessage;
use App\Actions\Social\BlockMember;
use App\Actions\Social\UnblockMember;
use App\Enums\ConversationFolder;
use App\Enums\RestrictionType;
use App\Enums\WhoCanMessage;
use App\Models\Media;
use App\Models\Message;
use App\Models\User;
use App\Services\Messaging\ChatMediaJanitor;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\TestImages;

require_once __DIR__.'/MessagingTestHelpers.php';

/**
 * The M2.4 code review fix round (docs/reports/phase-2/m2.4-review.md, "Code review").
 */
beforeEach(function () {
    msgFlags();
    Storage::fake('public');
    Storage::fake('local');
});

function msgReviewSend(string $conversationId, string $body = 'Hallo?'): TestResponse
{
    return test()->postJson("/api/v1/conversations/$conversationId/messages", ['type' => 'text', 'body' => $body, 'client_id' => (string) Str::uuid()]);
}

function msgUpload(string $conversationId): TestResponse
{
    return test()->post("/api/v1/conversations/$conversationId/media", ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(640, 480))], ['Accept' => 'application/json']);
}

describe('#1 deleting a pending request declines it', function () {
    it('keeps the sender pending and silent', function () {
        $max = ntfMember('max.e46');
        $lukas = ntfMember('lukas.sc');
        $id = msgStart($max, $lukas, chat: false)->conversation_id;

        msgActAs($lukas);
        $this->deleteJson("/api/v1/conversations/$id")->assertNoContent();
        $this->getJson("/api/v1/conversations/$id")->assertNotFound();
        expect(msgSide($id, $lukas)->declined_at)->not->toBeNull();

        msgActAs($max);
        $this->getJson("/api/v1/conversations/$id")->assertOk()->assertJsonPath('data.request_pending', true);
        msgReviewSend($id)->assertStatus(409)->assertJsonPath('code', 'request_pending');
    });
});

describe('#3 messaging GETs are never stored', function () {
    it('answers private, no-store and still 304 for If-None-Match', function () {
        $lukas = ntfMember('lukas.sc');
        $first = msgStart(ntfMember('jann.ptrs'), $lukas);
        msgActAs($lukas);

        foreach (['/api/v1/conversations', "/api/v1/conversations/{$first->conversation_id}", "/api/v1/conversations/{$first->conversation_id}/messages?after={$first->id}"] as $uri) {
            $response = $this->getJson($uri)->assertOk();
            expect($response->headers->get('Cache-Control'))->toBe('no-store, private');

            $again = $this->withHeader('If-None-Match', (string) $response->headers->get('ETag'))->getJson($uri)->assertStatus(304);
            expect($again->headers->get('Cache-Control'))->toContain('no-store');
            $this->flushHeaders();
        }

        // Elsewhere the ETag routes keep no-cache.
        expect($this->getJson('/api/v1/app-config')->headers->get('Cache-Control'))->toBe('no-cache, private');
    });
});

describe('#4 a block ends acceptance', function () {
    it('sends the next message after an unblock through the request step and who_can_message', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $id = msgStart($jann, $lukas)->conversation_id;
        msgSend($lukas, $id, 'Antwort');
        DB::table('follows')->delete();

        app(BlockMember::class)->handle($lukas, $jann);
        expect(msgSide($id, $lukas)->accepted_at)->toBeNull()->and(msgSide($id, $jann)->folder)->toBe(ConversationFolder::Requests);
        app(UnblockMember::class)->handle($lukas, $jann, 'jann.ptrs');

        msgActAs($jann);
        $this->postJson('/api/v1/conversations', msgStartBody($lukas))->assertOk();
        expect(msgSide($id, $lukas)->folder)->toBe(ConversationFolder::Requests)->and(msgSide($id, $lukas)->accepted_at)->toBeNull();
        $this->postJson('/api/v1/conversations', msgStartBody($lukas))->assertStatus(409)->assertJsonPath('code', 'request_pending');

        $lukas->forceFill(['who_can_message' => WhoCanMessage::Nobody])->save();
        app(BlockMember::class)->handle($lukas, $jann);
        app(UnblockMember::class)->handle($lukas, $jann, 'jann.ptrs');
        $this->postJson('/api/v1/conversations', msgStartBody($lukas))->assertForbidden()->assertJsonPath('reason', 'recipient_closed');
    });
});

describe('#5 chat photos on the private disk', function () {
    it('stores nothing public and serves the photo only by a signed URL for a viewer who sees it', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $id = msgStart($jann, $lukas)->conversation_id;
        msgActAs($lukas);

        $upload = msgUpload($id)->assertCreated();
        $url = $upload->json('data.variants.0.url');
        expect(Storage::disk('public')->allFiles())->toBe([])
            ->and($url)->toContain('/api/v1/chat-media/')->toContain('signature=')->toContain('expires=')->toContain('viewer='.$lukas->id);
        $this->get($url)->assertOk()->assertHeader('Content-Type', 'image/webp')->assertHeader('Cache-Control', 'max-age=600, private');

        $sent = $this->postJson("/api/v1/conversations/$id/messages", ['type' => 'photo', 'media_id' => $upload->json('data.id'), 'client_id' => (string) Str::uuid()])->assertCreated();
        msgActAs($jann);
        $janns = $this->getJson("/api/v1/conversations/$id/messages")->json('data.0.media.variants.0.url');
        $this->get($janns)->assertOk();

        // The URL of one viewer is no URL for another, and an unsigned or altered one is refused.
        $this->get(str_replace('viewer='.$jann->id, 'viewer='.User::factory()->create()->id, $janns))->assertForbidden();
        $this->get(strtok($janns, '?').'?viewer='.$jann->id)->assertForbidden();

        // A viewer who no longer sees the message (deleted the conversation) gets 404 with the URL still valid.
        $this->deleteJson("/api/v1/conversations/$id")->assertNoContent();
        $this->get($janns)->assertNotFound();
        expect($sent->json('data.media.id'))->toBe($upload->json('data.id'));
    });

    it('expires the URL after its step and keeps it stable within the step', function () {
        $lukas = ntfMember('lukas.sc');
        $id = msgStart(ntfMember('jann.ptrs'), $lukas)->conversation_id;
        msgActAs($lukas);
        $this->travelTo(now()->startOfHour()->addMinute());
        $mediaId = msgUpload($id)->json('data.id');
        $this->postJson("/api/v1/conversations/$id/messages", ['type' => 'photo', 'media_id' => $mediaId, 'client_id' => (string) Str::uuid()])->assertCreated();

        $url = fn () => $this->getJson("/api/v1/conversations/$id/messages")->json('data.0.media.variants.0.url');
        $first = $url();
        $this->travel(5)->minutes();
        expect($url())->toBe($first);
        $this->travel(16)->minutes();
        $this->get($first)->assertForbidden();
    });

    it('purges a sent photo once nobody sees it any more', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $id = msgStart($jann, $lukas)->conversation_id;
        msgActAs($lukas);
        $mediaId = msgUpload($id)->json('data.id');
        $this->postJson("/api/v1/conversations/$id/messages", ['type' => 'photo', 'media_id' => $mediaId, 'client_id' => (string) Str::uuid()])->assertCreated();

        $this->deleteJson("/api/v1/conversations/$id")->assertNoContent();
        $this->artisan('media:prune')->assertSuccessful();
        expect(Media::query()->find($mediaId))->not->toBeNull();

        msgActAs($jann);
        $this->deleteJson("/api/v1/conversations/$id")->assertNoContent();
        $this->artisan('media:prune')->assertSuccessful();
        expect(Media::withTrashed()->find($mediaId))->toBeNull()->and(Storage::disk('local')->allFiles('media/'.$mediaId))->toBe([]);
    });

    it('purges the photos of a conversation whose two accounts are gone', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $id = msgStart($jann, $lukas)->conversation_id;
        msgActAs($lukas);
        $mediaId = msgUpload($id)->json('data.id');
        $this->postJson("/api/v1/conversations/$id/messages", ['type' => 'photo', 'media_id' => $mediaId, 'client_id' => (string) Str::uuid()])->assertCreated();

        $jann->forceDelete();
        $this->artisan('media:prune')->assertSuccessful();
        expect(Media::query()->find($mediaId))->not->toBeNull();

        Media::query()->whereKey($mediaId)->update(['owner_id' => User::factory()->create()->id]);
        $lukas->forceDelete();
        $this->artisan('media:prune')->assertSuccessful();
        expect(Media::withTrashed()->find($mediaId))->toBeNull();
    });
});

describe('#13 requests of a gone account', function () {
    it('leaves them out of Anfragen and the badge', function (string $how) {
        $max = ntfMember('max.e46');
        $lukas = ntfMember('lukas.sc');
        msgStart($max, $lukas, chat: false);
        $how === 'deleted' ? $max->delete() : $max->forceFill(['status' => 'deactivated'])->save();
        msgActAs($lukas);

        $this->getJson('/api/v1/conversations?folder=requests')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/notifications/unread-count')->assertJsonPath('data.requests', 0);
    })->with(['deleted', 'deactivated']);
});

describe('#14 more of the matrix', function () {
    it('refuses what would reach a deleted other participant', function (Closure $delete) {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $message = msgStart($jann, $lukas);
        $id = $message->conversation_id;
        $delete($jann);
        msgActAs($lukas);

        msgReviewSend($id)->assertForbidden()->assertJsonPath('code', 'cannot_message');
        msgUpload($id)->assertForbidden()->assertJsonPath('code', 'cannot_message');
        $this->postJson("/api/v1/messages/{$message->id}/reactions", ['key' => 'fire'])->assertForbidden()->assertJsonPath('code', 'cannot_message');
        $this->postJson("/api/v1/conversations/$id/typing")->assertNoContent();
        expect(cache()->get("typing:$id:{$lukas->id}"))->toBeNull();
    })->with([
        'deactivated' => [fn (User $user) => $user->forceFill(['status' => 'deactivated'])->save()],
        'soft-deleted' => [fn (User $user) => $user->delete()],
        'hard-deleted' => [fn (User $user) => $user->forceDelete()],
    ]);

    it('lets a restricted recipient accept and decline, and 404s a blocked or deleted-for-me request', function (string $case, string $action, int $status) {
        $max = ntfMember('max.e46');
        $lukas = ntfMember('lukas.sc');
        $id = msgStart($max, $lukas, chat: false)->conversation_id;

        match ($case) {
            'restricted' => $lukas->forceFill(['restrictions' => [RestrictionType::Messaging->value => ['until' => null]]])->save(),
            'recipient blocks sender' => socBlock($lukas, $max),
            'deleted for me' => msgSide($id, $lukas)->forceFill(['deleted_at' => now()])->save(),
        };
        msgActAs($lukas->refresh());

        $this->postJson("/api/v1/conversations/$id/$action")->assertStatus($status);
    })->with([
        ['restricted', 'accept', 200], ['restricted', 'decline', 204],
        ['recipient blocks sender', 'accept', 404], ['recipient blocks sender', 'decline', 404],
        ['deleted for me', 'accept', 404], ['deleted for me', 'decline', 404],
    ]);

    it('authorises the own user channel by account state', function (Closure $state, int $status) {
        config(['broadcasting.default' => 'pusher', 'broadcasting.connections.pusher.key' => 'k', 'broadcasting.connections.pusher.secret' => 's', 'broadcasting.connections.pusher.app_id' => '1', 'broadcasting.connections.pusher.options.cluster' => 'eu']);
        $member = $state();
        msgActAs($member);

        $this->postJson('/api/v1/broadcasting/auth', ['channel_name' => 'private-user.'.strtoupper($member->id), 'socket_id' => '1.2'])->assertStatus($status);
    })->with([
        'unverified' => [fn () => User::factory()->unverified()->create(), 200],
        'restricted from messaging' => [fn () => User::factory()->restrictedFrom(RestrictionType::Messaging)->create(), 200],
        'deactivated' => [fn () => User::factory()->deactivated()->create(), 403],
    ]);

    it('lists the inbox for restricted and unverified members', function (Closure $state) {
        $lukas = ntfMember('lukas.sc');
        msgStart(ntfMember('jann.ptrs'), $lukas);
        $state($lukas);
        msgActAs($lukas->refresh());

        $this->getJson('/api/v1/conversations')->assertOk()->assertJsonCount(1, 'data');
    })->with([
        'restricted' => [fn (User $user) => $user->forceFill(['restrictions' => [RestrictionType::Messaging->value => ['until' => null]]])->save()],
        'unverified' => [fn (User $user) => $user->forceFill(['email_verified_at' => null])->save()],
    ]);

    it('answers a lost unique race as the replay of the copy that won', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $first = msgStart($jann, $lukas);
        $winner = msgSend($lukas, $first->conversation_id, 'Gewonnen');
        // The race: no copy at the first look, the insert hits the unique index, the second look finds the winner.
        app()->bind(DeliverMessage::class, fn ($app) => new class($winner) extends DeliverMessage
        {
            private int $calls = 0;

            public function __construct(private readonly Message $winner) {}

            public function replay(User $sender, array $draft, ?string $key, ?string $conversationId = null): ?Message
            {
                return ++$this->calls > 2 ? $this->winner : null;
            }

            public function assertAttachable(User $sender, string $conversationId, array $draft): void {}

            public function deliver(User $sender, User $recipient, $conversation, $mine, $theirs, array $draft, ?string $key, $context = null): Message
            {
                throw new UniqueConstraintViolationException('mysql', 'insert into `messages` …', [], new PDOException('23000'));
            }
        });

        $delivery = app(SendMessage::class)->handle($lukas, msgSide($first->conversation_id, $lukas), msgText('Gewonnen', $winner->client_id), null);

        expect($delivery->replayed)->toBeTrue()->and($delivery->message->id)->toBe($winner->id);
    });
});

describe('#15 the request limit counts once, after the commit', function () {
    it('counts a written request once and a rolled back one not at all', function () {
        $max = ntfMember('max.e46');
        $key = 'conversation_requests|user:'.$max->id;
        msgActAs($max);

        Message::creating(function () {
            throw new RuntimeException('storage gone');
        });
        $this->postJson('/api/v1/conversations', msgStartBody(ntfMember('lukas.sc')))->assertStatus(500);
        expect(RateLimiter::attempts($key))->toBe(0);

        Message::flushEventListeners();
        $this->postJson('/api/v1/conversations', msgStartBody(ntfMember('jann.ptrs')))->assertCreated();
        expect(RateLimiter::attempts($key))->toBe(1);
    });
});

describe('nits', function () {
    it('#16 refuses a start replay whose client_id belongs to another conversation', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $kenji = ntfMember('kenji.r34');
        socFollow($jann, $lukas);
        socFollow($kenji, $lukas);
        msgActAs($lukas);
        $body = msgStartBody($jann);
        $this->postJson('/api/v1/conversations', $body)->assertCreated();

        $this->postJson('/api/v1/conversations', [...$body, 'recipient' => $kenji->username])->assertStatus(409)->assertJsonPath('code', 'idempotency_key_reused');
    });

    it('#23 keeps an upload a message claimed between the query and the purge', function () {
        $lukas = ntfMember('lukas.sc');
        $id = msgStart(ntfMember('jann.ptrs'), $lukas)->conversation_id;
        msgActAs($lukas);
        $mediaId = msgUpload($id)->json('data.id');
        $this->travel(25)->hours();
        $janitor = app(ChatMediaJanitor::class);
        $old = $janitor->unused(10)->firstWhere('id', $mediaId);

        $this->postJson("/api/v1/conversations/$id/messages", ['type' => 'photo', 'media_id' => $mediaId, 'client_id' => (string) Str::uuid()])->assertCreated();

        expect($old)->not->toBeNull()->and($janitor->stillUnused($old))->toBeFalse();
        $this->artisan('media:prune')->assertSuccessful();
        expect(Media::query()->find($mediaId))->not->toBeNull();
    });

    it('#24 refuses a photo upload to a request that holds its one message', function () {
        $max = ntfMember('max.e46');
        $lukas = ntfMember('lukas.sc');
        $id = msgStart($max, $lukas, chat: false)->conversation_id;
        msgActAs($max);

        msgUpload($id)->assertStatus(409)->assertJsonPath('code', 'request_pending');
        expect(Media::query()->count())->toBe(0);
    });

});
