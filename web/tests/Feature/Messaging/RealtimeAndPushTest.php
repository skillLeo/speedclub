<?php

use App\Mail\MessageDigestMail;
use App\Models\User;
use App\Services\Messaging\Conversations;
use App\Services\Messaging\SendMessagePush;
use App\Services\Notifications\ExpoPush;
use App\Services\Notifications\NotificationTexts;
use App\Services\Notifications\Notifier;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

require_once __DIR__.'/MessagingTestHelpers.php';

beforeEach(function () {
    msgFlags();
});

function msgConnectSrc(?string $header): string
{
    foreach (explode(';', (string) $header) as $directive) {
        [$name, $value] = array_pad(explode(' ', trim($directive), 2), 2, '');

        if ($name === 'connect-src') {
            return $value;
        }
    }

    return '';
}

function msgPusherKeys(): void
{
    config([
        'broadcasting.default' => 'pusher',
        'broadcasting.connections.pusher.key' => 'public-key',
        'broadcasting.connections.pusher.secret' => 'very-secret',
        'broadcasting.connections.pusher.app_id' => '12345',
        'broadcasting.connections.pusher.options.cluster' => 'eu',
    ]);
}

describe('POST broadcasting/auth', function () {
    it('signs the own user channel and a conversation channel of an active participant', function () {
        msgPusherKeys();
        $lukas = ntfMember('lukas.sc');
        $id = msgStart(ntfMember('jann.ptrs'), $lukas)->conversation_id;
        msgActAs($lukas);

        foreach (["private-user.{$lukas->id}", "private-conversation.$id"] as $channel) {
            $auth = $this->postJson('/api/v1/broadcasting/auth', ['channel_name' => $channel, 'socket_id' => '1234.5678'])->assertOk()->json('auth');
            expect($auth)->toBe('public-key:'.hash_hmac('sha256', "1234.5678:$channel", 'very-secret'));
        }
    });

    it('signs for a cookie session (the web guard Sanctum reads first) too', function () {
        msgPusherKeys();
        $lukas = ntfMember('lukas.sc');

        $this->actingAs($lukas, 'web')
            ->postJson('/api/v1/broadcasting/auth', ['channel_name' => "private-user.{$lukas->id}", 'socket_id' => '1.2'])
            ->assertOk()->assertJsonStructure(['auth']);
    });

    it('refuses every other channel with 403', function (Closure $channel) {
        msgPusherKeys();
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $id = msgStart($jann, $lukas)->conversation_id;
        msgActAs($lukas);

        $this->postJson('/api/v1/broadcasting/auth', ['channel_name' => $channel($lukas, $jann, $id), 'socket_id' => '1.2'])->assertForbidden();
    })->with([
        'another member channel' => [fn (User $lukas, User $jann, string $id) => "private-user.{$jann->id}"],
        'a conversation of others' => [fn (User $lukas, User $jann, string $id) => 'private-conversation.'.msgStart(ntfMember('max.e46'), ntfMember('kenji.r34'))->conversation_id],
        'a conversation behind a block' => [function (User $lukas, User $jann, string $id) {
            socBlock($jann, $lukas);

            return "private-conversation.$id";
        }],
        'a conversation deleted for me' => [function (User $lukas, User $jann, string $id) {
            msgSide($id, $lukas)->forceFill(['deleted_at' => now()])->save();

            return "private-conversation.$id";
        }],
        'a public channel' => [fn () => 'conversation.x'],
        'a presence channel' => [fn (User $lukas) => "presence-user.{$lukas->id}"],
    ]);

    it('validates the socket id and answers 404 feature_disabled without keys', function () {
        $lukas = ntfMember('lukas.sc');
        msgActAs($lukas);

        $this->postJson('/api/v1/broadcasting/auth', ['channel_name' => "private-user.{$lukas->id}", 'socket_id' => '1.2'])->assertNotFound()->assertJsonPath('code', 'feature_disabled');
        msgPusherKeys();
        $this->postJson('/api/v1/broadcasting/auth', ['channel_name' => "private-user.{$lukas->id}", 'socket_id' => 'x'])->assertUnprocessable()->assertJsonValidationErrors('socket_id');
    });
});

describe('app-config and the /app CSP', function () {
    beforeEach(function () {
        $this->index = tempnam(sys_get_temp_dir(), 'spa');
        file_put_contents($this->index, '<!doctype html><title>x</title>');
        config(['speedclub.spa.index' => $this->index]);
    });

    afterEach(function () {
        @unlink($this->index);
    });

    it('stays polling and connect-src self without keys', function () {
        config(['broadcasting.default' => 'null']);

        $this->getJson('/api/v1/app-config')->assertOk()->assertJsonPath('data.realtime', ['enabled' => false, 'key' => null, 'cluster' => null]);
        expect(msgConnectSrc($this->get('/app')->headers->get('Content-Security-Policy')))->toBe("'self'");
    });

    it('stays off when a key is missing even with BROADCAST_CONNECTION=pusher', function () {
        msgPusherKeys();
        config(['broadcasting.connections.pusher.secret' => null]);

        $this->getJson('/api/v1/app-config')->assertJsonPath('data.realtime.enabled', false);
        expect(msgConnectSrc($this->get('/app')->headers->get('Content-Security-Policy')))->toBe("'self'");
    });

    it('gives the public key and cluster, never the secret, and opens connect-src to the EU hosts only', function () {
        msgPusherKeys();

        $config = $this->getJson('/api/v1/app-config')->assertOk();
        expect($config->json('data.realtime'))->toBe(['enabled' => true, 'key' => 'public-key', 'cluster' => 'eu'])
            ->and($config->getContent())->not->toContain('very-secret')->not->toContain('12345');

        $connect = msgConnectSrc($this->get('/app')->headers->get('Content-Security-Policy'));
        expect($connect)->toBe("'self' wss://ws-eu.pusher.com https://sockjs-eu.pusher.com https://stats.pusher.com")
            ->and($connect)->not->toContain('*');
    });
});

describe('message pushes', function () {
    it('pushes a generic text after the response, with the path and no content', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $id = msgStart($jann, $lukas)->conversation_id;
        ntfPushOn($lukas);
        $this->travelTo(CarbonImmutable::parse('2026-11-08 12:00', 'Europe/Berlin'));
        msgActAs($jann);

        $this->postJson("/api/v1/conversations/$id/messages", ['type' => 'text', 'body' => 'Streng geheim: 7731', 'client_id' => (string) Str::uuid()])->assertCreated();

        $pushes = ntfPushes();
        expect($pushes)->toHaveCount(1)
            ->and($pushes[0][0]['body'])->toBe('Neue Nachricht von @jann.ptrs')
            ->and($pushes[0][0]['data'])->toBe(['type' => 'new_message', 'notification_id' => null, 'path' => "/messages/$id"])
            ->and(json_encode($pushes))->not->toContain('7731')
            ->and(DB::table('notifications')->count())->toBe(0);
    });

    it('pushes "@name möchte dir schreiben" for a request to its MSG-04 path, never with a preview', function () {
        $lukas = ntfMember('lukas.sc', ['notification_prefs' => ['message_previews' => true]]);
        $max = ntfMember('max.e46');
        ntfPushOn($lukas);
        $this->travelTo(CarbonImmutable::parse('2026-11-08 12:00', 'Europe/Berlin'));
        msgActAs($max);

        $id = $this->postJson('/api/v1/conversations', msgStartBody($lukas, ['message' => ['body' => 'Hallo, kurze Frage zum S15']]))->assertCreated()->json('data.conversation.id');

        $pushes = ntfPushes();
        expect($pushes[0][0]['body'])->toBe('@max.e46 möchte dir schreiben')
            ->and($pushes[0][0]['data'])->toBe(['type' => 'message_request', 'notification_id' => null, 'path' => "/messages/requests/$id"])
            ->and(json_encode($pushes))->not->toContain('S15');
    });

    it('shows the start of a text only to a member who turned previews on', function () {
        $lukas = ntfMember('lukas.sc', ['notification_prefs' => ['message_previews' => true]]);
        $jann = ntfMember('jann.ptrs');
        $id = msgStart($jann, $lukas)->conversation_id;
        ntfPushOn($lukas);
        $this->travelTo(CarbonImmutable::parse('2026-11-08 12:00', 'Europe/Berlin'));
        msgActAs($jann);

        $this->postJson("/api/v1/conversations/$id/messages", ['type' => 'text', 'body' => 'Bist du am Samstag dabei?', 'client_id' => (string) Str::uuid()])->assertCreated();

        expect(ntfPushes()[0][0])->toMatchArray(['title' => '@jann.ptrs', 'body' => 'Bist du am Samstag dabei?']);
    });

    it('stays silent when muted, in quiet hours, switched off, read already or within the cooldown', function (Closure $setup, string $at) {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $id = msgStart($jann, $lukas)->conversation_id;
        ntfPushOn($lukas);
        $this->travelTo(CarbonImmutable::parse($at, 'Europe/Berlin'));
        $setup($lukas, $id);
        msgActAs($jann);

        $this->postJson("/api/v1/conversations/$id/messages", ['type' => 'text', 'body' => 'Hallo', 'client_id' => (string) Str::uuid()])->assertCreated();

        expect(ntfPushes())->toBe([]);
    })->with([
        'muted' => [fn (User $lukas, string $id) => msgSide($id, $lukas)->forceFill(['muted_until' => now()->addDay()])->save(), '2026-11-08 12:00'],
        'muted with no end' => [fn (User $lukas, string $id) => msgSide($id, $lukas)->forceFill(['muted_indefinitely' => true])->save(), '2026-11-08 12:00'],
        'quiet hours' => [fn () => null, '2026-11-08 23:30'],
        'switched off' => [fn (User $lukas) => $lukas->forceFill(['notification_prefs' => ['types' => ['new_message' => ['push' => false]]]])->save(), '2026-11-08 12:00'],
        'cooldown' => [fn (User $lukas, string $id) => cache()->put("push:message:$id:{$lukas->id}", true, 30), '2026-11-08 12:00'],
    ]);

    it('decides again when the push runs', function () {
        $lukas = ntfMember('lukas.sc');
        $jann = ntfMember('jann.ptrs');
        $message = msgStart($jann, $lukas);
        ntfPushOn($lukas);
        $this->travelTo(CarbonImmutable::parse('2026-11-08 12:00', 'Europe/Berlin'));
        msgSide($message->conversation_id, $lukas)->forceFill(['last_read_message_id' => $message->id])->save();

        (new SendMessagePush($lukas->id, $jann->id, $message->conversation_id, $message->id))->handle(app(ExpoPush::class), app(Conversations::class), app(Notifier::class), app(NotificationTexts::class));
        socBlock($lukas, $jann);
        msgSide($message->conversation_id, $lukas)->forceFill(['last_read_message_id' => null])->save();
        dispatch_sync(new SendMessagePush($lukas->id, $jann->id, $message->conversation_id, $message->id));

        expect(ntfPushes())->toBe([]);
    });

    it('queues nothing while push is off', function () {
        Bus::fake([SendMessagePush::class]);
        $lukas = ntfMember('lukas.sc');
        msgStart(ntfMember('jann.ptrs'), $lukas);

        Bus::assertNotDispatched(SendMessagePush::class);
    });
});

describe('e-mail digest', function () {
    it('mails a count once when chat messages stayed unread for more than 12 h, for members who turned it on', function () {
        Mail::fake();
        $lukas = ntfMember('lukas.sc', ['notification_prefs' => ['types' => ['new_message' => ['email_digest' => true]]]]);
        $sara = ntfMember('sara.gti');
        msgStart(ntfMember('jann.ptrs'), $lukas, 'Hast du Zeit am Wochenende?');
        msgStart(ntfMember('kenji.r34'), $lukas);
        msgStart(ntfMember('max.e46'), $sara);

        $this->travel(11)->hours();
        $this->artisan('messages:digest')->assertSuccessful();
        Mail::assertNothingQueued();

        $this->travel(2)->hours();
        $this->artisan('messages:digest')->assertSuccessful();
        Mail::assertQueued(MessageDigestMail::class, fn (MessageDigestMail $mail) => $mail->hasTo($lukas->email) && $mail->conversations === 2);
        Mail::assertQueuedCount(1);

        $this->artisan('messages:digest')->assertSuccessful();
        Mail::assertQueuedCount(1);
    });

    it('never holds a message text', function () {
        app()->setLocale('de');
        $html = (new MessageDigestMail(1))->render();

        expect($html)->toContain('In einer Unterhaltung wartet seit über 12 Stunden eine Nachricht auf dich.')
            ->and($html)->toContain('/app/messages');
    });

    it('leaves out read, muted and request conversations', function () {
        Mail::fake();
        $lukas = ntfMember('lukas.sc', ['notification_prefs' => ['types' => ['new_message' => ['email_digest' => true]]]]);
        $read = msgStart(ntfMember('jann.ptrs'), $lukas);
        $muted = msgStart(ntfMember('kenji.r34'), $lukas)->conversation_id;
        msgStart(ntfMember('max.e46'), $lukas, chat: false);
        msgSide($read->conversation_id, $lukas)->forceFill(['last_read_message_id' => $read->id, 'unread_count' => 0])->save();
        msgSide($muted, $lukas)->forceFill(['muted_until' => now()->addMonth()])->save();

        $this->travel(13)->hours();
        $this->artisan('messages:digest')->assertSuccessful();

        Mail::assertNothingQueued();
    });

    it('leaves out a conversation muted with no end', function () {
        Mail::fake();
        $lukas = ntfMember('lukas.sc', ['notification_prefs' => ['types' => ['new_message' => ['email_digest' => true]]]]);
        $muted = msgStart(ntfMember('kenji.r34'), $lukas)->conversation_id;
        msgSide($muted, $lukas)->forceFill(['muted_indefinitely' => true])->save();

        $this->travel(13)->hours();
        $this->artisan('messages:digest')->assertSuccessful();

        Mail::assertNothingQueued();
    });
});
