<?php

use App\Actions\Social\BlockMember;
use App\Actions\Social\UnblockMember;
use App\Enums\ConversationFolder;
use App\Enums\RestrictionType;
use App\Enums\WhoCanMessage;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use Illuminate\Support\Str;

require_once __DIR__.'/MessagingTestHelpers.php';

beforeEach(function () {
    msgFlags();
});

describe('POST conversations', function () {
    it('starts a conversation with its first message and lands in Chats when the recipient follows the sender', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        socFollow($jann, $lukas);
        msgActAs($lukas);

        $response = $this->withHeader('Idempotency-Key', 'start-1')->postJson('/api/v1/conversations', msgStartBody($jann))->assertCreated();

        $id = $response->json('data.conversation.id');
        expect($response->json('data.message.body'))->toBe('Servus, ist das noch der originale RB26?')
            ->and($response->json('data.message.is_mine'))->toBeTrue()
            ->and($response->json('data.conversation.other.username'))->toBe('jann.ptrs')
            ->and($response->json('data.conversation.request_pending'))->toBeFalse()
            ->and($response->json('data.conversation.can_send'))->toBeTrue()
            ->and(msgSide($id, $jann)->folder)->toBe(ConversationFolder::Chats)
            ->and(msgSide($id, $jann)->unread_count)->toBe(1);
    });

    it('reuses the pair conversation and answers 200 on a second start, also from the other side', function () {
        $lukas = ntfMember('lukas.sc');
        $kenji = ntfMember('kenji.r34');
        $first = msgStart($lukas, $kenji);
        msgActAs($kenji);

        $response = $this->postJson('/api/v1/conversations', msgStartBody($lukas))->assertOk();

        expect($response->json('data.conversation.id'))->toBe($first->conversation_id)
            ->and(Conversation::query()->count())->toBe(1);
    });

    it('sets the context card from the vehicle the start came from', function () {
        $lukas = ntfMember('lukas.sc');
        $kenji = ntfMember('kenji.r34');
        $r34 = publishedVehicle($lukas);
        msgActAs($kenji);

        $response = $this->postJson('/api/v1/conversations', msgStartBody($lukas, ['vehicle_id' => $r34->id]))->assertCreated();

        expect($response->json('data.conversation.vehicle.id'))->toBe($r34->id)
            ->and($response->json('data.conversation.context_vehicle.slug'))->toBe($r34->slug)
            ->and($response->json('data.conversation.vehicle.owner_username'))->toBe('lukas.sc');
    });

    it('sends a vehicle card as the first message', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $g82 = publishedVehicle($jann);
        msgActAs($lukas);

        $response = $this->postJson('/api/v1/conversations', msgStartBody($jann, ['message' => ['type' => 'vehicle', 'body' => null, 'vehicle_id' => $g82->id]]))->assertCreated();

        expect($response->json('data.message.type'))->toBe('vehicle')
            ->and($response->json('data.message.body'))->toBeNull()
            ->and($response->json('data.message.vehicle.id'))->toBe($g82->id);
    });

    it('refuses a vehicle the sender may not view', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $private = publishedVehicle($jann, ['visibility' => 'private']);
        msgActAs($lukas);

        $this->postJson('/api/v1/conversations', msgStartBody($jann, ['vehicle_id' => $private->id]))
            ->assertUnprocessable()->assertJsonValidationErrors('vehicle_id');
        $this->postJson('/api/v1/conversations', msgStartBody($jann, ['message' => ['type' => 'vehicle', 'body' => null, 'vehicle_id' => $private->id]]))
            ->assertUnprocessable()->assertJsonValidationErrors('message.vehicle_id');
    });

    it('validates the body', function (array $message, string $field) {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        msgActAs($lukas);

        $this->postJson('/api/v1/conversations', [...msgStartBody($jann), 'message' => $message])->assertUnprocessable()->assertJsonValidationErrors($field);
    })->with([
        'empty text' => [['type' => 'text', 'body' => '   '], 'message.body'],
        'text too long' => [['type' => 'text', 'body' => str_repeat('a', 2001)], 'message.body'],
        'photo is not a start' => [['type' => 'photo', 'body' => null], 'message.type'],
        'vehicle without id' => [['type' => 'vehicle'], 'message.vehicle_id'],
    ]);

    it('keeps a text of exactly 2000 characters, trimmed', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        msgActAs($lukas);
        $body = str_repeat('ä', 2000);

        $this->postJson('/api/v1/conversations', msgStartBody($jann, ['message' => ['body' => "  $body  "]]))->assertCreated()->assertJsonPath('data.message.body', $body);
    });

    it('needs a client_id', function () {
        $lukas = ntfMember('lukas.sc');
        msgActAs($lukas);

        $this->postJson('/api/v1/conversations', [...msgStartBody(ntfMember('jann.ptrs')), 'client_id' => null])->assertUnprocessable()->assertJsonValidationErrors('client_id');
        $this->postJson('/api/v1/conversations', [...msgStartBody(ntfMember('max.e46')), 'client_id' => 'a b'])->assertUnprocessable()->assertJsonValidationErrors('client_id');
    });

    it('answers 422 for yourself and 404 member_unavailable for nobody, an unverified or a suspended member', function () {
        $lukas = ntfMember('lukas.sc');
        $unverified = User::factory()->unverified()->create();
        $suspended = User::factory()->suspended()->create();
        msgActAs($lukas);

        $this->postJson('/api/v1/conversations', msgStartBody($lukas))->assertUnprocessable()->assertJsonValidationErrors('recipient');
        $this->postJson('/api/v1/conversations', [...msgStartBody($lukas), 'recipient' => 'nobody.here'])->assertNotFound()->assertJsonPath('code', 'member_unavailable');
        $this->postJson('/api/v1/conversations', msgStartBody($unverified))->assertNotFound()->assertJsonPath('code', 'member_unavailable');
        $this->postJson('/api/v1/conversations', msgStartBody($suspended))->assertNotFound()->assertJsonPath('code', 'member_unavailable');
    });

    it('answers 403 cannot_message recipient_closed for Niemand, for Following without a follow and for a block either way', function (Closure $setup) {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $setup($lukas, $jann);
        msgActAs($lukas);

        $this->withHeader('Accept-Language', 'de')->postJson('/api/v1/conversations', msgStartBody($jann))
            ->assertForbidden()
            ->assertJsonPath('code', 'cannot_message')
            ->assertJsonPath('reason', 'recipient_closed')
            ->assertJsonPath('message', 'Dieses Mitglied nimmt gerade keine Nachrichten von dir an.');

        expect(Message::query()->count())->toBe(0)->and(Conversation::query()->count())->toBe(0);
    })->with([
        'nobody' => [fn (User $lukas, User $jann) => $jann->forceFill(['who_can_message' => WhoCanMessage::Nobody])->save()],
        'following, not followed' => [fn (User $lukas, User $jann) => $jann->forceFill(['who_can_message' => WhoCanMessage::Following])->save()],
        'the recipient blocked the sender' => [fn (User $lukas, User $jann) => socBlock($jann, $lukas)],
        'the sender blocked the recipient' => [fn (User $lukas, User $jann) => socBlock($lukas, $jann)],
    ]);

    it('lets a member write who follows the sender with Following set', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs', ['who_can_message' => WhoCanMessage::Following]);
        socFollow($jann, $lukas);
        msgActAs($lukas);

        $this->postJson('/api/v1/conversations', msgStartBody($jann))->assertCreated();
    });

    it('answers 403 email_not_verified and account_restricted before anything else', function () {
        $jann = ntfMember('jann.ptrs');
        msgActAs(User::factory()->unverified()->create());
        $this->postJson('/api/v1/conversations', msgStartBody($jann))->assertForbidden()->assertJsonPath('code', 'email_not_verified');

        msgActAs(User::factory()->restrictedFrom(RestrictionType::Messaging)->create());
        $this->postJson('/api/v1/conversations', msgStartBody($jann))->assertForbidden()->assertJsonPath('code', 'account_restricted');
    });

    it('limits new conversations to 20 a day and new requests to 10 a day', function () {
        $lukas = ntfMember('lukas.sc');
        msgActAs($lukas);
        $members = User::factory()->count(11)->create();

        foreach ($members->take(10) as $member) {
            $this->postJson('/api/v1/conversations', msgStartBody($member))->assertCreated();
        }

        $this->postJson('/api/v1/conversations', msgStartBody($members->last()))->assertTooManyRequests()
            ->assertJsonPath('code', 'rate_limited')
            ->assertHeader('Retry-After');
        expect(Conversation::query()->count())->toBe(10);

        // A start to a follower is no request and still goes through.
        $friend = User::factory()->create();
        socFollow($friend, $lukas);
        $this->postJson('/api/v1/conversations', msgStartBody($friend))->assertCreated();
    });

    it('limits the starts with throttle:conversations', function () {
        socLimit('conversations');
        $lukas = ntfMember('lukas.sc');
        msgActAs($lukas);

        $this->postJson('/api/v1/conversations', msgStartBody(ntfMember('jann.ptrs')))->assertCreated();
        $this->postJson('/api/v1/conversations', msgStartBody(ntfMember('max.e46')))->assertTooManyRequests();
    });
});

describe('requests', function () {
    it('puts a start from a member the recipient does not follow into Anfragen, with one message until accepted', function () {
        $max = ntfMember('max.e46');
        $lukas = ntfMember('lukas.sc');
        $first = msgStart($max, $lukas, 'Hey, darf ich dich was zum S15 fragen?', chat: false);
        $id = $first->conversation_id;

        expect(msgSide($id, $lukas)->folder)->toBe(ConversationFolder::Requests);

        msgActAs($max);
        $this->getJson("/api/v1/conversations/$id")->assertOk()->assertJsonPath('data.request_pending', true)->assertJsonPath('data.can_send', true);
        $this->postJson("/api/v1/conversations/$id/messages", ['type' => 'text', 'body' => 'Hallo?', 'client_id' => (string) Str::uuid()])
            ->assertStatus(409)->assertJsonPath('code', 'request_pending');
        $this->postJson('/api/v1/conversations', msgStartBody($lukas))->assertStatus(409)->assertJsonPath('code', 'request_pending');
        expect(Message::query()->count())->toBe(1);

        msgActAs($lukas);
        $this->getJson('/api/v1/conversations?folder=requests')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.other.username', 'max.e46');
        $this->getJson('/api/v1/conversations')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/notifications/unread-count')->assertOk()->assertJsonPath('data.requests', 1)->assertJsonPath('data.messages', 0);
    });

    it('never shows read state of a request to its sender, and a read call on a request changes nothing', function () {
        $max = ntfMember('max.e46');
        $lukas = ntfMember('lukas.sc');
        $first = msgStart($max, $lukas, chat: false);
        $id = $first->conversation_id;

        msgActAs($lukas);
        $this->postJson("/api/v1/conversations/$id/read", ['message_id' => $first->id])->assertNoContent();
        expect(msgSide($id, $lukas)->last_read_message_id)->toBeNull();
        $this->postJson("/api/v1/conversations/$id/typing")->assertNoContent();

        msgActAs($max);
        $this->getJson("/api/v1/conversations/$id")->assertOk()
            ->assertJsonPath('data.other_read_message_id', null)
            ->assertJsonPath('data.other_typing', false);
    });

    it('moves an accepted request to Chats and lets the sender write again', function () {
        $max = ntfMember('max.e46');
        $lukas = ntfMember('lukas.sc');
        $first = msgStart($max, $lukas, chat: false);
        $id = $first->conversation_id;

        msgActAs($lukas);
        $this->postJson("/api/v1/conversations/$id/accept")->assertOk()->assertJsonPath('data.folder', 'chats')->assertJsonPath('data.unread_count', 0);
        $this->postJson("/api/v1/conversations/$id/accept")->assertNotFound();

        msgActAs($max);
        $this->getJson("/api/v1/conversations/$id")->assertJsonPath('data.request_pending', false);
        $this->postJson("/api/v1/conversations/$id/messages", ['type' => 'text', 'body' => 'Danke fürs Annehmen!', 'client_id' => (string) Str::uuid()])->assertCreated();
    });

    it('hides a declined request for the recipient and tells the sender nothing', function () {
        $max = ntfMember('max.e46');
        $lukas = ntfMember('lukas.sc');
        $id = msgStart($max, $lukas, chat: false)->conversation_id;

        msgActAs($lukas);
        $this->postJson("/api/v1/conversations/$id/decline")->assertNoContent();
        $this->getJson("/api/v1/conversations/$id")->assertNotFound();
        $this->getJson('/api/v1/conversations?folder=requests')->assertJsonCount(0, 'data');

        msgActAs($max);
        $this->getJson("/api/v1/conversations/$id")->assertOk()->assertJsonPath('data.request_pending', true);
        $this->postJson("/api/v1/conversations/$id/messages", ['type' => 'text', 'body' => 'Noch da?', 'client_id' => (string) Str::uuid()])
            ->assertStatus(409)->assertJsonPath('code', 'request_pending');
    });

    it('accepts a request when the recipient writes back', function () {
        $max = ntfMember('max.e46');
        $lukas = ntfMember('lukas.sc');
        $id = msgStart($max, $lukas, chat: false)->conversation_id;

        msgActAs($lukas);
        $this->postJson("/api/v1/conversations/$id/messages", ['type' => 'text', 'body' => 'Klar, frag ruhig.', 'client_id' => (string) Str::uuid()])->assertCreated();

        expect(msgSide($id, $lukas)->folder)->toBe(ConversationFolder::Chats)->and(msgSide($id, $lukas)->accepted_at)->not->toBeNull();
    });

    it('answers accept and decline with 404 outside a request', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $id = msgStart($lukas, $jann)->conversation_id;
        msgActAs($jann);

        $this->postJson("/api/v1/conversations/$id/accept")->assertNotFound();
        $this->postJson("/api/v1/conversations/$id/decline")->assertNotFound();
        msgActAs($lukas);
        $this->postJson("/api/v1/conversations/$id/accept")->assertNotFound();
    });
});

describe('inbox', function () {
    it('orders pinned first, then by the newest message, and pages with a cursor', function () {
        $lukas = ntfMember('lukas.sc');
        $others = User::factory()->count(4)->create();

        foreach ($others as $index => $other) {
            $this->travel(1)->minutes();
            msgStart($other, $lukas, "Nachricht $index");
        }

        $oldest = msgConversation($lukas, $others[0]);
        msgActAs($lukas);
        $this->patchJson("/api/v1/conversations/{$oldest->id}", ['pinned' => true])->assertOk()->assertJsonPath('data.pinned_at', fn ($at) => $at !== null);

        $first = $this->getJson('/api/v1/conversations?per_page=2')->assertOk();
        expect(collect($first->json('data'))->pluck('other.username')->all())->toBe([$others[0]->username, $others[3]->username]);

        $second = $this->getJson('/api/v1/conversations?per_page=2&cursor='.$first->json('meta.next_cursor'))->assertOk();
        expect(collect($second->json('data'))->pluck('other.username')->all())->toBe([$others[2]->username, $others[1]->username])
            ->and($second->json('meta.next_cursor'))->toBeNull();
    });

    it('refuses a forged cursor', function (string $cursor) {
        msgActAs(ntfMember('lukas.sc'));

        $this->getJson('/api/v1/conversations?cursor='.$cursor)->assertUnprocessable()->assertJsonValidationErrors('cursor');
    })->with([
        'garbage' => ['abc'],
        'wrong columns' => [rtrim(strtr(base64_encode(json_encode(['id' => 'x', '_pointsToNextItems' => true])), '+/', '-_'), '=')],
        'bad values' => [rtrim(strtr(base64_encode(json_encode(['inbox_pinned' => 5, 'inbox_at' => 'now', 'conversation_id' => 'x', '_pointsToNextItems' => true])), '+/', '-_'), '=')],
    ]);

    it('shows the last message the member sees as the preview, typed for photos and vehicles', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $first = msgStart($jann, $lukas, "Erste\nZeile");
        $id = $first->conversation_id;
        $second = msgSend($jann, $id, 'Zweite');
        msgActAs($lukas);

        $this->getJson('/api/v1/conversations')->assertJsonPath('data.0.last_message.body', 'Zweite')->assertJsonPath('data.0.unread_count', 2);
        $this->deleteJson("/api/v1/messages/{$second->id}")->assertNoContent();
        $this->getJson('/api/v1/conversations')
            ->assertJsonPath('data.0.last_message.id', $first->id)
            ->assertJsonPath('data.0.last_message.body', 'Erste Zeile')
            ->assertJsonPath('data.0.last_message.is_mine', false)
            ->assertJsonPath('data.0.unread_count', 1);
    });

    it('[SIG organise] finds conversations by the other member and by message words', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs', ['display_name' => 'Jann Peters']);
        $kenji = ntfMember('kenji.r34', ['display_name' => 'Kenji']);
        msgStart($jann, $lukas, 'Hast du das Gewindefahrwerk schon eingetragen?');
        msgStart($kenji, $lukas, 'RB26 läuft wieder');
        msgActAs($lukas);

        $names = fn (string $q) => collect($this->getJson('/api/v1/conversations?q='.urlencode($q))->assertOk()->json('data'))->pluck('other.username')->all();

        expect($names('jann'))->toBe(['jann.ptrs'])
            ->and($names('peters'))->toBe(['jann.ptrs'])
            ->and($names('gewinde'))->toBe(['jann.ptrs'])
            ->and($names('rb26 läuft'))->toBe(['kenji.r34'])
            ->and($names('fahrwerk'))->toBe([])
            ->and($names('zzz'))->toBe([]);
    });

    it('ignores q while organise is off', function () {
        $lukas = ntfMember('lukas.sc');
        msgStart(ntfMember('jann.ptrs'), $lukas);
        msgFlags(false);
        msgActAs($lukas);

        $this->getJson('/api/v1/conversations?q=zzz')->assertOk()->assertJsonCount(1, 'data');
    });

    it('counts unread chats without muted or archived ones for the tab badge', function () {
        $lukas = ntfMember('lukas.sc');
        $a = msgStart(ntfMember('jann.ptrs'), $lukas)->conversation_id;
        $b = msgStart(ntfMember('kenji.r34'), $lukas)->conversation_id;
        $c = msgStart(ntfMember('sara.gti'), $lukas)->conversation_id;
        msgActAs($lukas);

        $this->getJson('/api/v1/notifications/unread-count')->assertJsonPath('data.messages', 3);
        $this->patchJson("/api/v1/conversations/$a", ['muted_until' => now()->addDay()->toIso8601String()])->assertOk();
        $this->patchJson("/api/v1/conversations/$b", ['archived' => true])->assertOk()->assertJsonPath('data.folder', 'archived');
        $this->getJson('/api/v1/notifications/unread-count')->assertJsonPath('data.messages', 1);
        $this->getJson('/api/v1/conversations?folder=archived')->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $b);
        expect($c)->toBeString();
    });

    it('brings an archived chat back with a new message unless it is muted', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $id = msgStart($jann, $lukas)->conversation_id;
        msgActAs($lukas);
        $this->patchJson("/api/v1/conversations/$id", ['archived' => true])->assertOk();

        msgSend($jann, $id);
        expect(msgSide($id, $lukas)->archived_at)->toBeNull();

        $this->patchJson("/api/v1/conversations/$id", ['archived' => true, 'muted_until' => now()->addWeek()->toIso8601String()])->assertOk();
        msgSend($jann, $id);
        expect(msgSide($id, $lukas)->archived_at)->not->toBeNull();
    });
});

describe('PATCH conversations/{id} [SIG organise]', function () {
    it('validates and limits pins to five', function () {
        $lukas = ntfMember('lukas.sc');
        $ids = User::factory()->count(6)->create()->map(fn (User $other) => msgStart($other, $lukas)->conversation_id);
        msgActAs($lukas);

        foreach ($ids->take(5) as $id) {
            $this->patchJson("/api/v1/conversations/$id", ['pinned' => true])->assertOk();
        }

        $this->patchJson("/api/v1/conversations/{$ids[5]}", ['pinned' => true])->assertUnprocessable()->assertJsonValidationErrors('pinned');
        $this->patchJson("/api/v1/conversations/{$ids[5]}", [])->assertUnprocessable();
        $this->patchJson("/api/v1/conversations/{$ids[5]}", ['pinned' => 'yes'])->assertUnprocessable()->assertJsonValidationErrors('pinned');
        $this->patchJson("/api/v1/conversations/{$ids[5]}", ['muted_until' => now()->subDay()->toIso8601String()])->assertUnprocessable()->assertJsonValidationErrors('muted_until');
        $this->patchJson("/api/v1/conversations/{$ids[0]}", ['muted_until' => null])->assertOk()->assertJsonPath('data.muted_until', null);
    });

    it('mutes with no end ("Bis du es wieder änderst") as muted: true with muted_until null, and unmutes with muted: false', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $id = msgStart($jann, $lukas)->conversation_id;
        msgActAs($lukas);

        $this->getJson("/api/v1/conversations/$id")->assertJsonPath('data.muted', false)->assertJsonPath('data.muted_until', null);

        $this->patchJson("/api/v1/conversations/$id", ['muted' => true, 'muted_until' => null])->assertOk()
            ->assertJsonPath('data.muted', true)
            ->assertJsonPath('data.muted_until', null);
        expect(msgSide($id, $lukas)->muted_indefinitely)->toBeTrue()
            ->and(msgSide($id, $lukas)->isMuted())->toBeTrue();
        $this->getJson('/api/v1/notifications/unread-count')->assertJsonPath('data.messages', 0);

        // Years later it is still muted, in the list too.
        $this->travel(3)->years();
        $this->getJson('/api/v1/conversations')->assertJsonPath('data.0.muted', true)->assertJsonPath('data.0.muted_until', null);
        $this->travelBack();

        // An archived chat muted with no end stays archived when a message comes.
        $this->patchJson("/api/v1/conversations/$id", ['archived' => true])->assertOk();
        msgSend($jann, $id);
        expect(msgSide($id, $lukas)->archived_at)->not->toBeNull();
        $this->patchJson("/api/v1/conversations/$id", ['archived' => false])->assertOk();

        $this->patchJson("/api/v1/conversations/$id", ['muted' => false])->assertOk()
            ->assertJsonPath('data.muted', false)
            ->assertJsonPath('data.muted_until', null);
        expect(msgSide($id, $lukas)->muted_indefinitely)->toBeFalse();
        // Both unread messages count again: the first and the one that came while it was muted.
        $this->getJson('/api/v1/notifications/unread-count')->assertJsonPath('data.messages', 2);
    });

    it('mutes with no end on muted: true alone, and a timed mute replaces it', function () {
        $lukas = ntfMember('lukas.sc');
        $id = msgStart(ntfMember('jann.ptrs'), $lukas)->conversation_id;
        msgActAs($lukas);

        $this->patchJson("/api/v1/conversations/$id", ['muted' => true])->assertOk()->assertJsonPath('data.muted', true)->assertJsonPath('data.muted_until', null);

        $until = now()->addDay()->startOfSecond();
        $this->patchJson("/api/v1/conversations/$id", ['muted' => true, 'muted_until' => $until->toIso8601String()])->assertOk()
            ->assertJsonPath('data.muted', true)
            ->assertJsonPath('data.muted_until', $until->utc()->toIso8601ZuluString());
        expect(msgSide($id, $lukas)->muted_indefinitely)->toBeFalse();

        // A timed mute runs out on its own; the old form without `muted` still works.
        $this->travel(2)->days();
        $this->getJson("/api/v1/conversations/$id")->assertJsonPath('data.muted', false);
        $this->patchJson("/api/v1/conversations/$id", ['muted_until' => now()->addHour()->toIso8601String()])->assertOk()->assertJsonPath('data.muted', true);
        $this->patchJson("/api/v1/conversations/$id", ['muted' => true])->assertOk()->assertJsonPath('data.muted_until', null);
        $this->patchJson("/api/v1/conversations/$id", ['muted_until' => null])->assertOk()->assertJsonPath('data.muted', false);
        expect(msgSide($id, $lukas)->muted_indefinitely)->toBeFalse();
    });

    it('validates muted', function () {
        $lukas = ntfMember('lukas.sc');
        $id = msgStart(ntfMember('jann.ptrs'), $lukas)->conversation_id;
        msgActAs($lukas);

        $this->patchJson("/api/v1/conversations/$id", ['muted' => 'yes'])->assertUnprocessable()->assertJsonValidationErrors('muted');
        $this->patchJson("/api/v1/conversations/$id", ['muted' => 1])->assertUnprocessable()->assertJsonValidationErrors('muted');
        $this->patchJson("/api/v1/conversations/$id", ['muted' => false, 'muted_until' => now()->addDay()->toIso8601String()])->assertUnprocessable()->assertJsonValidationErrors('muted_until');
        $this->patchJson("/api/v1/conversations/$id", ['muted' => true, 'muted_until' => now()->addYears(2)->toIso8601String()])->assertUnprocessable()->assertJsonValidationErrors('muted_until');
        expect(msgSide($id, $lukas)->isMuted())->toBeFalse();
    });

    it('mutes only for a participant: guests 401, other members 404, a request 422', function () {
        $lukas = ntfMember('lukas.sc');
        $id = msgStart(ntfMember('jann.ptrs'), $lukas)->conversation_id;
        $request = msgStart(ntfMember('max.e46'), $lukas, chat: false)->conversation_id;

        $this->patchJson("/api/v1/conversations/$id", ['muted' => true])->assertUnauthorized();

        msgActAs(ntfMember('kenji.r34'));
        $this->patchJson("/api/v1/conversations/$id", ['muted' => true])->assertNotFound();

        msgActAs($lukas);
        $this->patchJson("/api/v1/conversations/$request", ['muted' => true])->assertUnprocessable()->assertJsonValidationErrors('muted');
        // Code review M2.8 nit 10: the refusal names the key that was sent.
        $this->patchJson("/api/v1/conversations/$request", ['muted_until' => now()->addDay()->toIso8601String()])
            ->assertUnprocessable()->assertJsonValidationErrors('muted_until')->assertJsonMissingValidationErrors('muted');
        $this->patchJson("/api/v1/conversations/$request", ['pinned' => true])->assertUnprocessable()->assertJsonValidationErrors('pinned');
        expect(msgSide($id, $lukas)->isMuted())->toBeFalse()
            ->and(msgSide($request, $lukas)->isMuted())->toBeFalse();
    });

    it('answers 404 feature_disabled while organise is off', function () {
        $lukas = ntfMember('lukas.sc');
        $id = msgStart(ntfMember('jann.ptrs'), $lukas)->conversation_id;
        msgFlags(false);
        msgActAs($lukas);

        $this->patchJson("/api/v1/conversations/$id", ['pinned' => true])->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    });

    it('does not organise a request', function () {
        $lukas = ntfMember('lukas.sc');
        $id = msgStart(ntfMember('max.e46'), $lukas, chat: false)->conversation_id;
        msgActAs($lukas);

        $this->patchJson("/api/v1/conversations/$id", ['pinned' => true])->assertUnprocessable();
    });
});

describe('delete for me', function () {
    it('hides the conversation for me only and revives it with only the later messages', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $old = msgStart($jann, $lukas, 'Alte Nachricht');
        $id = $old->conversation_id;
        msgActAs($lukas);

        $this->deleteJson("/api/v1/conversations/$id")->assertNoContent();
        $this->getJson("/api/v1/conversations/$id")->assertNotFound();
        $this->getJson('/api/v1/conversations')->assertJsonCount(0, 'data');

        msgActAs($jann);
        $this->getJson("/api/v1/conversations/$id/messages")->assertJsonCount(1, 'data');

        $new = msgSend($jann, $id, 'Bist du am Samstag beim Treffen?');
        msgActAs($lukas);
        $this->getJson('/api/v1/conversations')->assertJsonCount(1, 'data')->assertJsonPath('data.0.unread_count', 1);
        $this->getJson("/api/v1/conversations/$id/messages")->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $new->id);
    });

    it('starts again from my side on the same row with the history still cleared', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $id = msgStart($jann, $lukas, 'Alte Nachricht')->conversation_id;
        msgActAs($lukas);
        $this->deleteJson("/api/v1/conversations/$id")->assertNoContent();

        $response = $this->postJson('/api/v1/conversations', msgStartBody($jann))->assertOk();

        expect($response->json('data.conversation.id'))->toBe($id);
        $this->getJson("/api/v1/conversations/$id/messages")->assertJsonCount(1, 'data')->assertJsonPath('data.0.is_mine', true);
    });

    it('hides a single message for me only', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $message = msgStart($jann, $lukas);
        msgActAs($lukas);

        $this->deleteJson("/api/v1/messages/{$message->id}")->assertNoContent();
        $this->deleteJson("/api/v1/messages/{$message->id}")->assertNotFound();
        $this->getJson("/api/v1/conversations/{$message->conversation_id}/messages")->assertJsonCount(0, 'data');

        msgActAs($jann);
        $this->getJson("/api/v1/conversations/{$message->conversation_id}/messages")->assertJsonCount(1, 'data');
    });
});

describe('block', function () {
    it('closes the conversation for both, keeps it closed after an unblock, and a new start shows only what comes after', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $id = msgStart($jann, $lukas, 'Vor dem Block')->conversation_id;

        app(BlockMember::class)->handle($lukas, $jann);

        foreach ([$lukas, $jann] as $member) {
            msgActAs($member);
            $this->getJson("/api/v1/conversations/$id")->assertNotFound();
            $this->getJson('/api/v1/conversations')->assertJsonCount(0, 'data');
            $this->postJson("/api/v1/conversations/$id/messages", ['type' => 'text', 'body' => 'Hallo?', 'client_id' => (string) Str::uuid()])->assertNotFound();
        }

        msgActAs($jann);
        $this->postJson('/api/v1/conversations', msgStartBody($lukas))->assertForbidden()->assertJsonPath('reason', 'recipient_closed');

        app(UnblockMember::class)->handle($lukas, $jann, 'jann.ptrs');
        msgActAs($lukas);
        $this->getJson('/api/v1/conversations')->assertJsonCount(0, 'data');

        $this->postJson('/api/v1/conversations', msgStartBody($jann, ['message' => ['body' => 'Neuer Anfang']]))->assertOk()->assertJsonPath('data.conversation.id', $id);
        $this->getJson("/api/v1/conversations/$id/messages")->assertJsonCount(1, 'data')->assertJsonPath('data.0.body', 'Neuer Anfang');

        msgActAs($jann);
        $this->getJson("/api/v1/conversations/$id/messages")->assertJsonCount(1, 'data')->assertJsonPath('data.0.body', 'Neuer Anfang');
    });

    it('hides a conversation behind a block row written without BlockMember too', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $id = msgStart($jann, $lukas)->conversation_id;
        socBlock($jann, $lukas);
        msgActAs($lukas);

        $this->getJson("/api/v1/conversations/$id")->assertNotFound();
        $this->getJson('/api/v1/conversations')->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/notifications/unread-count')->assertJsonPath('data.messages', 0);
    });
});

describe('deleted accounts', function () {
    it('keeps the copy for the other side and shows the author as a deleted member', function (Closure $delete) {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $message = msgStart($jann, $lukas);
        $delete($jann);
        msgActAs($lukas);

        $this->getJson('/api/v1/conversations')->assertOk()
            ->assertJsonPath('data.0.other', null)
            ->assertJsonPath('data.0.other_deleted', true)
            ->assertJsonPath('data.0.can_send', false)
            ->assertJsonPath('data.0.cannot_send_reason', 'recipient_closed');
        $this->getJson("/api/v1/conversations/{$message->conversation_id}/messages")->assertOk()
            ->assertJsonPath('data.0.sender', null)
            ->assertJsonPath('data.0.sender_deleted', true)
            ->assertJsonPath('data.0.body', $message->body);
        $this->postJson("/api/v1/conversations/{$message->conversation_id}/messages", ['type' => 'text', 'body' => 'Hallo?', 'client_id' => (string) Str::uuid()])
            ->assertForbidden()->assertJsonPath('code', 'cannot_message');
    })->with([
        'deactivated' => [fn (User $user) => $user->forceFill(['status' => 'deactivated'])->save()],
        'soft-deleted' => [fn (User $user) => $user->delete()],
        'hard-deleted' => [fn (User $user) => $user->forceDelete()],
    ]);
});

it('starts the participant rows with an index the inbox reads', function () {
    $lukas = ntfMember('lukas.sc');
    msgStart(ntfMember('jann.ptrs'), $lukas);

    expect(ConversationParticipant::query()->where('user_id', $lukas->id)->value('last_message_at'))->not->toBeNull();
});

it('tells MSG-03 in member search whom the viewer may write to', function () {
    $lukas = ntfMember('lukas.sc');
    ntfMember('jann.ptrs');
    ntfMember('jann.closed', ['who_can_message' => WhoCanMessage::Nobody]);
    $rows = fn () => collect($this->getJson('/api/v1/search/users?q=jann')->assertOk()->json('data'))->keyBy('username');

    expect($rows()['jann.ptrs'])->toMatchArray(['can_message' => false, 'cannot_message_reason' => null]);

    msgActAs($lukas);
    expect($rows()['jann.ptrs'])->toMatchArray(['can_message' => true, 'cannot_message_reason' => null])
        ->and($rows()['jann.closed'])->toMatchArray(['can_message' => false, 'cannot_message_reason' => 'recipient_closed']);
});
