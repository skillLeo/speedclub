<?php

use App\Enums\ConversationFolder;
use App\Enums\MediaStatus;
use App\Events\ConversationRead;
use App\Events\MessageSent;
use App\Events\Typing;
use App\Events\UnreadChanged;
use App\Models\Media;
use App\Models\Message;
use App\Models\User;
use App\Services\Messaging\MessageIds;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\Support\TestImages;

require_once __DIR__.'/MessagingTestHelpers.php';

beforeEach(function () {
    msgFlags();
    Storage::fake('public');
    Storage::fake('local');
    $this->lukas = ntfMember('lukas.sc');
    $this->jann = ntfMember('jann.ptrs');
    $this->first = msgStart($this->jann, $this->lukas, 'Moin Lukas, wie läuft der R34?');
    $this->id = $this->first->conversation_id;
});

function msgRealtimeOn(): void
{
    config([
        'broadcasting.default' => 'pusher',
        'broadcasting.connections.pusher.key' => 'test-key',
        'broadcasting.connections.pusher.secret' => 'test-secret',
        'broadcasting.connections.pusher.app_id' => '12345',
        'broadcasting.connections.pusher.options.cluster' => 'eu',
    ]);
}

describe('POST conversations/{id}/messages', function () {
    it('sends a text and answers 201 with the message', function () {
        msgActAs($this->lukas);
        $clientId = (string) Str::uuid();

        $response = $this->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'text', 'body' => '  Läuft, danke!  ', 'client_id' => $clientId])->assertCreated();

        expect($response->json('data'))->toMatchArray(['type' => 'text', 'body' => 'Läuft, danke!', 'client_id' => $clientId, 'is_mine' => true, 'sender_deleted' => false, 'reactions' => []])
            ->and($response->json('data.sender.username'))->toBe('lukas.sc')
            ->and(msgSide($this->id, $this->jann)->unread_count)->toBe(1)
            ->and(msgSide($this->id, $this->lukas)->unread_count)->toBe(0)
            ->and(msgSide($this->id, $this->lukas)->last_read_message_id)->toBe($response->json('data.id'));
    });

    it('replays an identical retry once, with the first message and Idempotency-Replayed', function () {
        msgActAs($this->lukas);
        $body = ['type' => 'text', 'body' => 'Nur einmal bitte', 'client_id' => (string) Str::uuid()];

        $first = $this->withHeader('Idempotency-Key', 'send-1')->postJson("/api/v1/conversations/{$this->id}/messages", $body)->assertCreated();
        $again = $this->withHeader('Idempotency-Key', 'send-1')->postJson("/api/v1/conversations/{$this->id}/messages", $body)->assertOk()->assertHeader('Idempotency-Replayed', 'true');
        $sameClient = $this->withHeader('Idempotency-Key', 'send-2')->postJson("/api/v1/conversations/{$this->id}/messages", $body)->assertOk();

        expect($again->json('data.id'))->toBe($first->json('data.id'))
            ->and($sameClient->json('data.id'))->toBe($first->json('data.id'))
            ->and(Message::query()->where('body', 'Nur einmal bitte')->count())->toBe(1)
            ->and(msgSide($this->id, $this->jann)->unread_count)->toBe(1);
    });

    it('answers 409 idempotency_key_reused for the same ids with another payload', function () {
        msgActAs($this->lukas);
        $clientId = (string) Str::uuid();
        $this->withHeader('Idempotency-Key', 'send-1')->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'text', 'body' => 'A', 'client_id' => $clientId])->assertCreated();

        $this->withHeader('Idempotency-Key', 'send-1')->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'text', 'body' => 'B', 'client_id' => $clientId])
            ->assertStatus(409)->assertJsonPath('code', 'idempotency_key_reused');
        $this->withHeader('Idempotency-Key', 'send-1')->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'text', 'body' => 'A', 'client_id' => (string) Str::uuid()])
            ->assertStatus(409)->assertJsonPath('code', 'idempotency_key_reused');
        $this->withHeader('Idempotency-Key', "bad\x01key")->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'text', 'body' => 'C', 'client_id' => (string) Str::uuid()])
            ->assertStatus(400);

        expect(Message::query()->whereIn('body', ['B', 'C'])->count())->toBe(0);
    });

    it('never stores a body outside messages.body', function () {
        msgActAs($this->lukas);
        $this->withHeader('Idempotency-Key', 'secret-1')->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'text', 'body' => 'GEHEIM-7731', 'client_id' => (string) Str::uuid()])->assertCreated();

        $dump = json_encode([
            DB::table('idempotency_keys')->get(),
            DB::table('cache')->get(),
            DB::table('jobs')->get(),
            DB::table('notifications')->get(),
            DB::table('conversation_participants')->get(),
            DB::table('conversations')->get(),
        ]);

        expect($dump)->not->toContain('GEHEIM-7731')
            ->and(Message::query()->where('body', 'GEHEIM-7731')->first()?->toArray())->not->toHaveKey('body');
    });

    it('validates type, body, media and vehicle', function (array $body, string $field) {
        msgActAs($this->lukas);

        $this->postJson("/api/v1/conversations/{$this->id}/messages", [...$body, 'client_id' => (string) Str::uuid()])->assertUnprocessable()->assertJsonValidationErrors($field);
    })->with([
        'unknown type' => [['type' => 'audio'], 'type'],
        'empty text' => [['type' => 'text', 'body' => ''], 'body'],
        'too long' => [['type' => 'text', 'body' => str_repeat('x', 2001)], 'body'],
        'photo without media' => [['type' => 'photo'], 'media_id'],
        'photo with a body' => [['type' => 'photo', 'media_id' => '01jaaaaaaaaaaaaaaaaaaaaaaa', 'body' => 'x'], 'body'],
        'foreign media' => [['type' => 'photo', 'media_id' => '01jaaaaaaaaaaaaaaaaaaaaaaa'], 'media_id'],
        'vehicle without id' => [['type' => 'vehicle'], 'vehicle_id'],
        'unknown vehicle' => [['type' => 'vehicle', 'vehicle_id' => '01jaaaaaaaaaaaaaaaaaaaaaaa'], 'vehicle_id'],
    ]);

    it('sends a vehicle card the sender may view and hides it from a reader who may not', function () {
        $g82 = publishedVehicle($this->jann);
        msgActAs($this->jann);
        $sent = $this->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'vehicle', 'vehicle_id' => $g82->id, 'client_id' => (string) Str::uuid()])->assertCreated();
        expect($sent->json('data.vehicle.full_title'))->toBeString();

        $g82->forceFill(['visibility' => 'private'])->save();
        msgActAs($this->lukas);
        $this->getJson("/api/v1/conversations/{$this->id}/messages")->assertJsonPath('data.0.type', 'vehicle')->assertJsonPath('data.0.vehicle', null);
    });

    it('limits sends to 30 a minute', function () {
        socLimit('messages');
        msgActAs($this->lukas);

        $this->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'text', 'body' => 'eins', 'client_id' => (string) Str::uuid()])->assertCreated();
        $this->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'text', 'body' => 'zwei', 'client_id' => (string) Str::uuid()])->assertTooManyRequests();
    });
});

describe('photos', function () {
    it('uploads through the pipeline, sends the photo once, and keeps it from another message', function () {
        msgActAs($this->lukas);
        $upload = $this->post("/api/v1/conversations/{$this->id}/media", ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(800, 600))], ['Accept' => 'application/json'])->assertCreated();
        $mediaId = $upload->json('data.id');

        expect(Media::query()->find($mediaId)?->status)->toBe(MediaStatus::Ready)
            ->and(Media::query()->find($mediaId)?->getAttribute('mediable_type'))->toBe('conversation');

        $sent = $this->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'photo', 'media_id' => $mediaId, 'client_id' => (string) Str::uuid()])->assertCreated();
        expect($sent->json('data.media.id'))->toBe($mediaId)
            ->and($sent->json('data.media.variants'))->not->toBeEmpty()
            ->and(Media::query()->find($mediaId)?->getAttribute('mediable_type'))->toBe('message');

        $this->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'photo', 'media_id' => $mediaId, 'client_id' => (string) Str::uuid()])
            ->assertUnprocessable()->assertJsonValidationErrors('media_id');

        msgActAs($this->jann);
        $this->getJson("/api/v1/conversations/{$this->id}/messages")->assertJsonPath('data.0.media.id', $mediaId);
        $this->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'photo', 'media_id' => $mediaId, 'client_id' => (string) Str::uuid()])
            ->assertUnprocessable()->assertJsonValidationErrors('media_id');
    });

    it('refuses a photo uploaded to another conversation', function () {
        $other = msgStart(ntfMember('kenji.r34'), $this->lukas)->conversation_id;
        msgActAs($this->lukas);
        $mediaId = $this->post("/api/v1/conversations/$other/media", ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300))], ['Accept' => 'application/json'])->json('data.id');

        $this->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'photo', 'media_id' => $mediaId, 'client_id' => (string) Str::uuid()])
            ->assertUnprocessable()->assertJsonValidationErrors('media_id');
    });

    it('refuses a file that is no image', function () {
        msgActAs($this->lukas);

        $this->post("/api/v1/conversations/{$this->id}/media", ['file' => UploadedFile::fake()->createWithContent('a.jpg', 'not an image')], ['Accept' => 'application/json'])
            ->assertStatus(415);
    });

    it('prunes an upload no message used after 24 h and keeps a sent one', function () {
        msgActAs($this->lukas);
        $unused = $this->post("/api/v1/conversations/{$this->id}/media", ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300))], ['Accept' => 'application/json'])->json('data.id');
        $used = $this->post("/api/v1/conversations/{$this->id}/media", ['file' => UploadedFile::fake()->createWithContent('b.jpg', TestImages::jpeg(400, 301))], ['Accept' => 'application/json'])->json('data.id');
        $this->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'photo', 'media_id' => $used, 'client_id' => (string) Str::uuid()])->assertCreated();

        $this->travel(25)->hours();
        $this->artisan('media:prune')->assertSuccessful();

        expect(Media::withTrashed()->find($unused))->toBeNull()->and(Media::query()->find($used))->not->toBeNull();
    });

    it('refuses an upload when the member may not write', function () {
        $this->lukas->forceFill(['status' => 'deactivated'])->save();
        msgActAs($this->jann);

        $this->post("/api/v1/conversations/{$this->id}/media", ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300))], ['Accept' => 'application/json'])
            ->assertForbidden()->assertJsonPath('code', 'cannot_message');
    });
});

describe('GET conversations/{id}/messages', function () {
    it('pages back with before, newest first, and polls with after, oldest first', function () {
        $ids = [$this->first->id];

        foreach (range(1, 5) as $n) {
            $ids[] = msgSend($n % 2 === 0 ? $this->jann : $this->lukas, $this->id, "Nachricht $n")->id;
        }

        msgActAs($this->lukas);
        $newest = $this->getJson("/api/v1/conversations/{$this->id}/messages?limit=2")->assertOk();
        expect(collect($newest->json('data'))->pluck('id')->all())->toBe([$ids[5], $ids[4]])->and($newest->json('meta.has_more'))->toBeTrue();

        $older = $this->getJson("/api/v1/conversations/{$this->id}/messages?limit=10&before={$ids[4]}")->assertOk();
        expect(collect($older->json('data'))->pluck('id')->all())->toBe([$ids[3], $ids[2], $ids[1], $ids[0]])->and($older->json('meta.has_more'))->toBeFalse();

        $newer = $this->getJson("/api/v1/conversations/{$this->id}/messages?after={$ids[2]}")->assertOk();
        expect(collect($newer->json('data'))->pluck('id')->all())->toBe([$ids[3], $ids[4], $ids[5]]);
    });

    it('answers an idle poll with 304', function () {
        msgActAs($this->lukas);
        $poll = $this->getJson("/api/v1/conversations/{$this->id}/messages?after={$this->first->id}")->assertOk()->assertJsonCount(0, 'data');
        $etag = $poll->headers->get('ETag');

        $this->withHeader('If-None-Match', (string) $etag)->getJson("/api/v1/conversations/{$this->id}/messages?after={$this->first->id}")->assertStatus(304);

        msgSend($this->jann, $this->id, 'Neu');
        $this->withHeader('If-None-Match', (string) $etag)->getJson("/api/v1/conversations/{$this->id}/messages?after={$this->first->id}")->assertOk()->assertJsonCount(1, 'data');
    });

    it('validates the paging parameters', function (string $query, string $field) {
        msgActAs($this->lukas);

        $this->getJson("/api/v1/conversations/{$this->id}/messages?$query")->assertUnprocessable()->assertJsonValidationErrors($field);
    })->with([
        'before and after' => ['before=01jaaaaaaaaaaaaaaaaaaaaaaa&after=01jaaaaaaaaaaaaaaaaaaaaaaa', 'before'],
        'not an id' => ['after=x', 'after'],
        'limit above 50' => ['limit=51', 'limit'],
        'after limit above 100' => ['after=01jaaaaaaaaaaaaaaaaaaaaaaa&limit=101', 'limit'],
    ]);

    it('hands out strictly increasing ids within a conversation', function () {
        expect(MessageIds::increment('01j'.str_repeat('z', 23)))->toBe('01k'.str_repeat('0', 23))
            ->and(MessageIds::increment('01h0000000000000000000000a'))->toBe('01h0000000000000000000000b')
            ->and(strlen(MessageIds::after(null)))->toBe(26);

        // A last id from the future (another process's clock) still gets a successor.
        $future = '7zzzzzzzzzzzzzzzzzzzzzzzzy';
        expect(MessageIds::after($future))->toBe('7zzzzzzzzzzzzzzzzzzzzzzzzz');

        $sent = collect(range(1, 20))->map(fn (int $n) => msgSend($n % 2 === 0 ? $this->jann : $this->lukas, $this->id, "m$n")->id)->all();
        $sorted = $sent;
        sort($sorted, SORT_STRING);
        expect($sent)->toBe($sorted)->and(count(array_unique($sent)))->toBe(20);
    });
});

describe('read state', function () {
    it('moves the read mark forward only, recounts unread and shows "Gelesen" while both send receipts', function () {
        $second = msgSend($this->jann, $this->id, 'Zweite');
        msgActAs($this->lukas);

        $this->postJson("/api/v1/conversations/{$this->id}/read", ['message_id' => $this->first->id])->assertNoContent();
        expect(msgSide($this->id, $this->lukas)->unread_count)->toBe(1);
        $this->postJson("/api/v1/conversations/{$this->id}/read", ['message_id' => $second->id])->assertNoContent();
        $this->postJson("/api/v1/conversations/{$this->id}/read", ['message_id' => $this->first->id])->assertNoContent();
        expect(msgSide($this->id, $this->lukas)->last_read_message_id)->toBe($second->id)->and(msgSide($this->id, $this->lukas)->unread_count)->toBe(0);

        msgActAs($this->jann);
        $this->getJson("/api/v1/conversations/{$this->id}")->assertJsonPath('data.other_read_message_id', $second->id);

        $this->lukas->forceFill(['read_receipts' => false])->save();
        $this->getJson("/api/v1/conversations/{$this->id}")->assertJsonPath('data.other_read_message_id', null);

        $this->lukas->forceFill(['read_receipts' => true])->save();
        msgFlags(false);
        $this->getJson("/api/v1/conversations/{$this->id}")->assertJsonPath('data.other_read_message_id', null);
    });

    it('refuses a message the reader does not see', function () {
        $hidden = msgSend($this->jann, $this->id, 'Weg damit');
        msgActAs($this->lukas);
        $this->deleteJson("/api/v1/messages/{$hidden->id}")->assertNoContent();

        $this->postJson("/api/v1/conversations/{$this->id}/read", ['message_id' => $hidden->id])->assertUnprocessable()->assertJsonValidationErrors('message_id');
        $this->postJson("/api/v1/conversations/{$this->id}/read", [])->assertUnprocessable()->assertJsonValidationErrors('message_id');
    });

    it('broadcasts ConversationRead only while receipts apply, and never for a request', function () {
        msgRealtimeOn();
        Event::fake([ConversationRead::class, UnreadChanged::class]);
        msgActAs($this->lukas);
        $this->postJson("/api/v1/conversations/{$this->id}/read", ['message_id' => $this->first->id])->assertNoContent();
        Event::assertDispatched(ConversationRead::class, fn (ConversationRead $event) => $event->broadcastWith() === ['conversation_id' => $this->id, 'message_id' => $this->first->id]);

        $max = ntfMember('max.e46');
        $request = msgStart($max, $this->lukas, chat: false);
        Event::fake([ConversationRead::class]);
        $this->postJson("/api/v1/conversations/{$request->conversation_id}/read", ['message_id' => $request->id])->assertNoContent();
        Event::assertNotDispatched(ConversationRead::class);
    });
});

describe('realtime events', function () {
    it('sends MessageSent with ids only to the conversation and the recipient', function () {
        msgRealtimeOn();
        Event::fake([MessageSent::class, UnreadChanged::class]);
        msgActAs($this->lukas);

        $id = $this->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'text', 'body' => 'Kein Body im Event', 'client_id' => (string) Str::uuid()])->json('data.id');

        Event::assertDispatched(MessageSent::class, function (MessageSent $event) use ($id) {
            $channels = array_map(fn ($channel) => $channel->name, $event->broadcastOn());

            return $event->broadcastWith() === ['conversation_id' => $this->id, 'message_id' => $id]
                && $channels === ['private-conversation.'.$this->id, 'private-user.'.$this->jann->id]
                && ! str_contains(json_encode($event->broadcastWith()), 'Kein Body');
        });
    });

    it('sends nothing without Pusher keys', function () {
        Event::fake([MessageSent::class]);
        msgActAs($this->lukas);

        $this->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'text', 'body' => 'Polling', 'client_id' => (string) Str::uuid()])->assertCreated();

        Event::assertNotDispatched(MessageSent::class);
    });

    it('does not fail a send when Pusher fails', function () {
        msgRealtimeOn();
        config(['broadcasting.connections.pusher.options.host' => '127.0.0.1', 'broadcasting.connections.pusher.options.port' => 9, 'broadcasting.connections.pusher.options.scheme' => 'http', 'broadcasting.connections.pusher.options.useTLS' => false]);
        msgActAs($this->lukas);

        $this->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'text', 'body' => 'Trotzdem da', 'client_id' => (string) Str::uuid()])->assertCreated();

        expect(Message::query()->where('body', 'Trotzdem da')->exists())->toBeTrue();
    });
});

describe('[SIG] typing', function () {
    it('stores typing_until for 5 s and shows it to the other member', function () {
        msgRealtimeOn();
        Event::fake([Typing::class]);
        msgActAs($this->lukas);
        $this->postJson("/api/v1/conversations/{$this->id}/typing")->assertNoContent();
        Event::assertDispatched(Typing::class, fn (Typing $event) => $event->broadcastWith() === ['conversation_id' => $this->id, 'message_id' => null]);

        msgActAs($this->jann);
        $this->getJson("/api/v1/conversations/{$this->id}")->assertJsonPath('data.other_typing', true);
        $this->travel(6)->seconds();
        $this->getJson("/api/v1/conversations/{$this->id}")->assertJsonPath('data.other_typing', false);
    });

    it('answers 404 feature_disabled while the typing flag is off', function () {
        msgActAs($this->lukas);
        msgFlags(false);
        $this->postJson("/api/v1/conversations/{$this->id}/typing")->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    });

    it('limits typing signals', function () {
        msgActAs($this->lukas);
        socLimit('typing');
        $this->postJson("/api/v1/conversations/{$this->id}/typing")->assertNoContent();
        $this->postJson("/api/v1/conversations/{$this->id}/typing")->assertTooManyRequests();
    });
});

describe('[SIG] reactions', function () {
    it('keeps one reaction per member and message, in the fixed order, and removes it', function () {
        msgActAs($this->lukas);
        $this->postJson("/api/v1/messages/{$this->first->id}/reactions", ['key' => 'heart'])->assertOk()->assertJsonPath('data.reactions', [['key' => 'heart', 'count' => 1, 'mine' => true]]);
        $this->postJson("/api/v1/messages/{$this->first->id}/reactions", ['key' => 'fire'])->assertOk()->assertJsonPath('data.reactions', [['key' => 'fire', 'count' => 1, 'mine' => true]]);

        msgActAs($this->jann);
        $this->postJson("/api/v1/messages/{$this->first->id}/reactions", ['key' => 'thumbs_up'])->assertOk()
            ->assertJsonPath('data.reactions', [['key' => 'thumbs_up', 'count' => 1, 'mine' => true], ['key' => 'fire', 'count' => 1, 'mine' => false]]);
        $this->deleteJson("/api/v1/messages/{$this->first->id}/reactions")->assertOk()->assertJsonPath('data.reactions', [['key' => 'fire', 'count' => 1, 'mine' => false]]);
        $this->deleteJson("/api/v1/messages/{$this->first->id}/reactions")->assertOk();
        $this->postJson("/api/v1/messages/{$this->first->id}/reactions", ['key' => 'poop'])->assertUnprocessable()->assertJsonValidationErrors('key');
    });

    it('does not react inside a pending request', function () {
        $request = msgStart(ntfMember('max.e46'), $this->lukas, chat: false);
        msgActAs($this->lukas);

        $this->postJson("/api/v1/messages/{$request->id}/reactions", ['key' => 'heart'])->assertForbidden();
    });

    it('answers 404 feature_disabled while the flag is off', function () {
        msgFlags(false);
        msgActAs($this->lukas);

        $this->postJson("/api/v1/messages/{$this->first->id}/reactions", ['key' => 'heart'])->assertNotFound()->assertJsonPath('code', 'feature_disabled');
        $this->getJson("/api/v1/conversations/{$this->id}/messages")->assertJsonPath('data.0.reactions', []);
    });
});

it('keeps writing open in an accepted conversation after the recipient turns messages to Niemand', function () {
    $this->lukas->forceFill(['who_can_message' => 'nobody'])->save();
    msgActAs($this->jann);

    $this->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'text', 'body' => 'Geht noch', 'client_id' => (string) Str::uuid()])->assertCreated();
    expect(msgSide($this->id, $this->lukas)->folder)->toBe(ConversationFolder::Chats);
});

it('answers 403 cannot_message when the recipient was suspended', function () {
    $this->lukas->forceFill(['status' => 'suspended'])->save();
    msgActAs($this->jann);

    $this->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'text', 'body' => 'Hallo', 'client_id' => (string) Str::uuid()])
        ->assertForbidden()->assertJsonPath('code', 'cannot_message')->assertJsonPath('reason', 'recipient_closed');
    $this->getJson("/api/v1/conversations/{$this->id}")->assertJsonPath('data.can_send', false);
    expect(User::query()->find($this->lukas->id)?->status->value)->toBe('suspended');
});
