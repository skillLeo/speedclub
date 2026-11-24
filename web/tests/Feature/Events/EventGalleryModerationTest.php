<?php

use App\Actions\Moderation\ReverseDecision;
use App\Enums\DecisionAction;
use App\Enums\GalleryPhotoStatus;
use App\Enums\ModerationStatus;
use App\Enums\ReportTargetType;
use App\Models\AuditEvent;
use App\Models\EventPhoto;
use App\Models\Media;
use App\Models\ModerationCase;
use App\Models\Report;
use App\Models\Staff;
use App\Models\User;
use App\Services\Events\EventHousekeeping;
use App\Services\Moderation\CaseRecord;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/M56TestHelpers.php';
require_once __DIR__.'/../Moderation/ModerationTestHelpers.php';

/**
 * M5.6 gallery moderation (m5.6-contract §4.5): the organiser approves or rejects first; reports go through the existing `photo` target
 * with the media id; staff removal wins, is audited and leaves every list at once; a reversal brings it back.
 */
beforeEach(function () {
    m56Flags();
    m56Disks();
    $this->organiser = evOrganiser();
    $this->event = m56JustEnded($this->organiser, ['title' => 'Cars & Coffee am Hafen']);
    $this->uploader = User::factory()->create(['username' => 'mia.k']);
    evRsvp($this->event, $this->uploader);
});

it('approves into the approval order and rejects with a reason only the uploader reads', function () {
    $earlier = m56GalleryPhoto($this->event, $this->organiser);
    $pending = m56GalleryPhoto($this->event, $this->uploader, GalleryPhotoStatus::Pending);
    $other = m56GalleryPhoto($this->event, $this->uploader, GalleryPhotoStatus::Pending);
    Sanctum::actingAs($this->organiser);

    $this->postJson("/api/v1/events/{$this->event->slug}/gallery/{$pending->id}/approve")->assertOk()
        ->assertJsonPath('data.status', 'approved')->assertJsonPath('data.can.moderate', false);
    $this->postJson("/api/v1/events/{$this->event->slug}/gallery/{$other->id}/reject", ['reason' => 'Kennzeichen lesbar'])->assertOk()
        ->assertJsonPath('data.status', 'rejected')
        ->assertJsonPath('data.reject_reason', null);

    expect($pending->fresh()?->sort)->toBeGreaterThan($earlier->sort)
        ->and($pending->fresh()?->reviewed_by)->toBe($this->organiser->id)
        ->and($other->fresh()?->reject_reason)->toBe('Kennzeichen lesbar');

    Sanctum::actingAs($this->uploader);
    $this->getJson("/api/v1/events/{$this->event->slug}/gallery?status=mine")
        ->assertJsonPath('data.1.reject_reason', 'Kennzeichen lesbar');
});

it('answers 409 photo_already_reviewed for a photo that is no longer pending', function () {
    $approved = m56GalleryPhoto($this->event, $this->uploader);
    Sanctum::actingAs($this->organiser);

    $this->postJson("/api/v1/events/{$this->event->slug}/gallery/{$approved->id}/approve")->assertStatus(409)->assertJsonPath('code', 'photo_already_reviewed');
    $this->postJson("/api/v1/events/{$this->event->slug}/gallery/{$approved->id}/reject")->assertStatus(409)->assertJsonPath('code', 'photo_already_reviewed');
});

it('validates the reject reason', function () {
    $pending = m56GalleryPhoto($this->event, $this->uploader, GalleryPhotoStatus::Pending);
    Sanctum::actingAs($this->organiser);

    $this->postJson("/api/v1/events/{$this->event->slug}/gallery/{$pending->id}/reject", ['reason' => str_repeat('x', 201)])
        ->assertUnprocessable()->assertJsonValidationErrors('reason');
});

it('deletes the files of a rejected photo after seven days and keeps the row', function () {
    $rejected = m56GalleryPhoto($this->event, $this->uploader, GalleryPhotoStatus::Rejected, ['reviewed_at' => now()->subDays(8)]);
    $recent = m56GalleryPhoto($this->event, $this->uploader, GalleryPhotoStatus::Rejected, ['reviewed_at' => now()->subDays(2)]);

    $result = app(EventHousekeeping::class)->run();

    expect($result['rejected_purged'])->toBe(1)
        ->and(Media::query()->find($rejected->media_id))->toBeNull()
        ->and(Media::withTrashed()->find($rejected->media_id)?->variants)->toBeNull()
        ->and(EventPhoto::query()->find($rejected->id))->not->toBeNull()
        ->and(Media::query()->find($recent->media_id))->not->toBeNull();
});

it('is reported through the photo target with the media id, the uploader as subject and the event as label', function () {
    $photo = m56GalleryPhoto($this->event, $this->uploader);
    $reporter = User::factory()->create();
    Sanctum::actingAs($reporter);

    $this->postJson('/api/v1/reports', modBody('photo', $photo->media_id))->assertCreated();

    $case = ModerationCase::query()->sole();
    expect($case->target_type)->toBe(ReportTargetType::Photo)
        ->and($case->target_id)->toBe($photo->media_id)
        ->and($case->subject_id)->toBe($this->uploader->id)
        ->and(Report::query()->sole()->target_label)->toBe('Cars & Coffee am Hafen');

    $preview = app(CaseRecord::class)->preview($case);
    expect($preview['event']['slug'] ?? null)->toBe($this->event->slug)
        ->and($preview['event']['title'] ?? null)->toBe('Cars & Coffee am Hafen');
});

it('cannot be reported while it is pending, nor by its uploader', function () {
    $pending = m56GalleryPhoto($this->event, $this->uploader, GalleryPhotoStatus::Pending);
    $approved = m56GalleryPhoto($this->event, $this->uploader);

    Sanctum::actingAs(User::factory()->create());
    $this->postJson('/api/v1/reports', modBody('photo', $pending->media_id))->assertNotFound();

    Sanctum::actingAs($this->uploader);
    $this->postJson('/api/v1/reports', modBody('photo', $approved->media_id))->assertUnprocessable()->assertJsonPath('code', 'own_content');
});

it('leaves every list and count when staff remove it, audited, and comes back with a reversal', function () {
    $photo = m56GalleryPhoto($this->event, $this->uploader);
    $staff = Staff::factory()->create();
    $report = modReport(User::factory()->create(), ReportTargetType::Photo, $photo->media_id);

    $decision = modDecide(modCaseOf($report), DecisionAction::RemoveContent, ['decidedBy' => $staff]);

    $row = $photo->fresh();
    expect($row?->status)->toBe(GalleryPhotoStatus::Removed)
        ->and($row?->removed_by_staff_id)->toBe($staff->id)
        ->and(Media::query()->find($photo->media_id)?->moderation_status)->toBe(ModerationStatus::Rejected)
        ->and(AuditEvent::query()->where('action', 'moderation.decided')->exists())->toBeTrue()
        ->and($decision->subject_id)->toBe($this->uploader->id);

    $this->getJson("/api/v1/events/{$this->event->slug}/gallery")->assertJsonCount(0, 'data');
    $this->getJson("/api/v1/events/{$this->event->slug}")->assertJsonPath('data.gallery.count', 0);
    Sanctum::actingAs($this->uploader);
    $this->getJson("/api/v1/events/{$this->event->slug}/gallery?status=mine")->assertJsonCount(0, 'data');
    Sanctum::actingAs($this->organiser);
    $this->deleteJson("/api/v1/events/{$this->event->slug}/gallery/{$photo->id}")->assertNotFound();

    app(ReverseDecision::class)->handle($decision, Staff::factory()->create(), 'Das Foto verstößt nicht gegen die Regeln.', 'Test');
    expect($photo->fresh()?->status)->toBe(GalleryPhotoStatus::Approved)->and($photo->fresh()?->removed_by_staff_id)->toBeNull();
});

it('takes the gallery pictures along when the event is deleted', function () {
    $photo = m56GalleryPhoto($this->event, $this->uploader);
    Sanctum::actingAs($this->organiser);

    $this->deleteJson("/api/v1/events/{$this->event->slug}")->assertNoContent();

    expect(EventPhoto::withTrashed()->find($photo->id))->toBeNull()
        ->and(Media::withTrashed()->find($photo->media_id))->toBeNull();
});

it('removes the member\'s gallery photos with their account', function () {
    $photo = m56GalleryPhoto($this->event, $this->uploader);

    $this->uploader->forceDelete();

    expect(EventPhoto::withTrashed()->find($photo->id))->toBeNull();
});
