<?php

use App\Actions\Account\DeleteAccount;
use App\Enums\UserStatus;
use App\Events\ConversationRead;
use App\Events\MessageSent;
use App\Events\MessagingEvent;
use App\Events\Typing;
use App\Events\UnreadChanged;
use App\Models\User;
use App\Services\Auth\DeviceSessions;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/MessagingTestHelpers.php';

/**
 * M2.5 review item 25 (M2.8): realtime after a session revoke or an account deletion. POST broadcasting/auth refuses a revoked token
 * and a closed account, and neither the revoke nor the deletion, nor anything the other member does afterwards, sends an event to the
 * member's private channel. A socket that subscribed before stays subscribed until it disconnects: Pusher asks the server only when a
 * channel is joined, and the app does not use Pusher's user sign-in, the only way to end another client's connection. Every event
 * carries ids only, and what it points to needs a token the API no longer takes (05_ARCHITECTURE §11).
 */
beforeEach(function () {
    msgFlags();
    Mail::fake();
    $this->withoutDefer();
    config([
        'broadcasting.default' => 'pusher',
        'broadcasting.connections.pusher.key' => 'rt-key',
        'broadcasting.connections.pusher.secret' => 'rt-secret',
        'broadcasting.connections.pusher.app_id' => '12345',
        'broadcasting.connections.pusher.options.cluster' => 'eu',
    ]);
    $this->lukas = ntfMember('lukas.sc');
    $this->jann = ntfMember('jann.ptrs');
    $this->conversation = msgStart($this->jann, $this->lukas)->conversation_id;
});

/** A fresh request with a bearer token, as the app's pusher-js authorizer sends it. */
function rtChannelAuth(string $token, string $channel): TestResponse
{
    app('auth')->forgetGuards();

    return test()->withToken($token)->postJson('/api/v1/broadcasting/auth', ['channel_name' => $channel, 'socket_id' => '1234.5678']);
}

/**
 * @return list<string>
 */
function rtChannels(User $member, string $conversationId): array
{
    return ["private-user.{$member->id}", "private-conversation.$conversationId"];
}

/** The realtime events, faked so that nothing is sent and every dispatch is recorded. */
function rtFakeEvents(): void
{
    Event::fake([MessageSent::class, UnreadChanged::class, ConversationRead::class, Typing::class]);
}

/**
 * Every recorded realtime event that names the member's user channel.
 *
 * @return list<MessagingEvent>
 */
function rtEventsFor(User $member): array
{
    $found = [];

    foreach ([MessageSent::class, UnreadChanged::class, ConversationRead::class, Typing::class] as $class) {
        foreach (Event::dispatched($class) as [$event]) {
            if (in_array("private-user.{$member->id}", array_map(fn ($channel) => $channel->name, $event->broadcastOn()), true)) {
                $found[] = $event;
            }
        }
    }

    return $found;
}

describe('POST broadcasting/auth', function () {
    it('refuses a token once its session is revoked, and keeps signing for the member\'s other devices', function () {
        $phone = $this->lukas->createToken('Pixel 9');
        $tablet = $this->lukas->createToken('iPad')->plainTextToken;

        foreach (rtChannels($this->lukas, $this->conversation) as $channel) {
            rtChannelAuth($phone->plainTextToken, $channel)->assertOk()->assertJsonStructure(['auth']);
        }

        expect(app(DeviceSessions::class)->revoke($this->lukas, 't'.$phone->accessToken->getKey()))->toBeTrue();

        foreach (rtChannels($this->lukas, $this->conversation) as $channel) {
            rtChannelAuth($phone->plainTextToken, $channel)->assertUnauthorized();
            rtChannelAuth($tablet, $channel)->assertOk();
        }
    });

    it('refuses every token of a member who asked for deletion', function () {
        $phone = $this->lukas->createToken('Pixel 9')->plainTextToken;
        $tablet = $this->lukas->createToken('iPad')->plainTextToken;
        rtChannelAuth($phone, "private-user.{$this->lukas->id}")->assertOk();

        app(DeleteAccount::class)->handle($this->lukas);

        foreach ([$phone, $tablet] as $token) {
            foreach (rtChannels($this->lukas, $this->conversation) as $channel) {
                rtChannelAuth($token, $channel)->assertUnauthorized();
            }
        }
    });

    it('refuses a closed account even if a session outlived the closing', function (Closure $close, int $status) {
        $token = $this->lukas->createToken('Pixel 9')->plainTextToken;
        $close($this->lukas);

        foreach (rtChannels($this->lukas, $this->conversation) as $channel) {
            rtChannelAuth($token, $channel)->assertStatus($status);
        }
    })->with([
        // ChannelAccess: a deactivated member joins nothing.
        'deactivated' => [fn (User $member) => $member->forceFill(['status' => UserStatus::Deactivated, 'deletion_requested_at' => now()])->save(), 403],
        // Sanctum finds no member behind the token of a soft-deleted row.
        'soft-deleted' => [fn (User $member) => $member->delete(), 401],
    ]);
});

describe('events to the member\'s private channel', function () {
    it('reach an active member (the control for the two below)', function () {
        rtFakeEvents();
        Sanctum::actingAs($this->jann);

        $this->postJson("/api/v1/conversations/{$this->conversation}/messages", ['type' => 'text', 'body' => 'Bist du noch da?', 'client_id' => (string) Str::uuid()])
            ->assertCreated();

        expect(rtEventsFor($this->lukas))->not->toBe([]);
    });

    it('do not follow a revoke or the deletion itself', function () {
        $phone = $this->lukas->createToken('Pixel 9');
        rtFakeEvents();

        app(DeviceSessions::class)->revoke($this->lukas, 't'.$phone->accessToken->getKey());
        app(DeleteAccount::class)->handle($this->lukas->fresh());

        Event::assertNotDispatched(MessageSent::class);
        Event::assertNotDispatched(UnreadChanged::class);
        Event::assertNotDispatched(ConversationRead::class);
        Event::assertNotDispatched(Typing::class);
    });

    it('do not follow from what the other member does after the deletion', function () {
        app(DeleteAccount::class)->handle($this->lukas);
        rtFakeEvents();
        Sanctum::actingAs($this->jann);

        $this->postJson("/api/v1/conversations/{$this->conversation}/messages", ['type' => 'text', 'body' => 'Bist du noch da?', 'client_id' => (string) Str::uuid()])
            ->assertJsonPath('code', 'cannot_message');
        $this->postJson("/api/v1/conversations/{$this->conversation}/typing")->assertNoContent();

        expect(rtEventsFor($this->lukas))->toBe([]);
        Event::assertNotDispatched(MessageSent::class);
        Event::assertNotDispatched(Typing::class);
    });
});
