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
 * M4.18 (09 §13, OA-35): the legal drafts describe every Phase 4 processing in German and English, state the storage periods the code
 * applies, keep the section numbers statements of reasons cite, and reach hosts seeded earlier through a data migration that asks
 * nobody to accept anything. Change list for the lawyer: docs/legal/phase-4-changes.md.
 */
function phase4LegalMigration(): object
{
    return require database_path('migrations/2026_12_09_100000_publish_phase_4_legal_drafts.php');
}

/** The member-facing text of database/data/legal/{key}.{locale}.md, as LegalDocumentSeeder stores it. */
function phase4LegalBody(LegalDocumentKey $key, string $locale): string
{
    preg_match('/\A---\R(.*?)\R---\R+(.*)\z/s', (string) file_get_contents(database_path("data/legal/{$key->value}.$locale.md")), $parts);

    return trim($parts[2])."\n";
}

/** @return list<string> the `## ` headings of a draft */
function phase4LegalHeadings(LegalDocumentKey $key, string $locale): array
{
    preg_match_all('/^## (.+)$/m', phase4LegalBody($key, $locale), $matches);

    return $matches[1];
}

it('describes every Phase 4 processing in the German and the English privacy policy', function (string $de, string $en) {
    expect(phase4LegalBody(LegalDocumentKey::Privacy, 'de'))->toContain($de)
        ->and(phase4LegalBody(LegalDocumentKey::Privacy, 'en'))->toContain($en);
})->with([
    'e-mail code and magic link' => ['Anmeldung per E-Mail-Code und Link', 'Sign-in by email code and link'],
    'passkeys' => ['| Passkeys |', '| Passkeys |'],
    'Apple and Google sign-in' => ['Anmeldung mit Apple oder Google', 'Sign in with Apple or Google'],
    'Apple revocation on deletion' => ['widerrufen wir zusätzlich die Anmeldung mit Apple', 'we also revoke Sign in with Apple'],
    'account security without IP' => ['Dafür speichern wir keine IP-Adresse.', 'We store no IP address for this.'],
    'device installs' => ['App-Installationen', 'App installs'],
    'home region' => ['Region für „in deiner Nähe“', 'Region for "near you"'],
    'maintenance and costs' => ['Wartung und Kosten', 'Maintenance and costs'],
    'build updates' => ['| Build-Updates |', '| Build updates |'],
    'private reactions' => ['Reaktionen sind privat', 'Reactions are private'],
    'mentions' => ['wer dich erwähnen darf', 'who may mention you'],
    'events' => ['## 7. Treffen', '## 7. Meets'],
    'after-RSVP place' => ['nur für Zugesagte', 'only to members who are going'],
    'calendar file' => ['Kalenderdatei (.ics)', 'calendar file (.ics)'],
    'browser location not stored' => ['speichern ihn nicht', 'do not store it'],
    'maps after a tap' => ['OpenFreeMap', 'OpenFreeMap'],
    'geocoding' => ['Nominatim', 'Nominatim'],
    'businesses' => ['| Betriebsprofil |', '| Business profile |'],
    'business review' => ['| Prüfung von Betrieben |', '| Review of businesses |'],
    'business views without personal data' => ['Profilaufrufe von Betrieben', 'Business profile views'],
    'affiliate links' => ['„Anzeige“', '"Ad"'],
    'PWA service worker' => ['Service Worker', 'service worker'],
    'web push recipients' => ['Google (zum Beispiel Chrome), Mozilla (Firefox), Apple (Safari) oder Microsoft', 'Google (for example Chrome), Mozilla (Firefox), Apple (Safari) or Microsoft'],
    'VAPID' => ['(VAPID)', '(VAPID)'],
    'link preview images' => ['## 11. Vorschaubilder für geteilte Links', '## 11. Preview images for shared links'],
    'client error reports' => ['## 12. Fehlerberichte der App', '## 12. App error reports'],
    'browser id cookie' => ['„sc_browser“', '"sc_browser"'],
    'membership scaffold' => ['Mitgliedschaft (noch nicht aktiv)', 'Membership (not active yet)'],
    // Since M5.5 (ADR-524) the recipient row names the one Shopify store for stickers and merch.
    'sticker shop' => ['Unser Online-Shop bei Shopify (Sticker und Merch)', 'Our online shop on Shopify (stickers and merch)'],
]);

it('states the storage periods the code applies', function () {
    $de = phase4LegalBody(LegalDocumentKey::Privacy, 'de');
    $en = phase4LegalBody(LegalDocumentKey::Privacy, 'en');
    $minutes = fn (int $seconds): int => intdiv($seconds, 60);

    expect($de)
        ->toContain('Ein Code gilt '.config()->integer('speedclub.email_code.expires_minutes').' Minuten.')
        ->toContain('| Anmeldecodes und Anmeldelinks per E-Mail | gültig '.config()->integer('speedclub.email_code.expires_minutes').' Minuten, gelöscht nach '.config()->integer('speedclub.email_code.retention_hours').' Stunden |')
        ->toContain('| Anmeldevorgänge mit Passkeys | gültig '.$minutes(config()->integer('speedclub.passkeys.challenge_ttl_seconds')).' Minuten, innerhalb der folgenden Stunde gelöscht |')
        ->toContain('| Sicherheitsaktivität in den Einstellungen | '.config()->integer('speedclub.security_events.retention_months').' Monate |')
        ->toContain('Der Link „Das war ich nicht“ in diesen E-Mails gilt '.config()->integer('speedclub.security_events.secure_link_days').' Tage')
        ->toContain('| App-Installationen (Prüfsumme der Kennung, Modell, Versionen) | '.config()->integer('speedclub.known_devices.retention_months').' Monate')
        ->toContain('| Anmeldungen in der App | laufen nach '.config()->integer('speedclub.tokens.expires_days').' Tagen ab')
        ->toContain('spätestens '.config()->integer('speedclub.web_push.orphan_days').' Tage, nachdem dein Browser')
        ->toContain('höchstens '.intdiv(config()->integer('speedclub.web_push.ttl_seconds'), 3600).' Stunden bereit')
        ->toContain('| Anwendungsprotokolle und Fehlerberichte der App | '.config()->integer('logging.channels.client.days').' Tage |')
        ->toContain('| Mitteilungen in der App | '.config()->integer('speedclub.notifications.retention_days').' Tage |')
        ->toContain('| Treffen, die abgesagt oder abgelehnt wurden | '.config()->integer('speedclub.events.cancelled_retention_months').' Monate |')
        ->toContain('| Vergangene Treffen | '.config()->integer('speedclub.events.past_retention_months').' Monate nach dem Ende |')
        ->toContain('| Genaue Adresse eines Treffens, die nur Zugesagte sehen | '.config()->integer('speedclub.events.exact_place_retention_days').' Tage nach dem Ende')
        ->toContain('er gilt bis '.config()->integer('speedclub.events.calendar_link_days_after').' Tage nach dem Treffen')
        ->toContain('| Zwischenspeicher der Ortssuche | '.config()->integer('speedclub.geocode.cache_days').' Tage')
        ->toContain('(Cookie „sc_browser“, '.intdiv(config()->integer('speedclub.known_devices.browser_cookie_days'), 365).' Jahre)');

    expect($en)
        ->toContain('| Sign-in codes and sign-in links by email | valid for '.config()->integer('speedclub.email_code.expires_minutes').' minutes, deleted after '.config()->integer('speedclub.email_code.retention_hours').' hours |')
        ->toContain('| Security activity in settings | '.config()->integer('speedclub.security_events.retention_months').' months |')
        ->toContain('at the latest '.config()->integer('speedclub.web_push.orphan_days').' days after your browser')
        ->toContain('| Cancelled or rejected meets | '.config()->integer('speedclub.events.cancelled_retention_months').' months |')
        ->toContain('| Past meets | '.config()->integer('speedclub.events.past_retention_months').' months after the end |')
        ->toContain('| Exact address of a meet shown only to members who are going | '.config()->integer('speedclub.events.exact_place_retention_days').' days after the end')
        ->toContain('| Application logs and app error reports | '.config()->integer('logging.channels.client.days').' days |')
        ->toContain('(cookie "sc_browser", '.intdiv(config()->integer('speedclub.known_devices.browser_cookie_days'), 365).' years)');
});

it('gives every legal draft the same sections and table rows in German and English', function (LegalDocumentKey $key) {
    $rows = fn (string $locale): int => preg_match_all('/^\|.*\|$/m', phase4LegalBody($key, $locale));

    expect(count(phase4LegalHeadings($key, 'en')))->toBe(count(phase4LegalHeadings($key, 'de')))
        ->and($rows('en'))->toBe($rows('de'));
})->with(LegalDocumentKey::cases());

it('covers meets, businesses, the catalogue and the new social features in the terms and the community guidelines', function () {
    expect(phase4LegalHeadings(LegalDocumentKey::Terms, 'de'))->toContain('8. Build-Updates, Reaktionen, Erwähnungen und Kommentare', '9. Treffen', '10. Betriebe', '11. Teilekatalog und Anzeigen', '12. Wartung und Erinnerungen', '13. Mitgliedschaft und Sticker-Shop')
        ->and(phase4LegalHeadings(LegalDocumentKey::Terms, 'en'))->toContain('8. Build updates, reactions, mentions and comments', '9. Meets', '10. Businesses', '11. Parts catalogue and advertising', '12. Maintenance and reminders', '13. Membership and sticker shop')
        ->and(phase4LegalHeadings(LegalDocumentKey::Community, 'de'))->toContain('8. Treffen', '9. Betriebe und Werbung', '10. Reaktionen, Erwähnungen und Kommentare')
        ->and(phase4LegalHeadings(LegalDocumentKey::Community, 'en'))->toContain('8. Meets', '9. Businesses and advertising', '10. Reactions, mentions and comments')
        ->and(phase4LegalBody(LegalDocumentKey::Imprint, 'de'))->toContain('Betriebsprofile zeigen ein eigenes Impressum.')
        ->and(phase4LegalBody(LegalDocumentKey::Imprint, 'en'))->toContain('Business profiles show their own imprint.');

    // The event rules members accept in EVT-03 (lang/*/enums.php event_rule) are the rules of the community guidelines.
    foreach (['de', 'en'] as $locale) {
        foreach (trans('enums.event_rule', [], $locale) as $rule) {
            expect(phase4LegalBody(LegalDocumentKey::Community, $locale))->toContain((string) $rule);
        }
    }
});

it('keeps the numbers of the sections statements of reasons cite', function (LegalDocumentKey $key, string $locale, array $first) {
    expect(array_slice(phase4LegalHeadings($key, $locale), 0, count($first)))->toBe($first);
})->with([
    'terms de' => [LegalDocumentKey::Terms, 'de', ['1. Anbieter und Geltung', '2. Was Speedclub ist', '3. Konto', '4. Deine Inhalte', '5. Angaben zu Fahrzeugen und Modifikationen', '6. QR-Sticker', '7. Regeln']],
    'terms en' => [LegalDocumentKey::Terms, 'en', ['1. Provider and scope', '2. What Speedclub is', '3. Account', '4. Your content', '5. Vehicle and modification details', '6. QR stickers', '7. Rules']],
    'community de' => [LegalDocumentKey::Community, 'de', ['1. Autos zuerst', '2. Respekt', '3. Nur Legales', '4. Deine Inhalte', '5. Privatsphäre', '6. Kein Spam', '7. Modifikationen und Rechtliches']],
    'community en' => [LegalDocumentKey::Community, 'en', ['1. Cars first', '2. Respect', '3. Legal only', '4. Your content', '5. Privacy', '6. No spam', '7. Modifications and the law']],
]);

it('marks the drafts for the lawyer in the metadata only, and keeps the version out of the member-facing text', function (LegalDocumentKey $key, string $locale) {
    $file = (string) file_get_contents(database_path("data/legal/{$key->value}.$locale.md"));

    expect($file)->toContain('Entwurf – rechtliche Prüfung ausstehend')
        ->toContain('changes: docs/legal/phase-4-changes.md')
        ->and(phase4LegalBody($key, $locale))->not->toContain('Entwurf – rechtliche Prüfung', 'Version 1', 'version 1');
})->with([
    [LegalDocumentKey::Privacy, 'de'], [LegalDocumentKey::Privacy, 'en'],
    [LegalDocumentKey::Terms, 'de'], [LegalDocumentKey::Terms, 'en'],
    [LegalDocumentKey::Community, 'de'], [LegalDocumentKey::Community, 'en'],
    [LegalDocumentKey::Imprint, 'de'], [LegalDocumentKey::Imprint, 'en'],
]);

it('publishes the Phase 4 drafts over a seeded draft without asking anybody to accept again', function () {
    $old = "# Datenschutzerklärung\n\nAlter Entwurf.\n";
    $v1 = LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => LegalDocumentSeeder::VERSION, 'body_md' => $old]);
    $member = User::factory()->create(['terms_version' => '1', 'privacy_version' => '1']);

    $published = phase4LegalMigration()->publishOver(['privacy' => ['de' => [hash('sha256', $old)]]]);

    $current = app(LegalDocuments::class)->current(LegalDocumentKey::Privacy, 'de');
    $row = LegalDocument::query()->whereKey($current?->id)->firstOrFail();

    expect($published)->toBe(1)
        ->and($row->version)->toBe('2')
        ->and($row->body_md)->toBe(phase4LegalBody(LegalDocumentKey::Privacy, 'de'))
        // The placeholders stay in the row; OrgIdentity fills them when it is read.
        ->toContain('[[Datenschutz-E-Mail]]')
        ->and($row->requires_reconsent)->toBeFalse()
        ->and($row->summary)->toBeNull()
        ->and($row->reason)->toBe(phase4LegalMigration()::REASON)->not->toMatch('/\b(?:M\d|OA-\d|BL-\d)/')
        ->and($v1->fresh()?->body_md)->toBe($old)
        ->and(AuditEvent::query()->where('action', 'legal.published')->where('target_id', (string) $row->id)
            ->where('actor_type', AuditActorType::System->value)->exists())->toBeTrue()
        ->and(app(Consents::class)->outstanding($member))->toBeFalse()
        ->and(app(LegalDocuments::class)->reconsentVersion(LegalDocumentKey::Privacy))->toBeNull();

    // Again: the current text is the new one now, whose hash is no seeded draft.
    expect(phase4LegalMigration()->publishOver(['privacy' => ['de' => [hash('sha256', $old)]]]))->toBe(0)
        ->and(LegalDocument::query()->where('key', LegalDocumentKey::Privacy)->count())->toBe(2);
});

it('leaves a text staff changed in ADM-31 alone, and takes the next free version past a draft', function () {
    LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'version' => '1', 'body_md' => "# AGB\n\nVon Hand geändert.\n"]);
    $seeded = "# AGB\n\nSeeder-Entwurf.\n";
    LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'en', 'version' => '1', 'body_md' => $seeded]);
    $draft = LegalDocument::factory()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'en', 'version' => '2', 'body_md' => "# Terms\n\nDraft.\n"]);

    $published = phase4LegalMigration()->publishOver(['terms' => ['de' => [hash('sha256', $seeded)], 'en' => [hash('sha256', $seeded)]]]);

    expect($published)->toBe(1)
        ->and(app(LegalDocuments::class)->current(LegalDocumentKey::Terms, 'de')?->body_md)->toBe("# AGB\n\nVon Hand geändert.\n")
        ->and(app(LegalDocuments::class)->current(LegalDocumentKey::Terms, 'en')?->version)->toBe('3')
        ->and($draft->fresh()?->published_at)->toBeNull();
});

it('does nothing on a fresh host, where the seeder writes the Phase 4 drafts as version 1', function () {
    phase4LegalMigration()->up();
    expect(LegalDocument::query()->count())->toBe(0);

    $this->seed(LegalDocumentSeeder::class);
    phase4LegalMigration()->up();

    foreach ([LegalDocumentKey::Privacy, LegalDocumentKey::Terms, LegalDocumentKey::Community, LegalDocumentKey::Imprint] as $key) {
        expect(LegalDocument::query()->where('key', $key)->orderBy('locale')->pluck('body_md')->all())
            ->toBe([phase4LegalBody($key, 'de'), phase4LegalBody($key, 'en')]);
    }

    expect(LegalDocument::query()->where('version', '!=', LegalDocumentSeeder::VERSION)->count())->toBe(0);
});

it('lists no hash of the current drafts as an old seeded text', function () {
    foreach (phase4LegalMigration()::SEEDED as $key => $locales) {
        foreach ($locales as $locale => $hashes) {
            expect($hashes)->not->toContain(hash('sha256', phase4LegalBody(LegalDocumentKey::from($key), $locale)));
        }
    }
});
