<?php

use App\Enums\ApprovalStatus;
use App\Enums\AuditActorType;
use App\Enums\LegalDocumentKey;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\LegalDocument;
use App\Services\Content\LegalDrafts;
use Database\Seeders\BrandContentDemoSeeder;
use Database\Seeders\LegalDocumentSeeder;
use Illuminate\Support\Facades\DB;

/**
 * DQ-P5-101 / DQ-P5-103 (Phase 5 gate) data fixes: the privacy publish migrations move an open draft without own text onto the text they
 * publish; 2026_12_31_300000 gives every open draft its base version; 2026_12_31_300100 moves the stale drafts already on dev and staging
 * (the demo "Entwurf 6" on version 5's text under live version 8); 2026_12_31_300200 rewords the stored version reasons without internal
 * IDs. Every content write is audited by the system; staff text is never thrown away; a second run changes nothing.
 */
function legalRepairMigration(string $name): object
{
    return require database_path("migrations/$name.php");
}

/** The current privacy.de.md text (it carries the paragraph the demo sentence goes after). */
function legalRepairLive(): string
{
    return LegalDocumentSeeder::body(LegalDocumentKey::Privacy, 'de');
}

/** An older privacy text: the current one without its last section, so it still has the demo anchor. */
function legalRepairOld(): string
{
    $body = legalRepairLive();

    return substr($body, 0, (int) strrpos($body, "\n## "))."\n";
}

function legalRepairPrivacy(string $version, string $body, ?string $publishedAt = null): LegalDocument
{
    return LegalDocument::factory()->create([
        'key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => $version, 'body_md' => $body,
        'published_at' => $publishedAt === null ? null : now()->modify($publishedAt),
    ]);
}

describe('the privacy publish migrations', function () {
    it('move an open demo draft on the older text onto the text they publish', function (string $migration) {
        $old = legalRepairOld();
        legalRepairPrivacy('5', $old, '-2 days');
        $draft = legalRepairPrivacy('6', (string) BrandContentDemoSeeder::withDemoSentence($old));
        $draft->forceFill(['requires_reconsent' => true, 'summary' => 'QR-Scans: Gerät, Browser und Ort eines Scans speichern wir nicht.'])->save();
        // Opened yesterday, before the migration publishes (a draft from the same second would count as based on the new text).
        DB::table('legal_documents')->where('id', $draft->id)->update(['created_at' => now()->subDay()]);

        $instance = legalRepairMigration($migration);
        expect($instance->publishOver(['privacy' => ['de' => [hash('sha256', $old)]]]))->toBe(1);

        $live = LegalDrafts::live(LegalDocumentKey::Privacy, 'de');
        $draft->refresh();
        expect($live?->version)->toBe('7')
            ->and($draft->published_at)->toBeNull()
            ->and($draft->version)->toBe('8')
            ->and($draft->body_md)->toBe(BrandContentDemoSeeder::withDemoSentence((string) $live?->body_md))
            ->and($draft->requires_reconsent)->toBeTrue()
            ->and($draft->summary)->toBe(BrandContentDemoSeeder::PRIVACY_DRAFT_SUMMARY)
            ->and($draft->based_on_id)->toBe($live?->id)
            ->and(LegalDrafts::staleness($draft))->toBeNull();

        $audit = AuditEvent::query()->where('action', 'legal.draft_saved')->sole();
        expect($audit->actor_type)->toBe(AuditActorType::System)
            ->and($audit->reason)->toBe($instance::DRAFT_REASON)
            ->and($audit->before['version'])->toBe('6')
            ->and($audit->after['version'])->toBe('8');
    })->with(['2026_12_29_100300_publish_phase_5_privacy_update', '2026_12_31_200200_publish_phase_5_ai_privacy']);

    it('keep a draft with staff text, which is then stale', function () {
        $old = legalRepairOld();
        $v5 = legalRepairPrivacy('5', $old, '-2 days');
        $draft = legalRepairPrivacy('6', $old."\nEin Absatz, den das Team geschrieben hat.\n");
        $draft->forceFill(['based_on_id' => $v5->id])->save();

        legalRepairMigration('2026_12_31_200200_publish_phase_5_ai_privacy')->publishOver(['privacy' => ['de' => [hash('sha256', $old)]]]);

        expect($draft->fresh()?->body_md)->toBe($old."\nEin Absatz, den das Team geschrieben hat.\n")
            ->and(LegalDrafts::staleness($draft->fresh()))->toBe(['base' => '5', 'live' => '7'])
            ->and(AuditEvent::query()->where('action', 'legal.draft_saved')->exists())->toBeFalse();
    });
});

it('gives every open draft its base: the version whose text it holds, else the one live when it was created', function () {
    $v1 = legalRepairPrivacy('1', "# Datenschutz\n\nErste Fassung.\n", '-30 days');
    $v5 = legalRepairPrivacy('5', legalRepairOld(), '-10 days');
    legalRepairPrivacy('8', legalRepairLive(), '-1 day');
    // The dev case: created long before version 5, rewritten onto version 5's text later.
    $demo = legalRepairPrivacy('6', (string) BrandContentDemoSeeder::withDemoSentence(legalRepairOld()));
    $terms = LegalDocument::factory()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'version' => '1', 'published_at' => now()->subDays(20)]);
    $own = LegalDocument::factory()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'version' => '2', 'body_md' => "# AGB\n\nVon Hand.\n"]);
    DB::table('legal_documents')->whereIn('id', [$demo->id, $own->id])->update(['based_on_id' => null, 'created_at' => now()->subDays(25)]);

    expect(legalRepairMigration('2026_12_31_300000_add_based_on_to_legal_documents')->backfill())->toBe(1)
        ->and($demo->fresh()?->based_on_id)->toBe($v5->id)
        // Created before the first terms version went live: no base, so it counts as stale.
        ->and($own->fresh()?->based_on_id)->toBeNull()
        ->and(LegalDrafts::staleness($own->fresh()))->toBe(['base' => null, 'live' => '1'])
        ->and(LegalDrafts::staleness($demo->fresh()))->toBe(['base' => '5', 'live' => '8'])
        ->and($v1->fresh()?->based_on_id)->toBeNull()
        ->and($terms->fresh()?->based_on_id)->toBeNull();
});

describe('2026_12_31_300100 rebase stale drafts', function () {
    beforeEach(function () {
        $this->v5 = legalRepairPrivacy('5', legalRepairOld(), '-2 days');
        $this->v8 = legalRepairPrivacy('8', legalRepairLive(), '-1 day');
        $this->migration = legalRepairMigration('2026_12_31_300100_rebase_stale_legal_drafts');
    });

    it('moves the demo draft on version 5 onto live version 8 as Entwurf 9, audited, once', function () {
        $draft = legalRepairPrivacy('6', (string) BrandContentDemoSeeder::withDemoSentence(legalRepairOld()));
        $draft->forceFill(['based_on_id' => $this->v5->id, 'requires_reconsent' => true, 'summary' => 'QR-Scans: alt.'])->save();

        expect($this->migration->rebase())->toBe(1);

        $draft->refresh();
        expect($draft->version)->toBe('9')
            ->and($draft->body_md)->toBe(BrandContentDemoSeeder::privacyDraft()['body_md'])
            ->and($draft->body_md)->toContain(BrandContentDemoSeeder::PRIVACY_DRAFT_SENTENCE)
            ->and($draft->summary)->toBe(BrandContentDemoSeeder::PRIVACY_DRAFT_SUMMARY)
            ->and($draft->based_on_id)->toBe($this->v8->id)
            ->and($draft->published_at)->toBeNull()
            ->and(LegalDocument::query()->whereNotNull('published_at')->count())->toBe(2);

        $audit = AuditEvent::query()->where('action', 'legal.draft_saved')->sole();
        expect($audit->actor_type)->toBe(AuditActorType::System)
            ->and($audit->reason)->toBe($this->migration::REASON)
            ->and($audit->before['body_sha256'])->not->toBe($audit->after['body_sha256'])
            ->and($audit->after['based_on'])->toBe('8')
            ->and($this->migration->rebase())->toBe(0);
    });

    it('moves an unchanged copy of an older version onto the live text', function () {
        $draft = legalRepairPrivacy('6', legalRepairOld());
        $draft->forceFill(['based_on_id' => $this->v5->id])->save();

        expect($this->migration->rebase())->toBe(1)
            ->and($draft->fresh()?->body_md)->toBe(legalRepairLive())
            ->and($draft->fresh()?->version)->toBe('9');
    });

    it('leaves a current draft, a draft with staff text and one waiting for approval', function (string $case) {
        $body = $case === 'own text' ? legalRepairOld()."\nVon Hand ergänzt.\n" : (string) BrandContentDemoSeeder::withDemoSentence($case === 'current' ? legalRepairLive() : legalRepairOld());
        $draft = legalRepairPrivacy('6', $body);
        $draft->forceFill(['based_on_id' => $case === 'current' ? $this->v8->id : $this->v5->id])->save();

        if ($case === 'waiting') {
            ApprovalRequest::factory()->create([
                'action' => 'legal.publish_reconsent', 'status' => ApprovalStatus::Pending,
                'subject_type' => $draft->getMorphClass(), 'subject_id' => (string) $draft->getKey(),
            ]);
        }

        expect($this->migration->rebase())->toBe(0)
            ->and($draft->fresh()?->body_md)->toBe($body)
            ->and($draft->fresh()?->version)->toBe('6')
            ->and(AuditEvent::query()->where('action', 'legal.draft_saved')->exists())->toBeFalse();
    })->with(['current', 'own text', 'waiting']);
});

describe('2026_12_31_300200 reword legal version reasons', function () {
    it('replaces each old reason with the plain one of its migration, audited, once', function () {
        $migration = legalRepairMigration('2026_12_31_300200_reword_legal_version_reasons');
        $rows = [];
        foreach (array_keys($migration::REWORDED) as $index => $old) {
            $rows[] = LegalDocument::factory()->create(['key' => LegalDocumentKey::Imprint, 'locale' => 'de', 'version' => (string) ($index + 2), 'published_at' => now()->subDays(5 - $index), 'reason' => $old]);
        }
        $typed = LegalDocument::factory()->create(['key' => LegalDocumentKey::Imprint, 'locale' => 'de', 'version' => '9', 'published_at' => now()->subHour(), 'reason' => 'Neue Anschrift (OA-35 erledigt).']);

        expect($migration->reword())->toBe(6);

        foreach (array_values($migration::REWORDED) as $index => $source) {
            expect($rows[$index]->fresh()?->reason)->toBe(legalRepairMigration($source)::REASON);
        }

        expect($typed->fresh()?->reason)->toBe('Neue Anschrift (OA-35 erledigt).')
            ->and(AuditEvent::query()->where('action', 'legal.reason_reworded')->where('actor_type', AuditActorType::System->value)->count())->toBe(6)
            ->and($migration->reword())->toBe(0);
    });

    it('writes every stored reason without internal IDs', function (string $source) {
        expect(legalRepairMigration($source)::REASON)->not->toMatch('/\b(?:M\d|OA-\d|BL-\d|ADR-\d|SF-\d)/');
    })->with([
        '2026_11_25_100000_publish_licences_with_the_2_0_typefaces',
        '2026_12_09_100000_publish_phase_4_legal_drafts',
        '2026_12_16_120000_publish_licences_with_geonames',
        '2026_12_21_100000_publish_phase_5_legal_drafts',
        '2026_12_29_100300_publish_phase_5_privacy_update',
        '2026_12_31_200200_publish_phase_5_ai_privacy',
        '2026_12_31_300100_rebase_stale_legal_drafts',
    ]);
});
