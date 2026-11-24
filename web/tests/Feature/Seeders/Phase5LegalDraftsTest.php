<?php

use App\Enums\AuditActorType;
use App\Enums\LegalDocumentKey;
use App\Models\AuditEvent;
use App\Models\DeviceInstall;
use App\Models\LegalDocument;
use App\Models\User;
use App\Services\Admin\Spots\SpotSignals;
use App\Services\AppConfig\LegalDocuments;
use App\Services\Content\Consents;
use App\Services\Insights\ViewRecorder;
use App\Services\Insights\ViewRetention;
use App\Services\Notifications\NotificationPrefs;
use App\Services\Notifications\SocialPushLimiter;
use Database\Seeders\BrandContentDemoSeeder;
use Database\Seeders\LegalDocumentSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * M5.9f gift gate (10 §16, OA-35): the Datenschutzerklärung, AGB and Community-Richtlinien describe what the Speedclub 2.1 gift features
 * do, state the numbers and storage periods the code applies (each compared with config or the code's constant here), keep the section
 * numbers Phase 4 pinned, and reach hosts seeded earlier, including those on the Phase 4 text, through a data migration that asks nobody
 * to accept anything. Change list for the lawyer: docs/legal/phase-5-changes.md.
 */
function phase5LegalMigration(): object
{
    return require database_path('migrations/2026_12_21_100000_publish_phase_5_legal_drafts.php');
}

/** The member-facing text of database/data/legal/{key}.{locale}.md, as LegalDocumentSeeder stores it. */
function phase5LegalBody(LegalDocumentKey $key, string $locale): string
{
    preg_match('/\A---\R(.*?)\R---\R+(.*)\z/s', (string) file_get_contents(database_path("data/legal/{$key->value}.$locale.md")), $parts);

    return trim($parts[2])."\n";
}

/** @return list<string> the `## ` headings of a draft */
function phase5LegalHeadings(LegalDocumentKey $key, string $locale): array
{
    preg_match_all('/^## (.+)$/m', phase5LegalBody($key, $locale), $matches);

    return $matches[1];
}

/** A whole number the way the German text writes it ("1.000"). */
function phase5De(int $number): string
{
    return number_format($number, 0, ',', '.');
}

it('describes every gift feature in the German and the English privacy policy', function (string $de, string $en) {
    expect(phase5LegalBody(LegalDocumentKey::Privacy, 'de'))->toContain($de)
        ->and(phase5LegalBody(LegalDocumentKey::Privacy, 'en'))->toContain($en);
})->with([
    'plate blur before storing' => ['unser Server verpixelt sie, bevor er das Foto speichert', 'our server pixelates it before it stores the photo'],
    'no unblurred original kept' => ['Wir speichern nur die verpixelte Fassung, auch als private Originaldatei', 'We only store the pixelated version, also as the private original file'],
    'plate check of older photos' => ['(„Kennzeichen prüfen“)', '("Check number plates")'],
    'STREET DEX section' => ['## 13. STREET DEX: Kamera, Standort und Spots', '## 13. STREET DEX: camera, location and spots'],
    'camera stores nothing' => ['Wir speichern dabei keine Fotos und keine Videos', 'We store no photos and no videos'],
    'approximate location only' => ['unter Android nur den groben Standort, unter iOS mit reduzierter Genauigkeit', 'on Android only the coarse location, on iOS with reduced accuracy'],
    'city and Bundesland only' => ['An uns gehen nur diese Stadt und ihr Bundesland, nie Koordinaten.', 'Only that city and its federal state reach us, never coordinates.'],
    'show my spots' => ['wenn „Meine Spots zeigen“ an ist', 'only if "Show my spots" is on'],
    'ghost mode' => ['Im Ghost-Modus taucht dein Auto nicht mehr in Suche, Entdecken und Listen auf', 'In Ghost mode your car no longer shows up in search, Discover and lists'],
    'night spot cities' => ['Die Stadt eines Spots zwischen 22 und 6 Uhr nennen wir zu einem einzelnen Auto nie', 'We never name the city of a spot between 10 pm and 6 am for a single car'],
    'abuse purpose' => ['**Missbrauchsabwehr beim Spotten.**', '**Spotting abuse prevention.**'],
    'install key without account' => ['eine zweite verschlüsselte Prüfsumme dieser Kennung ohne Bezug zu deinem Konto', 'a second encrypted checksum of this identifier without any link to your account'],
    'human decides' => ['Ein Hinweis führt nie automatisch zu einer Sperre, es entscheidet immer ein Mensch.', 'A signal never leads to an automatic block; a human always decides.'],
    'abuse legal basis' => ['Rechtsgrundlage ist unser berechtigtes Interesse an fairen Spots (Art. 6 Abs. 1 lit. f DSGVO).', 'The legal basis is our legitimate interest in fair spots (Art. 6(1)(f) GDPR).'],
    'no XP for likes' => ['Für Likes und Reaktionen, für Follower, für die Menge deiner Beiträge und fürs Anmelden gibt es keine XP.', 'There is no XP for likes and reactions, for followers, for the number of your posts or for signing in.'],
    'level public, XP not' => ['Neben deinem Namen steht dein Level mit Titel, deine XP nicht.', 'Your level with its title appears next to your name, your XP does not.'],
    'founding number public' => ['deine Founding-Member-Nummer sind in deinem Profil öffentlich', 'your Founding Member number are public on your profile'],
    'car of the day withdraw' => ['Willst du nicht ausgewählt werden, schalte den Ghost-Modus ein', 'If you do not want to be picked, turn on Ghost mode'],
    'invites section' => ['## 15. Einladungen', '## 15. Invites'],
    'invitee as a member' => ['sonst als „ein Mitglied“', 'otherwise as "a member"'],
    'crew starter only' => ['Beide bekommen nur das Abzeichen „Crew Starter“, keine XP', 'Both get only the "Crew Starter" badge, no XP'],
    'build score section' => ['## 16. Build Score', '## 16. Build Score'],
    'values never count' => ['Leistung, Drehmoment und Kosten fließen nicht ein.', 'power, torque and costs are not used.'],
    'public city only' => ['Das Bundesland nehmen wir nur aus der Stadt in deinem öffentlichen Profil, nie aus der Region', 'We take the federal state only from the city in your public profile, never from the region'],
    'wrapped section' => ['## 17. Season Wrapped', '## 17. Season Wrapped'],
    'wrapped names nobody' => ['Namen anderer Mitglieder stehen nicht darin.', 'No other member\'s name appears in it.'],
    'share QR is the page' => ['führt ihr QR-Code zur öffentlichen Seite deines Autos, nie zum Code deines Stickers', 'its QR code leads to your car\'s public page, never to the code of your sticker'],
    'server-drawn QR' => ['führt er zur öffentlichen Seite des Autos und nie zum Code deines Stickers', 'it leads to the car\'s public page and never to the code of your sticker'],
    'engagement pushes' => ['## 20. Mitteilungen zu Spots, Abzeichen, Car of the Day und Einladungen', '## 20. Notifications about spots, badges, Car of the Day and invites'],
    // M5.7 (review SF-7, BL-21): view counting, build reminders, the weekly recap; M5.8 the forum; M5.5 the shop.
    'views section' => ['## 18. Aufrufe und Statistiken', '## 18. Views and statistics'],
    'views without identity' => ['keine Uhrzeit, keine IP-Adresse, keine Browserkennung und keine Mitgliedsnummer', 'no time of day, no IP address, no browser identifier and no member number'],
    'views never who' => ['**Wer eine Seite angesehen hat, zeigen wir niemandem**', '**We show nobody who viewed a page**'],
    'views never public' => ['Aufrufzahlen sind nie öffentlich.', 'View counts are never public.'],
    'recap only when something happened' => ['Ist in deiner Woche nichts passiert, schicken wir nichts.', 'If nothing happened in your week, we send nothing.'],
    'no push about views' => ['Über deine Aufrufe schicken wir nie eine Mitteilung.', 'We never send a notification about your views.'],
    'forum section' => ['## 19. Forum', '## 19. Forum'],
    'forum helpful counts in the forum only' => ['ist im Forum für alle sichtbar, nirgends sonst; wer markiert hat, sieht niemand', 'is visible to everyone in the forum, nowhere else; nobody sees who marked it'],
    'forum account deletion' => ['behält seinen Titel und die Antworten der anderen, ohne deinen Namen und ohne deinen Text', 'keeps its title and the others\' replies, without your name and without your text'],
    'shop passes no data' => ['wir übergeben dabei keine Daten über dich und hängen keine Tracking-Parameter an', 'we pass no data about you and add no tracking parameters'],
    'export contents' => ['Dazu kommen deine Spots (Stadt und Bundesland, nie Koordinaten)', 'It also contains your spots (city and federal state, never coordinates)'],
    'export without the key' => ['Die Prüfsumme für die Missbrauchsabwehr beim Spotten steht nie darin.', 'The checksum for spotting abuse prevention is never in it.'],
    'no further recipients' => ['geben wir keine Daten an weitere Stellen', 'we pass no data to further parties'],
    'city list on device' => ['für STREET DEX die Ortsliste mit Städten in Deutschland', 'for STREET DEX the list of places with cities in Germany'],
    // M5.6 (m5.6-contract §5, §6): the weekly nearby meets (opt-in, the chosen region only), the check-in without a location.
    'nearby meets opt-in' => ['Nur wenn du es in den Einstellungen unter Mitteilungen einschaltest (voreingestellt ist es aus)', 'Only if you turn it on under notifications in settings (it is off by default)'],
    'nearby meets region only' => ['Dafür nutzen wir nur diese selbst gewählte Region, nie den Standort deines Geräts.', 'We only use this region you chose, never your device\'s location.'],
    'nearby meets unsubscribe link' => ['Jede dieser E-Mails enthält einen Link, über den du sie abbestellst', 'Every one of these emails has a link that unsubscribes you'],
    'check-in without location' => ['Wir speichern nur, dass und wann du eingecheckt hast, nie einen Standort, ein Gerät oder eine IP-Adresse.', 'We only store that you checked in and when, never a location, a device or an IP address.'],
    'check-in only after the meet' => ['„War dabei“ erscheint auf deinem Profil erst, wenn das Treffen vorbei ist', 'appears on your profile only once the meet is over'],
]);

it('states the numbers and storage periods the code applies', function () {
    $de = phase5LegalBody(LegalDocumentKey::Privacy, 'de');
    $en = phase5LegalBody(LegalDocumentKey::Privacy, 'en');
    $hour = fn (string $time): int => (int) substr($time, 0, 2);
    $night = config()->array('speedclub.dex.night');
    $quiet = config()->array('speedclub.notifications.social_quiet_hours');
    $founding = config()->integer('speedclub.founding.max');
    $levels = array_keys(config()->array('speedclub.xp.levels'));

    // The fixed windows the text writes as words: night spots 22–6, social quiet hours 22–8, the season 1 March to 31 October, an hour.
    expect([$hour($night['from']), $hour($night['to'])])->toBe([22, 6])
        ->and([$hour($quiet['from']), $hour($quiet['to'])])->toBe([22, 8])
        ->and([config('speedclub.wrapped.season_start'), config('speedclub.wrapped.season_end')])->toBe(['03-01', '10-31'])
        ->and(SpotSignals::HOP_SECONDS)->toBe(3600)
        ->and(SpotSignals::BURST_SECONDS % 60)->toBe(0);

    expect($de)
        ->toContain('Dasselbe Auto zählt für dich höchstens einmal in '.config()->integer('speedclub.dex.duplicate_hours').' Stunden.')
        ->toContain('Spots aus Konten, die jünger als '.config()->integer('speedclub.dex.young_account_hours').' Stunden sind')
        ->toContain('an welchen der letzten '.config()->integer('speedclub.dex.stats_days').' Tage und wer es zuletzt gespottet hat (bis zu '.config()->integer('speedclub.dex.recent_spotters').' Spotter)')
        ->toContain('Namen und Tage zeigen wir frühestens '.config()->integer('speedclub.dex.alerts.window_hours').' Stunden nach dem Spot.')
        ->toContain('Alle '.config()->integer('speedclub.dex.alerts.window_hours').' Stunden fassen wir neue Spots')
        ->toContain('Sie zählt Spots, die mindestens '.config()->integer('speedclub.dex.map.min_age_hours').' Stunden und höchstens '.config()->integer('speedclub.dex.map.days').' Tage alt sind')
        ->toContain('von mindestens '.config()->integer('speedclub.dex.map.min_cars').' verschiedenen Autos stammen')
        ->toContain('mehr als '.SpotSignals::BURST_MORE_THAN.' Spots eines Kontos in '.intdiv(SpotSignals::BURST_SECONDS, 60).' Minuten')
        ->toContain('die mehr als '.SpotSignals::HOP_KM.' km auseinanderliegen, innerhalb einer Stunde')
        ->toContain('Am Tag sind höchstens '.config()->integer('speedclub.xp.daily_cap').' XP möglich.')
        ->toContain('dein Level von '.min($levels).' bis '.max($levels).' mit einem Titel')
        ->toContain('Die ersten '.phase5De($founding).' Mitglieder')
        ->toContain('eine laufende Nummer von #0001 bis #'.sprintf('%04d', $founding))
        ->toContain('Jeden Tag um '.$hour((string) config('speedclub.car_of_the_day.publish_at')).' Uhr zeigen wir ein Auto als Car of the Day')
        ->toContain('ein öffentliches Auto mit einem Build Score ab '.config()->integer('speedclub.car_of_the_day.min_build_score').' und mindestens '.config()->integer('speedclub.car_of_the_day.min_photos').' Fotos, das in den letzten '.config()->integer('speedclub.car_of_the_day.gap_days').' Tagen')
        ->toContain('(höchstens '.config()->integer('speedclub.car_of_the_day.story_max').' Zeichen)')
        ->toContain('Du hast '.config()->integer('speedclub.invites.per_member').' Einladungscodes.')
        ->toContain('Der Build Score (0 bis '.phase5De(config()->integer('speedclub.build_score.max')).')')
        ->toContain('Ränge gibt es nur in Gruppen ab '.config()->integer('speedclub.build_score.ranks.min_group').' öffentlichen Autos')
        ->toContain('Wir erstellen ihn ab '.config()->integer('speedclub.wrapped.generate_days_before').' Tagen vor dem Termin')
        ->toContain('nur Städte, höchstens '.config()->integer('speedclub.wrapped.max_cities').',')
        ->toContain('nur wenn mindestens '.config()->integer('speedclub.wrapped.percentile.min_members').' Mitglieder verglichen werden und du unter den besten '.config()->integer('speedclub.wrapped.percentile.max_top').' % bist')
        ->toContain('| Spots | sofort, wenn du oder der Besitzer des Autos das Konto löscht; mit einem gelöschten Auto nach '.config()->integer('speedclub.garage.hard_delete_after_days').' Tagen |')
        ->toContain('| Einladungscode, mit dem du dich registriert hast | bis zur Aktivierung deines Kontos; mit einem Konto, dessen E-Mail-Adresse nie bestätigt wurde, nach '.config()->integer('speedclub.verification.unverified_account_retention_days').' Tagen |')
        ->toContain('| Tagesgrenze für Push zu Spots, Abzeichen, Car of the Day, Einladungen und neuen Treffen in deiner Nähe | '.SocialPushLimiter::KEEP_DAYS.' Tage |')
        // M5.6: the nearby meets (weekly, Thursday from 18:00, two weeks ahead, the radius) and the gallery window and purge.
        ->toContain('höchstens einmal pro Woche, donnerstags ab '.(int) config('speedclub.events.nearby_time').' Uhr')
        ->toContain('neuen öffentlichen Treffen der nächsten '.config()->integer('speedclub.events.nearby_ahead_days').' Tage im Umkreis von '.config()->integer('speedclub.events.nearby_radius_km').' km')
        ->toContain('ab dem Ende eines Treffens bis '.config()->integer('speedclub.events.gallery_days').' Tage danach Fotos')
        ->toContain('die Bilddateien löschen wir nach '.config()->integer('speedclub.events.gallery_rejected_purge_days').' Tagen')
        ->toContain('| Mitteilungen in der App | '.config()->integer('speedclub.notifications.retention_days').' Tage |')
        // M5.7 (review SF-7): view counting, the recap and the engagement cap; M5.8 pre-moderation.
        ->toContain('Von einer Adresse zählen wir höchstens '.ViewRecorder::GUEST_VIEWS_PER_ADDRESS.' neue Aufrufe pro Seite und Tag')
        ->toContain('Die einzelnen Einträge löschen wir nach '.config()->integer('speedclub.insights.raw_retention_days').' Tagen')
        ->toContain('| Einzelne Aufrufe (Seite, Tag, Quelle, Prüfsumme) | '.config()->integer('speedclub.insights.raw_retention_days').' Tage; ab dem Folgetag ohne Personenbezug |')
        ->toContain('| Protokoll des Wochenrückblicks | '.ViewRetention::RECAP_WEEKS.' Wochen |')
        ->toContain('(höchstens drei pro Woche) | '.ViewRetention::CLAIM_DAYS.' Tage |')
        ->toContain('kommen höchstens '.['', 'einmal', 'zweimal', 'dreimal'][config()->integer('speedclub.notifications.engagement_weekly_max')].' pro Woche als Push')
        ->toContain('Ist dein Konto jünger als '.config()->integer('speedclub.forum.premoderation_days').' Tage');

    expect($en)
        ->toContain('The same car counts for you at most once in '.config()->integer('speedclub.dex.duplicate_hours').' hours.')
        ->toContain('Names and days appear '.config()->integer('speedclub.dex.alerts.window_hours').' hours after the spot at the earliest.')
        ->toContain('It counts spots that are at least '.config()->integer('speedclub.dex.map.min_age_hours').' hours and at most '.config()->integer('speedclub.dex.map.days').' days old')
        ->toContain('from at least '.config()->integer('speedclub.dex.map.min_cars').' different cars')
        ->toContain('At most '.config()->integer('speedclub.xp.daily_cap').' XP are possible per day.')
        ->toContain('a running number from #0001 to #'.sprintf('%04d', $founding))
        ->toContain('a public car with a Build Score of at least '.config()->integer('speedclub.car_of_the_day.min_build_score').' and at least '.config()->integer('speedclub.car_of_the_day.min_photos').' photos that was not picked in the last '.config()->integer('speedclub.car_of_the_day.gap_days').' days')
        ->toContain('You have '.config()->integer('speedclub.invites.per_member').' invite codes.')
        ->toContain('groups of at least '.config()->integer('speedclub.build_score.ranks.min_group').' public cars')
        ->toContain('| Spots | immediately when you or the car\'s owner deletes the account; with a deleted car after '.config()->integer('speedclub.garage.hard_delete_after_days').' days |')
        ->toContain('| Daily limit for push about spots, badges, Car of the Day, invites and new meets near you | '.SocialPushLimiter::KEEP_DAYS.' days |')
        ->toContain('new public meets in the next '.config()->integer('speedclub.events.nearby_ahead_days').' days within '.config()->integer('speedclub.events.nearby_radius_km').' km')
        ->toContain('from its end until '.config()->integer('speedclub.events.gallery_days').' days later')
        // M5.7: the view counting and engagement numbers (review SF-7).
        ->toContain('we count at most '.ViewRecorder::GUEST_VIEWS_PER_ADDRESS.' new views per page and day')
        ->toContain('We delete the single entries after '.config()->integer('speedclub.insights.raw_retention_days').' days');
});

it('says only what the code does about defaults, coordinates and the install key', function () {
    $member = User::factory()->create();
    $spotColumns = Schema::getColumnListing('spots');

    // "Meine Spots zeigen" is on by default; push for badges and everybody's Car of the Day is off, the owner's own one on.
    expect((bool) DB::table('users')->where('id', $member->id)->value('show_my_spots'))->toBeTrue()
        ->and(NotificationPrefs::TYPES['badge_unlocked']['push'])->toBeFalse()
        ->and(NotificationPrefs::TYPES['car_of_the_day']['push'])->toBeFalse()
        ->and(NotificationPrefs::TYPES['car_of_the_day_owner']['push'])->toBeTrue()
        ->and(NotificationPrefs::TYPES['spot_alert']['push'])->toBeTrue()
        ->and(NotificationPrefs::TYPES['invite_accepted']['push'])->toBeTrue()
        // M5.6: "neue Treffen in deiner Nähe" is off on every channel and shares the daily limit.
        ->and(NotificationPrefs::TYPES['event_nearby'])->toBe(['push' => false, 'email' => false])
        ->and(SocialPushLimiter::TYPES)->toBe(['spot_alert', 'badge_unlocked', 'car_of_the_day', 'invite_accepted', 'event_nearby'])
        // "nie Koordinaten": a spot has a city and a Bundesland, no position.
        ->and($spotColumns)->toContain('city_id', 'bundesland', 'is_night')
        ->and(array_intersect($spotColumns, ['lat', 'lng', 'latitude', 'longitude', 'location', 'coordinates']))->toBe([])
        // The install key never leaves the model.
        ->and((new DeviceInstall)->getHidden())->toContain('install_key');
});

it('gives the changed drafts the same sections and table rows in German and English', function (LegalDocumentKey $key) {
    $rows = fn (string $locale): int => preg_match_all('/^\|.*\|$/m', phase5LegalBody($key, $locale));

    expect(count(phase5LegalHeadings($key, 'en')))->toBe(count(phase5LegalHeadings($key, 'de')))
        ->and($rows('en'))->toBe($rows('de'));
})->with([LegalDocumentKey::Privacy, LegalDocumentKey::Terms, LegalDocumentKey::Community]);

it('adds the gift sections after the ones Phase 4 numbered, and numbers every section in order', function (LegalDocumentKey $key, string $locale, array $added) {
    $headings = phase5LegalHeadings($key, $locale);

    expect($headings)->toContain(...$added);

    foreach ($headings as $index => $heading) {
        expect($heading)->toStartWith(($index + 1).'. ');
    }
})->with([
    // M5.7/M5.8 (review SF-7, BL-21): "Aufrufe und Statistiken" and "Forum" after Season Wrapped; the sections after them moved by two.
    'privacy de' => [LegalDocumentKey::Privacy, 'de', ['7. Treffen', '11. Vorschaubilder für geteilte Links', '12. Fehlerberichte der App', '13. STREET DEX: Kamera, Standort und Spots', '14. Level, Abzeichen, Founding Member und Car of the Day', '15. Einladungen', '16. Build Score', '17. Season Wrapped', '18. Aufrufe und Statistiken', '19. Forum', '20. Mitteilungen zu Spots, Abzeichen, Car of the Day und Einladungen', '24. Wie lange wir Daten speichern', '25. Deine Rechte']],
    'privacy en' => [LegalDocumentKey::Privacy, 'en', ['7. Meets', '11. Preview images for shared links', '12. App error reports', '13. STREET DEX: camera, location and spots', '14. Levels, badges, Founding Member and Car of the Day', '15. Invites', '16. Build Score', '17. Season Wrapped', '18. Views and statistics', '19. Forum', '20. Notifications about spots, badges, Car of the Day and invites', '24. How long we keep data', '25. Your rights']],
    'terms de' => [LegalDocumentKey::Terms, 'de', ['13. Mitgliedschaft und Sticker-Shop', '14. STREET DEX und Spots', '15. Level, Abzeichen, Build Score und andere Extras', '16. Moderation, Einschränkungen und Beschwerden']],
    'terms en' => [LegalDocumentKey::Terms, 'en', ['13. Membership and sticker shop', '14. STREET DEX and spots', '15. Levels, badges, Build Score and other extras', '16. Moderation, restrictions and complaints']],
    'community de' => [LegalDocumentKey::Community, 'de', ['10. Reaktionen, Erwähnungen und Kommentare', '11. STREET DEX und Spots', '12. Level, Abzeichen, Build Score und Einladungen', '13. Melden', '14. Folgen']],
    'community en' => [LegalDocumentKey::Community, 'en', ['10. Reactions, mentions and comments', '11. STREET DEX and spots', '12. Levels, badges, Build Score and invites', '13. Reporting', '14. Consequences']],
]);

it('marks the changed drafts for the lawyer in the metadata only', function (LegalDocumentKey $key, string $locale) {
    $file = (string) file_get_contents(database_path("data/legal/{$key->value}.$locale.md"));

    expect($file)->toContain('Entwurf – rechtliche Prüfung ausstehend (Phase-4- und Phase-5-Änderungen, OA-35)')
        ->toContain('docs/legal/phase-5-changes.md')
        ->and(phase5LegalBody($key, $locale))->not->toContain('Entwurf – rechtliche Prüfung', 'phase-5-changes');
})->with([
    [LegalDocumentKey::Privacy, 'de'], [LegalDocumentKey::Privacy, 'en'],
    [LegalDocumentKey::Terms, 'de'], [LegalDocumentKey::Terms, 'en'],
    [LegalDocumentKey::Community, 'de'], [LegalDocumentKey::Community, 'en'],
]);

it('keeps the QR-Codes sentence the ADM-31 demo draft is built on', function () {
    expect(BrandContentDemoSeeder::privacyDraft()['body_md'])->toContain(BrandContentDemoSeeder::PRIVACY_DRAFT_SENTENCE);
});

it('publishes the Phase 5 drafts over a seeded draft without asking anybody to accept again', function () {
    $old = "# Datenschutzerklärung\n\nPhase-4-Entwurf.\n";
    $v1 = LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => LegalDocumentSeeder::VERSION, 'body_md' => $old]);
    $member = User::factory()->create(['terms_version' => '1', 'privacy_version' => '1']);

    $published = phase5LegalMigration()->publishOver(['privacy' => ['de' => [hash('sha256', $old)]]]);

    $current = app(LegalDocuments::class)->current(LegalDocumentKey::Privacy, 'de');
    $row = LegalDocument::query()->whereKey($current?->id)->firstOrFail();

    expect($published)->toBe(1)
        ->and($row->version)->toBe('2')
        ->and($row->body_md)->toBe(phase5LegalBody(LegalDocumentKey::Privacy, 'de'))
        // The placeholders stay in the row; OrgIdentity fills them when it is read.
        ->toContain('[[Datenschutz-E-Mail]]')
        ->and($row->requires_reconsent)->toBeFalse()
        ->and($row->summary)->toBeNull()
        ->and($row->reason)->toBe(phase5LegalMigration()::REASON)->not->toMatch('/\b(?:M\d|OA-\d|BL-\d)/')
        ->and($v1->fresh()?->body_md)->toBe($old)
        ->and(AuditEvent::query()->where('action', 'legal.published')->where('target_id', (string) $row->id)
            ->where('actor_type', AuditActorType::System->value)->exists())->toBeTrue()
        ->and(app(Consents::class)->outstanding($member))->toBeFalse()
        ->and(app(LegalDocuments::class)->reconsentVersion(LegalDocumentKey::Privacy))->toBeNull();

    // Again: the current text is the new one now, whose hash is no seeded draft.
    expect(phase5LegalMigration()->publishOver(['privacy' => ['de' => [hash('sha256', $old)]]]))->toBe(0)
        ->and(LegalDocument::query()->where('key', LegalDocumentKey::Privacy)->count())->toBe(2);
});

it('publishes over the text the Phase 4 migration shipped as well as every older seeded text', function () {
    $phase4 = require database_path('migrations/2026_12_09_100000_publish_phase_4_legal_drafts.php');

    foreach (['privacy', 'terms', 'community'] as $key) {
        foreach (['de', 'en'] as $locale) {
            $hashes = phase5LegalMigration()::SEEDED[$key][$locale];

            // Every body Phase 4 knew, plus the one it published (one more hash, which Phase 4 did not list).
            expect(array_diff($phase4::SEEDED[$key][$locale], $hashes))->toBe([])
                ->and(count($hashes))->toBe(count($phase4::SEEDED[$key][$locale]) + 1)
                ->and(array_unique($hashes))->toHaveCount(count($hashes));
        }
    }

    // The imprint did not change in Phase 5.
    expect(phase5LegalMigration()::SEEDED)->not->toHaveKey('imprint');
});

it('leaves a text staff changed in ADM-31 alone, and takes the next free version past a draft', function () {
    LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Community, 'locale' => 'de', 'version' => '1', 'body_md' => "# Community-Richtlinien\n\nVon Hand geändert.\n"]);
    $seeded = "# Richtlinien\n\nSeeder-Entwurf.\n";
    LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Community, 'locale' => 'en', 'version' => '1', 'body_md' => $seeded]);
    $draft = LegalDocument::factory()->create(['key' => LegalDocumentKey::Community, 'locale' => 'en', 'version' => '2', 'body_md' => "# Guidelines\n\nDraft.\n"]);

    $published = phase5LegalMigration()->publishOver(['community' => ['de' => [hash('sha256', $seeded)], 'en' => [hash('sha256', $seeded)]]]);

    expect($published)->toBe(1)
        ->and(app(LegalDocuments::class)->current(LegalDocumentKey::Community, 'de')?->body_md)->toBe("# Community-Richtlinien\n\nVon Hand geändert.\n")
        ->and(app(LegalDocuments::class)->current(LegalDocumentKey::Community, 'en')?->version)->toBe('3')
        ->and(app(LegalDocuments::class)->current(LegalDocumentKey::Community, 'en')?->body_md)->toBe(phase5LegalBody(LegalDocumentKey::Community, 'en'))
        ->and($draft->fresh()?->published_at)->toBeNull();
});

it('does nothing on a fresh host, where the seeder writes the Phase 5 drafts as version 1', function () {
    phase5LegalMigration()->up();
    expect(LegalDocument::query()->count())->toBe(0);

    $this->seed(LegalDocumentSeeder::class);
    phase5LegalMigration()->up();
    phase5LegalMigration()->up();

    foreach ([LegalDocumentKey::Privacy, LegalDocumentKey::Terms, LegalDocumentKey::Community] as $key) {
        expect(LegalDocument::query()->where('key', $key)->orderBy('locale')->pluck('body_md')->all())
            ->toBe([phase5LegalBody($key, 'de'), phase5LegalBody($key, 'en')]);
    }

    expect(LegalDocument::query()->where('version', '!=', LegalDocumentSeeder::VERSION)->count())->toBe(0);
});

it('lists no hash of the current drafts as an old seeded text', function () {
    foreach (phase5LegalMigration()::SEEDED as $key => $locales) {
        foreach ($locales as $locale => $hashes) {
            expect($hashes)->not->toContain(hash('sha256', phase5LegalBody(LegalDocumentKey::from($key), $locale)));
        }
    }
});
