<?php

use App\Enums\GalleryPhotoStatus;
use App\Enums\RestrictionType;
use App\Models\Event;
use App\Models\EventPhoto;
use App\Models\User;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/M56TestHelpers.php';

/**
 * M5.6 gallery authorisation matrix (m5.6-contract §7): guest, member, going, checked in, organiser, blocked by the organiser,
 * restricted from publishing, suspended. Staff never act through these routes (they remove via reports, EventGalleryModerationTest).
 */
beforeEach(function () {
    m56Flags();
    m56Disks();
    $this->organiser = evOrganiser();
    $this->event = m56JustEnded($this->organiser);
    $this->attendee = User::factory()->create();
    evRsvp($this->event, $this->attendee);
    $this->approved = m56GalleryPhoto($this->event, $this->attendee);
    $this->pending = m56GalleryPhoto($this->event, $this->attendee, GalleryPhotoStatus::Pending);
});

/**
 * @return array<string, array{0: Closure(Event, User): ?User}>
 */
function m56Who(): array
{
    return [
        'guest' => [fn (Event $event, User $organiser): ?User => null],
        'member' => [fn (Event $event, User $organiser): ?User => User::factory()->create()],
        'going' => [function (Event $event): ?User {
            $member = User::factory()->create();
            evRsvp($event, $member);

            return $member;
        }],
        'checked in' => [function (Event $event): ?User {
            $member = User::factory()->create();
            m56Checkin($event, $member);

            return $member;
        }],
        'organiser' => [fn (Event $event, User $organiser): ?User => $organiser],
        'blocked by organiser' => [function (Event $event, User $organiser): ?User {
            $member = User::factory()->create();
            evRsvp($event, $member);
            socBlock($organiser, $member);

            return $member;
        }],
        'going, restricted from publishing' => [function (Event $event): ?User {
            $member = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
            evRsvp($event, $member);

            return $member;
        }],
        'going, suspended' => [function (Event $event): ?User {
            $member = User::factory()->suspended()->create();
            evRsvp($event, $member);

            return $member;
        }],
    ];
}

/**
 * @param  array<string, array{0: int, 1: string|null}>  $expect
 * @return array<string, array{0: Closure, 1: int, 2: string|null}>
 */
function m56Matrix(array $expect): array
{
    $rows = [];

    foreach (m56Who() as $name => [$who]) {
        if (! array_key_exists($name, $expect)) {
            throw new InvalidArgumentException("m56Matrix: row [$name] missing");
        }
        $rows[$name] = [$who, $expect[$name][0], $expect[$name][1]];
    }

    return $rows;
}

function m56Call(object $test, string $method, string $path, array $body = []): TestResponse
{
    return $method === 'post-multipart'
        ? $test->post($path, $body, ['Accept' => 'application/json'])
        : $test->json($method, $path, $body);
}

it('lists the approved gallery', function (Closure $who, int $status, ?string $code) {
    socActAs($who($this->event, $this->organiser));
    $response = $this->getJson("/api/v1/events/{$this->event->slug}/gallery")->assertStatus($status);
    $code === null ? $response->assertJsonPath('data.0.id', $this->approved->id) : $response->assertJsonPath('code', $code);
})->with(m56Matrix([
    'guest' => [200, null], 'member' => [200, null], 'going' => [200, null], 'checked in' => [200, null], 'organiser' => [200, null],
    'blocked by organiser' => [404, 'event_unavailable'], 'going, restricted from publishing' => [200, null], 'going, suspended' => [200, null],
]));

it('lists the pending queue', function (Closure $who, int $status, ?string $code) {
    socActAs($who($this->event, $this->organiser));
    $response = $this->getJson("/api/v1/events/{$this->event->slug}/gallery?status=pending")->assertStatus($status);
    $code === null ? $response->assertJsonPath('data.0.id', $this->pending->id) : $response->assertJsonPath('code', $code);
})->with(m56Matrix([
    'guest' => [401, 'unauthenticated'], 'member' => [403, 'forbidden'], 'going' => [403, 'forbidden'], 'checked in' => [403, 'forbidden'],
    'organiser' => [200, null], 'blocked by organiser' => [404, 'event_unavailable'], 'going, restricted from publishing' => [403, 'forbidden'],
    'going, suspended' => [403, 'forbidden'],
]));

it('uploads', function (Closure $who, int $status, ?string $code) {
    socActAs($who($this->event, $this->organiser));
    $response = m56Call($this, 'post-multipart', "/api/v1/events/{$this->event->slug}/gallery", m56Upload())->assertStatus($status);

    if ($code !== null) {
        $response->assertJsonPath('code', $code);
    }
})->with(m56Matrix([
    'guest' => [401, 'unauthenticated'], 'member' => [403, 'gallery_not_attendee'], 'going' => [201, null], 'checked in' => [201, null],
    'organiser' => [201, null], 'blocked by organiser' => [404, 'event_unavailable'],
    'going, restricted from publishing' => [403, 'account_restricted'], 'going, suspended' => [403, 'account_restricted'],
]));

it('approves and rejects', function (Closure $who, int $status, ?string $code) {
    socActAs($who($this->event, $this->organiser));
    $approve = $this->postJson("/api/v1/events/{$this->event->slug}/gallery/{$this->pending->id}/approve")->assertStatus($status);
    $code === null ? $approve->assertJsonPath('data.status', 'approved') : $approve->assertJsonPath('code', $code);

    $other = m56GalleryPhoto($this->event, $this->attendee, GalleryPhotoStatus::Pending);
    $reject = $this->postJson("/api/v1/events/{$this->event->slug}/gallery/{$other->id}/reject", ['reason' => 'Unscharf'])->assertStatus($status);
    $code === null ? $reject->assertJsonPath('data.status', 'rejected') : $reject->assertJsonPath('code', $code);
})->with(m56Matrix([
    'guest' => [401, 'unauthenticated'], 'member' => [403, 'forbidden'], 'going' => [403, 'forbidden'], 'checked in' => [403, 'forbidden'],
    'organiser' => [200, null], 'blocked by organiser' => [404, 'event_unavailable'], 'going, restricted from publishing' => [403, 'forbidden'],
    'going, suspended' => [403, 'forbidden'],
]));

it('deletes somebody else\'s photo only as the organiser', function (Closure $who, int $status, ?string $code) {
    socActAs($who($this->event, $this->organiser));
    $response = $this->deleteJson("/api/v1/events/{$this->event->slug}/gallery/{$this->approved->id}")->assertStatus($status);

    if ($code !== null) {
        $response->assertJsonPath('code', $code);
    }
    expect(EventPhoto::query()->whereKey($this->approved->id)->exists())->toBe($status !== 204);
})->with(m56Matrix([
    'guest' => [401, 'unauthenticated'], 'member' => [403, 'forbidden'], 'going' => [403, 'forbidden'], 'checked in' => [403, 'forbidden'],
    'organiser' => [204, null], 'blocked by organiser' => [404, 'event_unavailable'], 'going, restricted from publishing' => [403, 'forbidden'],
    'going, suspended' => [403, 'forbidden'],
]));

it('lets every uploader delete their own photo, also restricted, suspended or blocked since', function (Closure $who) {
    $member = $who($this->event, $this->organiser);

    if ($member === null) {
        expect(true)->toBeTrue();

        return;
    }

    $own = m56GalleryPhoto($this->event, $member, GalleryPhotoStatus::Pending);
    Sanctum::actingAs($member);

    $this->deleteJson("/api/v1/events/{$this->event->slug}/gallery/{$own->id}")->assertNoContent();
    expect(EventPhoto::query()->whereKey($own->id)->exists())->toBeFalse()
        ->and(EventPhoto::withTrashed()->whereKey($own->id)->exists())->toBeTrue();
})->with(m56Who());

it('never sends the reject reason or a non-approved status to anybody but the uploader and the organiser', function () {
    $rejected = m56GalleryPhoto($this->event, $this->attendee, GalleryPhotoStatus::Rejected, ['reject_reason' => 'Kennzeichen lesbar']);
    $stranger = User::factory()->create();
    Sanctum::actingAs($stranger);

    $body = $this->getJson("/api/v1/events/{$this->event->slug}/gallery")->assertOk()->json();
    expect(evStrings($body))->not->toContain('Kennzeichen lesbar')->not->toContain($rejected->id)->not->toContain($this->pending->id);

    Sanctum::actingAs($this->organiser);
    $this->getJson("/api/v1/events/{$this->event->slug}/gallery?status=mine")->assertOk()->assertJsonCount(0, 'data');
});

it('answers 404 event_photo_unavailable for a photo of another event or a removed one', function () {
    $other = m56JustEnded($this->organiser);
    $foreign = m56GalleryPhoto($other, $this->attendee, GalleryPhotoStatus::Pending);
    $removed = m56GalleryPhoto($this->event, $this->attendee, GalleryPhotoStatus::Removed);
    Sanctum::actingAs($this->organiser);

    $this->postJson("/api/v1/events/{$this->event->slug}/gallery/{$foreign->id}/approve")->assertNotFound()->assertJsonPath('code', 'event_photo_unavailable');
    $this->postJson("/api/v1/events/{$this->event->slug}/gallery/{$removed->id}/approve")->assertNotFound()->assertJsonPath('code', 'event_photo_unavailable');
    $this->deleteJson("/api/v1/events/{$this->event->slug}/gallery/{$removed->id}")->assertNotFound()->assertJsonPath('code', 'event_photo_unavailable');
});
