<?php

use App\Actions\Admin\Support\AddTicketNote;
use App\Actions\Admin\Support\ReplyToTicket;
use App\Enums\NotificationType;
use App\Enums\RestrictionType;
use App\Enums\SupportTicketStatus;
use App\Enums\TicketAuthorType;
use App\Models\Notification;
use App\Models\SupportTicket;
use App\Models\TicketMessage;
use App\Models\User;
use App\Services\Notifications\NotificationTexts;
use App\Services\Notifications\SendPushNotification;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/Helpers.php';
require_once __DIR__.'/../../Notifications/NotificationTestHelpers.php';

/**
 * SET-15b: a member writes again in their own support thread (POST support/tickets/{ticket}/messages: owner only, throttled with new
 * requests, idempotent, a closed or pending ticket goes back to the team as open), and a staff reply leaves the member an in-app
 * `support_reply` notification (no push: 02_PRODUCT_SPEC §7 has no row for it).
 */
beforeEach(function () {
    $this->withHeader('Accept-Language', 'de');
    Mail::fake();
    $this->member = User::factory()->create(['locale' => 'de']);
    $this->ticket = SupportTicket::factory()->create(['user_id' => $this->member->id, 'status' => SupportTicketStatus::Pending]);
    $this->body = ['message' => 'Danke, ich habe es probiert, es klappt aber immer noch nicht.'];
});

function m3qReply(SupportTicket $ticket, array $body, ?string $key = null): TestResponse
{
    return test()->withHeaders($key === null ? [] : ['Idempotency-Key' => $key])->postJson("/api/v1/support/tickets/{$ticket->id}/messages", $body);
}

describe('POST support/tickets/{ticket}/messages', function () {
    it('adds the member\'s message and hands the ticket back to the team as open', function (SupportTicketStatus $from) {
        $this->ticket->forceFill(['status' => $from, 'closed_at' => $from === SupportTicketStatus::Closed ? now()->subDay() : null])->save();
        Sanctum::actingAs($this->member);

        m3qReply($this->ticket, $this->body)->assertCreated()
            ->assertJsonPath('data.id', $this->ticket->id)
            ->assertJsonPath('data.status', 'open')
            ->assertJsonPath('data.messages.0.body', $this->body['message']);

        $ticket = $this->ticket->fresh();
        expect($ticket->status)->toBe(SupportTicketStatus::Open)
            ->and($ticket->closed_at)->toBeNull()
            ->and($ticket->last_activity_at)->not->toBeNull()
            ->and(TicketMessage::query()->where('ticket_id', $ticket->id)->where('author_type', TicketAuthorType::Member)->where('user_id', $this->member->id)->count())->toBe(1);
    })->with(['closed' => SupportTicketStatus::Closed, 'pending' => SupportTicketStatus::Pending, 'open' => SupportTicketStatus::Open]);

    it('never answers the team\'s internal notes', function () {
        app(AddTicketNote::class)->handle(m31Staff('support'), $this->ticket, 'Interne Notiz: Konto prüfen.');
        Sanctum::actingAs($this->member);

        $messages = m3qReply($this->ticket, $this->body)->assertCreated()->json('data.messages');

        expect(collect($messages)->pluck('body')->all())->toBe([$this->body['message']]);
    });

    it('answers 401 to a guest and 404 for another member\'s ticket or a web contact\'s', function () {
        m3qReply($this->ticket, $this->body)->assertUnauthorized();

        Sanctum::actingAs(User::factory()->create());
        m3qReply($this->ticket, $this->body)->assertNotFound()->assertJsonPath('code', 'not_found');

        Sanctum::actingAs($this->member);
        m3qReply(SupportTicket::factory()->guest()->create(), $this->body)->assertNotFound();

        expect(TicketMessage::query()->count())->toBe(0);
    });

    it('refuses a closed account, and stays open to unverified, suspended, restricted and blocking members', function () {
        $deactivated = User::factory()->deactivated()->create();
        Sanctum::actingAs($deactivated);
        m3qReply(SupportTicket::factory()->create(['user_id' => $deactivated->id]), $this->body)->assertForbidden();

        $blocker = User::factory()->create();
        $blocker->blockedUsers()->attach(User::factory()->create()->id);

        foreach ([User::factory()->unverified()->create(), User::factory()->suspended()->create(), User::factory()->restrictedFrom(RestrictionType::Publishing)->create(), $blocker] as $member) {
            app('auth')->forgetGuards();
            Sanctum::actingAs($member);
            m3qReply(SupportTicket::factory()->create(['user_id' => $member->id]), $this->body)->assertCreated();
        }
    });

    it('validates the message', function (array $body) {
        Sanctum::actingAs($this->member);

        m3qReply($this->ticket, $body)->assertUnprocessable()->assertJsonPath('code', 'validation_failed')->assertJsonValidationErrors('message');
    })->with([
        'missing' => [[]],
        'too short' => [['message' => 'a']],
        'too long' => [['message' => str_repeat('a', 5001)]],
    ]);

    it('is idempotent with the same key', function () {
        Sanctum::actingAs($this->member);

        $first = m3qReply($this->ticket, $this->body, 'reply-key-0001')->assertCreated()->json();
        $second = m3qReply($this->ticket, $this->body, 'reply-key-0001')->assertCreated()->json();

        expect($second)->toBe($first)
            ->and(TicketMessage::query()->where('ticket_id', $this->ticket->id)->count())->toBe(1);
    });

    it('shares the 5 an hour of new requests', function () {
        Sanctum::actingAs($this->member);

        foreach (range(1, 5) as $ignored) {
            m3qReply($this->ticket, $this->body)->assertCreated();
        }

        m3qReply($this->ticket, $this->body)->assertStatus(429)->assertJsonPath('code', 'rate_limited');
        $this->postJson('/api/v1/support/tickets', ['category' => 'other', 'subject' => 'Frage', 'message' => 'Eine Frage zu meinem Konto.'])->assertStatus(429);
    });
});

describe('support_reply notification', function () {
    it('leaves the member one in-app row per ticket, unread again on the next answer, never a push', function () {
        ntfPushOn($this->member);
        Queue::fake();
        $staff = m31Staff('support');

        app(ReplyToTicket::class)->handle($staff, $this->ticket, 'Bitte melde dich einmal ab und wieder an.');
        $row = Notification::query()->where('notifiable_id', $this->member->id)->where('type', NotificationType::SupportReply->value)->sole();
        $row->forceFill(['read_at' => now()])->save();
        $this->travel(5)->minutes();
        app(ReplyToTicket::class)->handle($staff, $this->ticket, 'Hat es geklappt?');

        $rows = Notification::query()->where('notifiable_id', $this->member->id)->where('type', NotificationType::SupportReply->value)->get();
        expect($rows)->toHaveCount(1)
            ->and($rows[0]->read_at)->toBeNull()
            ->and($rows[0]->group_key)->toBe('support_reply:'.$this->ticket->id);
        Queue::assertNotPushed(SendPushNotification::class);

        Sanctum::actingAs($this->member);
        $this->getJson('/api/v1/notifications')->assertOk()
            ->assertJsonPath('data.0.type', 'support_reply')
            ->assertJsonPath('data.0.details.ticket_id', $this->ticket->id)
            ->assertJsonPath('data.0.details.reference', 'SC-'.strtoupper(substr($this->ticket->id, -8)))
            ->assertJsonMissingPath('data.0.details.replied_at');
    });

    it('reaches an unverified member, never a web contact or an internal note', function () {
        $unverified = User::factory()->unverified()->create();
        $ticket = SupportTicket::factory()->create(['user_id' => $unverified->id]);
        $staff = m31Staff('support');

        app(ReplyToTicket::class)->handle($staff, $ticket, 'Wir haben dir den Code noch einmal geschickt.');
        app(ReplyToTicket::class)->handle($staff, SupportTicket::factory()->guest()->create(), 'Danke für deine Nachricht.');
        app(AddTicketNote::class)->handle($staff, $this->ticket, 'Nur intern.');

        expect(Notification::query()->where('type', NotificationType::SupportReply->value)->pluck('notifiable_id')->all())->toBe([$unverified->id]);
    });

    it('has a text in German and English that names the reference, never the answer', function (string $locale, string $expected) {
        $this->member->forceFill(['locale' => $locale])->save();
        app(ReplyToTicket::class)->handle(m31Staff('support'), $this->ticket, 'Geheime Antwort mit Details.');
        $row = Notification::query()->where('type', NotificationType::SupportReply->value)->sole();
        $texts = app(NotificationTexts::class);
        $reference = 'SC-'.strtoupper(substr($this->ticket->id, -8));

        expect($texts->push($row, $this->member->refresh()))->toBe(['title' => 'SPEED CLUB', 'body' => str_replace(':reference', $reference, $expected)])
            ->and($texts->path($row))->toBe('/settings/help/requests/'.$this->ticket->id)
            ->and(NotificationType::SupportReply->pushPreference())->toBeNull()
            ->and(NotificationType::SupportReply->alwaysPushes())->toBeFalse();
    })->with([
        'de' => ['de', 'Das Support-Team hat auf deine Anfrage :reference geantwortet.'],
        'en' => ['en', 'The support team replied to your request :reference.'],
    ]);
});
