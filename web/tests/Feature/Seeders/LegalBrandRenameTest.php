<?php

use App\Enums\AuditActorType;
use App\Enums\LegalDocumentKey;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\LegalDocument;
use App\Models\User;
use App\Services\AppConfig\LegalDocuments;
use App\Services\Content\Consents;
use App\Services\Content\LegalDrafts;

/** R4B-009: the legal texts write the brand as "Speedclub" (2027_01_11_100000). */
function legalBrandMigration(): object
{
    return require database_path('migrations/2027_01_11_100000_rename_brand_in_legal_texts.php');
}

it('publishes a renamed version of a current text that still writes SPEED CLUB, keeping every other word, without re-consent', function () {
    $old = "# AGB\n\n2. Was SPEED CLUB ist\n\nEine Gemeinschaft (Speed Club). Von Hand ergänzt: Absatz 7.\n";
    $v1 = LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'version' => '3', 'body_md' => $old]);
    $member = User::factory()->create(['terms_version' => '3', 'privacy_version' => '1']);

    legalBrandMigration()->up();

    $current = app(LegalDocuments::class)->current(LegalDocumentKey::Terms, 'de');
    $row = LegalDocument::query()->whereKey($current?->id)->firstOrFail();

    expect($row->version)->toBe('4')
        ->and($row->body_md)->toBe("# AGB\n\n2. Was Speedclub ist\n\nEine Gemeinschaft (Speedclub). Von Hand ergänzt: Absatz 7.\n")
        ->and($row->requires_reconsent)->toBeFalse()
        ->and($v1->fresh()?->body_md)->toBe($old)
        ->and(AuditEvent::query()->where('action', 'legal.published')->where('target_id', (string) $row->id)
            ->where('actor_type', AuditActorType::System->value)->exists())->toBeTrue()
        ->and(app(Consents::class)->outstanding($member))->toBeFalse();

    // Again: nothing left to rename.
    legalBrandMigration()->up();
    expect(LegalDocument::query()->where('key', LegalDocumentKey::Terms)->count())->toBe(2);
});

it('leaves a text that already writes Speedclub alone and renames an unpublished draft in place', function () {
    $clean = LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'en', 'version' => '2', 'body_md' => "Speedclub only.\n"]);
    $draft = LegalDocument::factory()->create(['key' => LegalDocumentKey::Community, 'locale' => 'de', 'version' => '9', 'body_md' => "SPEED CLUB-Regeln\n", 'published_at' => null]);

    legalBrandMigration()->up();

    expect(LegalDocument::query()->where('key', LegalDocumentKey::Privacy)->count())->toBe(1)
        ->and($clean->fresh()?->body_md)->toBe("Speedclub only.\n")
        ->and($draft->fresh()?->body_md)->toBe("Speedclub-Regeln\n");
});

it('ships data files that no longer write the old name', function () {
    foreach (glob(database_path('data/legal/*.md')) ?: [] as $file) {
        expect((string) file_get_contents($file))->not->toContain('SPEED CLUB')->not->toContain('Speed Club');
    }
});

it('re-bases a draft started from the replaced version, so it stays publishable (review SF-8)', function () {
    $live = LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => '5', 'body_md' => "SPEED CLUB verarbeitet Daten.\n"]);
    $draft = LegalDocument::factory()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => '6-entwurf', 'body_md' => "SPEED CLUB verarbeitet weniger Daten.\n", 'published_at' => null, 'based_on_id' => $live->id]);
    expect(LegalDrafts::staleness($draft))->toBeNull();

    legalBrandMigration()->up();

    $fresh = $draft->fresh();
    $current = app(LegalDocuments::class)->current(LegalDocumentKey::Privacy, 'de');
    expect($fresh?->getAttribute('based_on_id'))->toBe($current?->id)
        ->and($fresh?->body_md)->toBe("Speedclub verarbeitet weniger Daten.\n")
        ->and(LegalDrafts::staleness($fresh))->toBeNull();
});

it('keeps the text of a draft whose re-consent approval is pending, so the approval still matches it', function () {
    $live = LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'version' => '7', 'body_md' => "SPEED CLUB AGB\n"]);
    $draft = LegalDocument::factory()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'version' => '8', 'body_md' => "SPEED CLUB AGB, neu\n", 'published_at' => null, 'based_on_id' => $live->id, 'requires_reconsent' => true]);
    ApprovalRequest::factory()->create(['action' => 'legal.publish_reconsent', 'payload' => ['document_id' => $draft->id, 'version' => '8', 'body_sha256' => hash('sha256', $draft->body_md), 'summary' => null]]);

    legalBrandMigration()->up();

    expect($draft->fresh()?->body_md)->toBe("SPEED CLUB AGB, neu\n")
        ->and($draft->fresh()?->getAttribute('based_on_id'))->not->toBe($live->id);
});

it('schedules a renamed copy of a future version at the same time, with an audit row, and leaves the original', function () {
    $at = now()->addWeek()->startOfMinute();
    $future = LegalDocument::factory()->create(['key' => LegalDocumentKey::Community, 'locale' => 'en', 'version' => '4', 'body_md' => "SPEED CLUB rules\n", 'published_at' => $at]);

    legalBrandMigration()->up();

    $copy = LegalDocument::query()->where('key', LegalDocumentKey::Community)->where('locale', 'en')->whereKeyNot($future->id)->firstOrFail();
    expect($copy->body_md)->toBe("Speedclub rules\n")
        ->and($copy->published_at?->equalTo($at))->toBeTrue()
        ->and($future->fresh()?->body_md)->toBe("SPEED CLUB rules\n")
        ->and(AuditEvent::query()->where('action', 'legal.published')->where('target_id', (string) $copy->id)->exists())->toBeTrue();
});
