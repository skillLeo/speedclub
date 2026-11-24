<?php

use App\Enums\AuditActorType;
use App\Enums\LegalDocumentKey;
use App\Models\AuditEvent;
use App\Models\LegalDocument;
use App\Models\User;
use App\Services\AppConfig\LegalDocuments;
use App\Services\Content\Consents;
use Database\Seeders\LegalDocumentSeeder;

/**
 * BL-21 / review M5.6–M5.7 SF-7: the one publish of the Phase 5 privacy changes (Shop, Treffen, Aufrufe und Statistiken, Wochenrückblick,
 * Forum) reaches hosts that already run the M5.9f gift text — that text's bodies are listed — without asking anybody to accept again,
 * audited, idempotent, never over a text staff changed in ADM-31.
 */
function p5PrivacyUpdate(): object
{
    return require database_path('migrations/2026_12_29_100300_publish_phase_5_privacy_update.php');
}

function p5PrivacyBody(string $locale): string
{
    preg_match('/\A---\R(.*?)\R---\R+(.*)\z/s', (string) file_get_contents(database_path("data/legal/privacy.$locale.md")), $parts);

    return trim($parts[2])."\n";
}

it('knows every privacy body shipped before, the M5.9f gift texts included, and only privacy', function () {
    $phase5 = require database_path('migrations/2026_12_21_100000_publish_phase_5_legal_drafts.php');
    $update = p5PrivacyUpdate();

    foreach (['de', 'en'] as $locale) {
        $hashes = $update::SEEDED['privacy'][$locale];

        // Every body the gift migration knew, plus the two bodies it may have published (aaa2adf9 and the gift-gate fix fe175279).
        expect(array_diff($phase5::SEEDED['privacy'][$locale], $hashes))->toBe([])
            ->and(count($hashes))->toBe(count($phase5::SEEDED['privacy'][$locale]) + 2)
            ->and(array_unique($hashes))->toHaveCount(count($hashes))
            ->and($hashes)->not->toContain(hash('sha256', p5PrivacyBody($locale)));
    }

    expect(array_keys($update::SEEDED))->toBe(['privacy'])
        ->and($update::SEEDED['privacy']['de'])->toContain('209fc7cbbff22eefe20aafada4c017d27bbf2098ac5af0bca24f6e045afa7345')
        ->and($update::SEEDED['privacy']['en'])->toContain('9fc195edf09054533449580d97f205ac944ae02d2f7bd11b2be921a06b36826e');
});

it('publishes the new privacy text over a seeded draft without asking anybody to accept again', function () {
    $old = "# Datenschutzerklärung\n\nGeschenk-Entwurf.\n";
    $v1 = LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => '2', 'body_md' => $old]);
    $member = User::factory()->create(['terms_version' => '1', 'privacy_version' => '2']);

    $published = p5PrivacyUpdate()->publishOver(['privacy' => ['de' => [hash('sha256', $old)]]]);

    $current = app(LegalDocuments::class)->current(LegalDocumentKey::Privacy, 'de');
    $row = LegalDocument::query()->whereKey($current?->id)->firstOrFail();

    expect($published)->toBe(1)
        ->and($row->version)->toBe('3')
        ->and($row->body_md)->toBe(p5PrivacyBody('de'))
        ->toContain('## 18. Aufrufe und Statistiken', '## 19. Forum', '[[Datenschutz-E-Mail]]')
        ->and($row->requires_reconsent)->toBeFalse()
        ->and($row->summary)->toBeNull()
        ->and($row->reason)->toBe(p5PrivacyUpdate()::REASON)->not->toMatch('/\b(?:M\d|OA-\d|BL-\d)/')
        ->and($v1->fresh()?->body_md)->toBe($old)
        ->and(AuditEvent::query()->where('action', 'legal.published')->where('target_id', (string) $row->id)
            ->where('actor_type', AuditActorType::System->value)->exists())->toBeTrue()
        ->and(app(Consents::class)->outstanding($member))->toBeFalse()
        ->and(app(LegalDocuments::class)->reconsentVersion(LegalDocumentKey::Privacy))->toBeNull();

    // Again: nothing changes.
    expect(p5PrivacyUpdate()->publishOver(['privacy' => ['de' => [hash('sha256', $old)]]]))->toBe(0)
        ->and(LegalDocument::query()->where('key', LegalDocumentKey::Privacy)->count())->toBe(2);
});

it('leaves a privacy text staff changed in ADM-31 alone', function () {
    LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'en', 'version' => '2', 'body_md' => "# Privacy\n\nEdited by hand.\n"]);

    expect(p5PrivacyUpdate()->publishOver(p5PrivacyUpdate()::SEEDED))->toBe(0)
        ->and(app(LegalDocuments::class)->current(LegalDocumentKey::Privacy, 'en')?->body_md)->toBe("# Privacy\n\nEdited by hand.\n");
});

it('does nothing on a fresh host, and nothing on a second run after the seeder', function () {
    p5PrivacyUpdate()->up();
    expect(LegalDocument::query()->count())->toBe(0);

    $this->seed(LegalDocumentSeeder::class);
    p5PrivacyUpdate()->up();
    p5PrivacyUpdate()->up();

    expect(LegalDocument::query()->where('key', LegalDocumentKey::Privacy)->orderBy('locale')->pluck('body_md')->all())
        ->toBe([p5PrivacyBody('de'), p5PrivacyBody('en')])
        ->and(LegalDocument::query()->where('version', '!=', LegalDocumentSeeder::VERSION)->count())->toBe(0);
});
