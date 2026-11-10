<?php

use App\Enums\AiFeature;
use App\Enums\CaseStatus;
use App\Jobs\Ai\TriageMedia;
use App\Jobs\Ai\TriageModerationCase;
use App\Models\Decision;
use App\Models\Media;
use App\Models\ModerationCase;
use App\Models\Vehicle;
use App\Services\Ai\Agents\TriageAgent;
use App\Services\Ai\Triage;
use App\Services\Moderation\OwnInitiativeCases;
use Illuminate\Support\Facades\Queue;
use Laravel\Ai\Prompts\AgentPrompt;

require_once __DIR__.'/AiTestHelpers.php';
require_once __DIR__.'/../Moderation/ModerationTestHelpers.php';
require_once __DIR__.'/../Staff/Helpers.php';

/**
 * ai.moderation_triage (m3.7 §1): queued on a new report and a new public photo, stores risk_score/100 and a German reason on the case or
 * the photo, never decides; a staff case on a photo it flagged is marked ai_detected for the statement of reasons.
 */
beforeEach(function () {
    $this->withHeader('Accept-Language', 'de');
    $this->owner = aiMember(attributes: ['bio' => 'Verkaufe gefälschte Felgen, schreib mir privat.']);
    $this->vehicle = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id, 'description' => 'Günstige Replika-Felgen abzugeben.']);
});

it('queues the triage on a new report only while the flag is on and a provider exists', function () {
    Queue::fake();
    aiActAs(aiMember());

    $this->postJson('/api/v1/reports', modBody('vehicle', $this->vehicle->id))->assertCreated();
    Queue::assertNotPushed(TriageModerationCase::class);

    aiOn(AiFeature::ModerationTriage);
    aiActAs(aiMember());
    $this->postJson('/api/v1/reports', modBody('vehicle', $this->vehicle->id))->assertCreated();

    Queue::assertPushed(TriageModerationCase::class, fn (TriageModerationCase $job): bool => $job->caseId === ModerationCase::query()->sole()->id);
});

it('stores the score and the reason on the case and never decides', function () {
    Queue::fake();
    aiOn(AiFeature::ModerationTriage);
    TriageAgent::fake([['refused' => false, 'risk_score' => 82, 'risk_reason' => 'Mögliches Angebot gefälschter Teile in der Beschreibung.']]);
    aiActAs(aiMember());
    $this->postJson('/api/v1/reports', modBody('vehicle', $this->vehicle->id, ['details' => 'Das sind Fälschungen.']))->assertCreated();
    $case = ModerationCase::query()->sole();
    $before = $case->only(['status', 'priority', 'assigned_staff_id', 'decided_at']);

    Queue::assertPushed(TriageModerationCase::class, 1);
    (new TriageModerationCase($case->id))->handle(app(Triage::class));
    $after = $case->fresh();
    TriageAgent::assertPromptedTimes(1);

    expect((float) $after->ai_score)->toBe(0.82)
        ->and($after->ai_summary)->toBe('Mögliches Angebot gefälschter Teile in der Beschreibung.')
        ->and($after->ai_scored_at)->not->toBeNull()
        ->and($after->only(['status', 'priority', 'assigned_staff_id', 'decided_at']))->toEqual($before)
        ->and($after->status)->toBe(CaseStatus::New)
        ->and(Decision::query()->count())->toBe(0)
        ->and($after->ai_detected)->toBeFalse();

    TriageAgent::assertPrompted(fn (AgentPrompt $prompt): bool => $prompt->contains('reason spam: 1') && $prompt->contains('Das sind Fälschungen.') && $prompt->contains('Replika-Felgen'));
    expect(aiCallLog())->not->toContain('Fälschungen')->not->toContain('Replika')->and(aiLastCall()->member_id)->toBeNull();
});

it('keeps the reason at 140 characters and stores nothing for a malformed or refused answer', function () {
    aiOn(AiFeature::ModerationTriage);
    $case = ModerationCase::factory()->create(['target_type' => 'vehicle', 'target_id' => $this->vehicle->id, 'open_target' => 'vehicle:'.$this->vehicle->id]);
    TriageAgent::fake([
        ['refused' => false, 'risk_score' => 40, 'risk_reason' => str_repeat('Langer Grund ', 20)],
        ['refused' => false, 'risk_score' => 140, 'risk_reason' => 'Zu hoch.'],
        ['refused' => true, 'risk_score' => 0, 'risk_reason' => ''],
    ]);
    $triage = app(Triage::class);

    expect($triage->scoreCase($case))->toBeTrue()
        ->and(mb_strlen((string) $case->fresh()->ai_summary))->toBeLessThanOrEqual(140);

    ModerationCase::query()->whereKey($case->id)->update(['ai_score' => null, 'ai_summary' => null]);
    expect($triage->scoreCase($case))->toBeFalse()
        ->and($triage->scoreCase($case))->toBeFalse()
        ->and($case->fresh()->ai_score)->toBeNull()
        ->and(aiLastCall()->outcome->value)->toBe('refused');
});

it('never sends a message\'s content or the reporter\'s details for a message case', function () {
    Queue::fake();
    aiOn(AiFeature::ModerationTriage);
    TriageAgent::fake([['refused' => false, 'risk_score' => 55, 'risk_reason' => 'Mehrere Meldungen wegen Belästigung.']]);
    $reporter = aiMember();
    $message = msgStart($this->owner, $reporter, 'Geheime Nachricht mit Adresse Musterweg 1');
    aiActAs($reporter);
    $this->postJson('/api/v1/reports', modBody('message', $message->id, ['reason' => 'harassment', 'details' => 'Er schreibt: Musterweg 1']))->assertCreated();

    expect(app(Triage::class)->scoreCase(ModerationCase::query()->sole()))->toBeTrue();

    TriageAgent::assertPrompted(fn (AgentPrompt $prompt): bool => $prompt->contains('reason harassment: 1') && ! $prompt->contains('Musterweg') && ! $prompt->contains('Geheime'));
});

it('scores a new public photo from its 640 variant, once', function () {
    Queue::fake();
    aiOn(AiFeature::ModerationTriage);

    $photo = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id]);
    Queue::assertPushed(TriageMedia::class, 1);

    // An unattached upload (it may become a message photo) is never sent.
    Media::factory()->create(['owner_id' => $this->owner->id, 'mediable_type' => null, 'mediable_id' => null]);
    Queue::assertPushed(TriageMedia::class, 1);

    TriageAgent::fake([['refused' => false, 'risk_score' => 91, 'risk_reason' => 'Fremdes Kennzeichen gut lesbar.']]);
    (new TriageMedia($photo->id))->handle(app(Triage::class));
    (new TriageMedia($photo->id))->handle(app(Triage::class));

    expect((float) $photo->fresh()->ai_score)->toBe(0.91)
        ->and($photo->fresh()->ai_summary)->toBe('Fremdes Kennzeichen gut lesbar.')
        ->and($photo->fresh()->moderation_status)->toBe($photo->moderation_status);
    TriageAgent::assertPromptedTimes(1);
    TriageAgent::assertPrompted(fn (AgentPrompt $prompt): bool => $prompt->attachments->first()?->path === $photo->variants['640']);
});

it('marks a staff case on a photo the triage flagged as detected by automated means', function () {
    $flagged = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id, 'ai_score' => 0.9, 'ai_summary' => 'Nacktheit.', 'ai_scored_at' => now()]);
    $calm = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id, 'ai_score' => 0.1, 'ai_scored_at' => now()]);
    $staff = m31Staff('moderator');

    expect(app(OwnInitiativeCases::class)->forTarget($flagged, $staff)->fresh()->ai_detected)->toBeTrue()
        ->and(app(OwnInitiativeCases::class)->forTarget($calm, $staff)->fresh()->ai_detected)->toBeFalse()
        ->and(app(OwnInitiativeCases::class)->forTarget($this->vehicle, $staff)->fresh()->ai_detected)->toBeFalse();
});

it('does nothing while the flag is off', function () {
    aiProvider();
    TriageAgent::fake()->preventStrayPrompts();
    $case = ModerationCase::factory()->create();

    expect(app(Triage::class)->scoreCase($case))->toBeFalse();
    TriageAgent::assertNeverPrompted();
});
