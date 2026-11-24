<?php

use App\Enums\ApprovalStatus;
use App\Enums\AuditActorType;
use App\Enums\LegalDocumentKey;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\LegalDocument;
use Database\Seeders\BrandContentDemoSeeder;
use Database\Seeders\LegalDocumentSeeder;

/**
 * M5.9f: 2026_12_21_100100 lifts the ADM-31 demo privacy draft from the Phase 4 text to the Phase 5 one, so publishing the demo draft on
 * staging never brings the Phase 4 text back.
 */
function p5DemoDraftMigration(): object
{
    return require database_path('migrations/2026_12_21_100100_refresh_demo_privacy_draft_phase_5.php');
}

it('turns the Phase 4 demo draft into the Phase 5 one past the published version, once', function () {
    LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => '4', 'body_md' => LegalDocumentSeeder::body(LegalDocumentKey::Privacy, 'de')]);
    $phase4 = "# Datenschutzerklärung\n\nPhase-4-Text.\n";
    $draft = LegalDocument::factory()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => '3', 'body_md' => $phase4, 'requires_reconsent' => true, 'summary' => 'alt']);
    $migration = p5DemoDraftMigration();

    expect($migration->refresh([hash('sha256', $phase4)]))->toBeTrue();

    $draft->refresh();
    expect($draft->body_md)->toBe(BrandContentDemoSeeder::privacyDraft()['body_md'])
        ->and($draft->body_md)->toContain(BrandContentDemoSeeder::PRIVACY_DRAFT_SENTENCE)
        ->and($draft->body_md)->toContain('STREET DEX')
        ->and($draft->version)->toBe('5')
        ->and($draft->published_at)->toBeNull()
        ->and(AuditEvent::query()->where('action', 'legal.draft_saved')->latest('id')->value('reason'))->toContain('Phase-5-Text')
        ->and(AuditEvent::query()->where('action', 'legal.draft_saved')->latest('id')->value('actor_type'))->toBe(AuditActorType::System)
        ->and($migration->refresh([hash('sha256', $phase4)]))->toBeFalse();
});

it('leaves a draft staff wrote alone, and one whose re-consent publish waits for approval', function () {
    $draft = LegalDocument::factory()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => '2', 'body_md' => "# Datenschutz\n\nVon Hand.\n"]);
    $migration = p5DemoDraftMigration();

    expect($migration->refresh($migration::OLD_DRAFTS))->toBeFalse()
        ->and($draft->fresh()?->body_md)->toBe("# Datenschutz\n\nVon Hand.\n");

    ApprovalRequest::factory()->create([
        'action' => 'legal.publish_reconsent', 'status' => ApprovalStatus::Pending,
        'subject_type' => $draft->getMorphClass(), 'subject_id' => (string) $draft->getKey(),
    ]);
    expect($migration->refresh([hash('sha256', $draft->body_md)]))->toBeFalse();
});

it('lists exactly the Phase 4 demo draft, never the current one', function () {
    $migration = p5DemoDraftMigration();

    expect($migration::OLD_DRAFTS)->toBe(['fd93cf56e68916c53f17ef731bac857f1ce8b2e554c990db8772a2c697ee32cf'])
        ->not->toContain(hash('sha256', BrandContentDemoSeeder::privacyDraft()['body_md']));
});
