<?php

use App\Actions\Admin\Events\ReviewEvent;
use App\Enums\EventStatus;
use App\Enums\NotificationType;
use App\Models\AuditEvent;
use App\Models\Event;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Support/helpers.php';
require_once __DIR__.'/../../Events/EventTestHelpers.php';

/**
 * ADM-53/54 (09 §10.3, M4.12 backend, M4.17 pages): the queue and record props, approve / reject / cancel / reopen with the role matrix,
 * audit, the organiser's notification and the optimistic locking of every write (ADR-439). None of these is on the four-eyes list of
 * 06 §2 (single decisions; no bulk action exists), so no approval request is involved.
 */
const EV_ADMIN_VIEW = ['owner', 'admin', 'moderator', 'analyst'];
const EV_ADMIN_DECIDE = ['owner', 'admin', 'moderator'];

beforeEach(function () {
    Queue::fake();
    evFlags();
    $this->organiser = evOrganiser(['username' => 'jann.ptrs']);
    $this->pending = evEvent($this->organiser, ['status' => EventStatus::PendingReview, 'published_at' => null, 'submitted_at' => now()->subHour(), 'location_visibility' => 'after_rsvp', 'street' => 'Hinterhofweg 99']);
});

/** The `version` prop ADM-53/54 hand back with an approval (security review SEC-412-01). */
function evVersion(Event $event): ?string
{
    return ReviewEvent::version($event->fresh() ?? $event);
}

function evAdminAs(string $role): void
{
    seedStaffRoles();
    actingAsStaff(staffWithRole($role));
    test()->withSession(['auth.password_confirmed_at' => time()]);
}

it('guards the queue and the record by moderation.view', function (string $uri, string $component) {
    $uri = str_replace('{event}', $this->pending->id, $uri);

    assertAdminMatrix('GET', $uri, EV_ADMIN_VIEW, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component($component)));
})->with([
    'ADM-53' => ['/admin/events', 'Events/Queue'],
    'ADM-53 published' => ['/admin/events?tab=published', 'Events/Queue'],
    'ADM-53 with the pane' => ['/admin/events?event={event}', 'Events/Queue'],
    'ADM-54' => ['/admin/events/{event}', 'Events/Show'],
]);

it('guards the JSON preview by moderation.view', function () {
    seedStaffRoles();
    foreach (ADMIN_ROLES as $role) {
        app('auth')->forgetGuards();
        actingAsStaff(staffWithRole($role));
        $response = $this->getJson("/admin/events/{$this->pending->id}/preview");
        in_array($role, EV_ADMIN_VIEW, true) ? $response->assertOk()->assertJsonPath('event.id', $this->pending->id) : $response->assertForbidden();
        auth('staff')->logout();
    }
});

it('guards the decisions by moderation.decide', function (string $action, array $data) {
    assertAdminMatrix('POST', "/admin/events/{$this->pending->id}/$action", EV_ADMIN_DECIDE, function (TestResponse $r): void {
        // Recent password missing: the confirm page, never a decision.
        expect($r->status())->toBeIn([302, 303, 423]);
    }, $data);
    expect(AuditEvent::query()->where('action', 'like', 'event.%')->count())->toBe(0);
})->with([
    'approve' => ['approve', ['version' => '2026-01-01T00:00:00+00:00']],
    'reject' => ['reject', ['reason' => 'Ort ist eine öffentliche Straße.', 'version' => '2026-01-01T00:00:00+00:00']],
    'cancel' => ['cancel', ['reason' => 'Angekündigtes Rennen auf der Landstraße.', 'version' => '2026-01-01T00:00:00+00:00']],
    'reopen' => ['reopen', ['version' => '2026-01-01T00:00:00+00:00']],
]);

it('lists the pending queue oldest first with the SLA and the organiser history, and shows the exact place to staff', function () {
    evEvent($this->organiser, ['published_at' => now()->subMonth()]);
    $older = evEvent(null, ['status' => EventStatus::PendingReview, 'published_at' => null, 'submitted_at' => now()->subHours(5)]);
    evAdminAs('moderator');

    $this->get('/admin/events')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component('Events/Queue')
        ->where('tab', 'pending')
        ->where('counts.pending', 2)
        ->where('rows.data.0.id', $older->id)
        ->where('rows.data.0.waiting_minutes', 300)
        ->where('rows.data.1.organiser.username', 'jann.ptrs')
        ->where('rows.data.1.organiser.approved_events', 1)
        ->where('canDecide', true));

    $this->get("/admin/events/{$this->pending->id}")->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component('Events/Show')
        ->where('event.place.street', 'Hinterhofweg 99')
        ->where('event.can.approve', true));
    $this->getJson("/admin/events/{$this->pending->id}/preview")->assertOk()->assertJsonPath('event.id', $this->pending->id);
    $this->get('/admin/events/01JAAAAAAAAAAAAAAAAAAAAAAA')->assertNotFound();
});

it('approves: published at once, audited, the organiser told; a second decision is not possible', function () {
    evAdminAs('moderator');

    $this->post("/admin/events/{$this->pending->id}/approve", ['version' => evVersion($this->pending)])->assertSessionHas('success', 'events.flash.approved')
        ->assertSessionHas('events.decided', fn (array $decided): bool => $decided['id'] === $this->pending->id && $decided['outcome'] === 'approved' && $decided['version'] === evVersion($this->pending));
    $event = $this->pending->fresh();
    expect($event?->status)->toBe(EventStatus::Published)
        ->and($event?->getAttribute('published_at'))->not->toBeNull()
        ->and(AuditEvent::query()->where('action', 'event.approved')->where('target_id', $event?->id)->count())->toBe(1)
        ->and(Notification::query()->where('notifiable_id', $this->organiser->id)->where('type', NotificationType::EventReview)->value('data'))
        ->toMatchArray(['outcome' => 'approved', 'reason' => null]);

    // Decided already: the same version is no longer pending (state), an older one changed meanwhile (version).
    $this->post("/admin/events/{$this->pending->id}/approve", ['version' => evVersion($this->pending)])->assertSessionHas('error', 'events.flash.not_possible')->assertSessionHasErrors('state');
    $this->getJson("/api/v1/events/{$this->pending->slug}")->assertOk();
});

it('rejects with a reason the organiser reads, and the organiser can send it again', function () {
    evAdminAs('admin');

    $this->post("/admin/events/{$this->pending->id}/reject", ['reason' => 'kurz', 'version' => evVersion($this->pending)])->assertSessionHasErrors('reason');
    $this->post("/admin/events/{$this->pending->id}/reject", ['reason' => 'Treffpunkt ist eine Wohnstraße, bitte einen Parkplatz wählen.'])->assertSessionHasErrors('version');
    $this->post("/admin/events/{$this->pending->id}/reject", ['reason' => 'Treffpunkt ist eine Wohnstraße, bitte einen Parkplatz wählen.', 'version' => evVersion($this->pending)])->assertSessionHas('success', 'events.flash.rejected');
    expect($this->pending->fresh()?->status)->toBe(EventStatus::Rejected)
        ->and(AuditEvent::query()->where('action', 'event.rejected')->value('reason'))->toBe('Treffpunkt ist eine Wohnstraße, bitte einen Parkplatz wählen.');

    Sanctum::actingAs($this->organiser);
    $this->getJson("/api/v1/events/{$this->pending->slug}")->assertOk()->assertJsonPath('data.review.reason', 'Treffpunkt ist eine Wohnstraße, bitte einen Parkplatz wählen.');
    $this->getJson('/api/v1/notifications')->assertOk()->assertJsonPath('data.0.type', 'event_review')->assertJsonPath('data.0.details.outcome', 'rejected');
    $this->postJson("/api/v1/events/{$this->pending->slug}/submit")->assertOk()->assertJsonPath('data.status', 'pending_review');
});

it('reopens a decision nobody answered yet (undo), and cancels a published event for its attendees', function () {
    evAdminAs('moderator');
    $this->post("/admin/events/{$this->pending->id}/approve", ['version' => evVersion($this->pending)]);
    $this->post("/admin/events/{$this->pending->id}/reopen", ['version' => evVersion($this->pending)])->assertSessionHas('success', 'events.flash.reopened');
    expect($this->pending->fresh()?->status)->toBe(EventStatus::PendingReview);

    $live = evEvent($this->organiser);
    evRsvp($live, User::factory()->create());
    $this->post("/admin/events/{$live->id}/cancel", ['reason' => 'Angekündigtes Rennen auf öffentlicher Straße.', 'version' => evVersion($live)])->assertSessionHas('success', 'events.flash.cancelled');
    expect($live->fresh()?->status)->toBe(EventStatus::Cancelled)
        ->and($live->fresh()?->getAttribute('cancelled_by_staff'))->toBeTrue()
        ->and(AuditEvent::query()->where('action', 'event.cancelled_by_staff')->count())->toBe(1)
        ->and(Notification::query()->where('notifiable_id', $this->organiser->id)->where('type', NotificationType::EventCancelled)->count())->toBe(1);
});

it('lets the analyst look but not decide', function () {
    evAdminAs('analyst');

    $this->get('/admin/events')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->where('canDecide', false));
    assertAdminErrorPage($this->post("/admin/events/{$this->pending->id}/approve"), 403);
    expect(Event::query()->find($this->pending->id)?->status)->toBe(EventStatus::PendingReview);
});

it('refuses every write on a changed event: "changed meanwhile" for a page, 409 for JSON, nothing changes and nothing is audited', function (string $action, array $data, EventStatus $status) {
    $event = $status === EventStatus::PendingReview ? $this->pending : evEvent($this->organiser, ['status' => $status, 'reviewed_by' => null]);
    evAdminAs('moderator');
    if ($action === 'reopen') {
        $event->forceFill(['reviewed_by' => staffWithRole('admin')->id, 'reviewed_at' => now()])->save();
    }
    $seen = evVersion($event);
    $this->travel(2)->seconds();
    // Somebody else changes it after the staff member loaded it (the organiser's edit, a reminder, another decision).
    $event->forceFill(['description' => 'Neue Beschreibung nach dem Laden.'])->save();
    $audits = AuditEvent::query()->where('action', 'like', 'event.%')->count();

    $this->post("/admin/events/{$event->id}/$action", [...$data, 'version' => $seen])->assertRedirect()->assertSessionHasErrors(['version' => 'events.conflict.changed']);
    $this->postJson("/admin/events/{$event->id}/$action", [...$data, 'version' => $seen])->assertStatus(409)->assertJson(['code' => 'changed_meanwhile']);

    expect($event->fresh()?->status)->toBe($status)
        ->and(AuditEvent::query()->where('action', 'like', 'event.%')->count())->toBe($audits);

    // With the current version it goes through (JSON: the new status and version).
    $this->postJson("/admin/events/{$event->id}/$action", [...$data, 'version' => evVersion($event)])->assertOk()->assertJsonPath('version', evVersion($event));
})->with([
    'approve' => ['approve', [], EventStatus::PendingReview],
    'reject' => ['reject', ['reason' => 'Treffpunkt ist eine Wohnstraße, bitte einen Parkplatz wählen.'], EventStatus::PendingReview],
    'cancel' => ['cancel', ['reason' => 'Angekündigtes Rennen auf öffentlicher Straße.'], EventStatus::Published],
    'reopen' => ['reopen', [], EventStatus::Rejected],
]);

it('answers a state that no longer allows the action with 409 not_possible for JSON', function () {
    evAdminAs('moderator');
    $live = evEvent($this->organiser);

    $this->postJson("/admin/events/{$live->id}/reject", ['reason' => 'Treffpunkt ist eine Wohnstraße, bitte einen Parkplatz wählen.', 'version' => evVersion($live)])
        ->assertStatus(409)->assertJson(['code' => 'not_possible']);
    $this->postJson("/admin/events/{$live->id}/approve", [])->assertUnprocessable()->assertJsonValidationErrors('version');
    expect($live->fresh()?->status)->toBe(EventStatus::Published);
});

it('opens an event in the queue pane, offers the undo of the last decision, and logs each first look at a private place', function () {
    evAdminAs('moderator');

    $this->get("/admin/events?event={$this->pending->id}")->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component('Events/Queue')
        ->where('selected.id', $this->pending->id)
        ->where('selected.version', evVersion($this->pending))
        ->where('selected.place.street', 'Hinterhofweg 99')
        ->where('decided', null));
    $this->get('/admin/events?event=nonsense')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->where('selected', null));

    // The private place: one audit event per staff member, event and day, never the place itself.
    $this->get("/admin/events/{$this->pending->id}")->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component('Events/Show')
        ->has('activity', 1)
        ->where('activity.0.action', 'event.private_place_viewed'));
    $viewed = AuditEvent::query()->where('action', 'event.private_place_viewed')->where('target_id', $this->pending->id)->get();
    expect($viewed)->toHaveCount(1)
        ->and(json_encode($viewed->first()?->getAttributes()))->not->toContain('Hinterhofweg');

    $this->post("/admin/events/{$this->pending->id}/approve", ['version' => evVersion($this->pending)]);
    $this->get("/admin/events?event={$this->pending->id}")->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
        ->where('decided.id', $this->pending->id)
        ->where('decided.outcome', 'approved')
        ->where('decided.status', 'published'));

    // A public event is no private place: nothing logged.
    $public = evEvent($this->organiser);
    $this->get("/admin/events/{$public->id}")->assertOk();
    expect(AuditEvent::query()->where('action', 'event.private_place_viewed')->where('target_id', $public->id)->count())->toBe(0);
});
