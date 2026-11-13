<?php

/**
 * Local backend helper of the Playwright harness, called by support/backend.mjs. It touches only what the browser tests
 * need and nothing a real member owns: accounts under E2E_DOMAIN, the auth rate limiters of the loopback addresses, and
 * the login delay and "account exists" notice budget of the addresses a test names.
 *
 *   php tests/e2e/support/backend.php reset-limits [email ...]
 *   php tests/e2e/support/backend.php reset-csrf-limit
 *   php tests/e2e/support/backend.php age-codes <email> <purpose>
 *   php tests/e2e/support/backend.php ensure-onboarding
 *   E2E_MEMBER_PASSWORD=… php tests/e2e/support/backend.php create-member <email> <username> [done|username|profile]
 *   php tests/e2e/support/backend.php delete-accounts [local-part-prefix]
 *   php tests/e2e/support/backend.php close-updates <vehicle id>
 *   php tests/e2e/support/backend.php qr-scans <code>
 *   php tests/e2e/support/backend.php set-discoverable <test email> <0|1>
 *   php tests/e2e/support/backend.php set-who-can-message <test email> <everyone|following|nobody>
 *   php tests/e2e/support/backend.php run-test-jobs <test email>
 *   php tests/e2e/support/backend.php decide-test-case <test email>
 *   php tests/e2e/support/backend.php ensure-sessions-fixture
 *   E2E_STAFF_PASSWORD=… E2E_STAFF_SECRETS='{"owner":"…"}' [E2E_STAFF_LABELS='["owner",…]'] php tests/e2e/support/backend.php ensure-staff
 *   php tests/e2e/support/backend.php delete-staff
 *   php tests/e2e/support/backend.php remove-branding-fixture
 *   php tests/e2e/support/backend.php branding-state
 *   php tests/e2e/support/backend.php park-branding-draft
 *   php tests/e2e/support/backend.php lend-seeded-drafts <staff fixture label>
 *   php tests/e2e/support/backend.php restore-seeded-drafts
 *   php tests/e2e/support/backend.php enable-premium-fixture
 *   php tests/e2e/support/backend.php disable-premium-fixture
 *   php tests/e2e/support/backend.php enable-m414-flags
 *   php tests/e2e/support/backend.php disable-m414-flags
 *   php tests/e2e/support/backend.php review-test-business <slug of a test owner's business> verify|reject
 *   php tests/e2e/support/backend.php run-health-fixture
 *   php tests/e2e/support/backend.php remove-health-fixture
 *   php tests/e2e/support/backend.php reset-staff-limits
 *   php tests/e2e/support/backend.php seeded-audit-event
 *   php tests/e2e/support/backend.php start-view-as <staff fixture label>
 *   php tests/e2e/support/backend.php ensure-decisions-fixture
 *   E2E_MEMBER_TOTP=… php tests/e2e/support/backend.php ensure-two-factor-fixture
 *   php tests/e2e/support/backend.php ensure-approvals-fixture
 *   php tests/e2e/support/backend.php publish-announcement-fixture <info|warning>
 *   php tests/e2e/support/backend.php remove-announcement-fixture
 *   php tests/e2e/support/backend.php announcement-fixture-plan '<rows json>'   (pure: where publish-announcement-fixture would put its version)
 *   php tests/e2e/support/backend.php announcements-state
 *   php tests/e2e/support/backend.php ensure-reconsent-fixture
 *   php tests/e2e/support/backend.php remove-reconsent-fixture
 *   php tests/e2e/support/backend.php reconsent-fixture-plan '<rows json>'   (pure: what ensure-reconsent-fixture would make of these rows)
 *   php tests/e2e/support/backend.php legal-documents-state
 *   php tests/e2e/support/backend.php ensure-support-fixture
 *
 * Prints one JSON object. Refuses to run outside the local and testing environments.
 */

declare(strict_types=1);

use Illuminate\Http\Request;
use App\Actions\Admin\Members\EndViewAs;
use App\Actions\Admin\Members\LiftRestriction;
use App\Actions\Admin\Members\RestrictMember;
use App\Actions\Admin\Members\StartViewAs;
use App\Actions\Auth\DeleteUnverifiedAccount;
use App\Actions\Moderation\DecideCase;
use App\Enums\ApprovalStatus;
use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Enums\ContentEvent;
use App\Enums\DecisionAction;
use App\Enums\DecisionRestriction;
use App\Enums\GroundDocument;
use App\Enums\LegalDocumentKey;
use App\Enums\RestrictionType;
use App\Enums\StaffStatus;
use App\Enums\SupportCategory;
use App\Enums\SupportTicketSource;
use App\Enums\SupportTicketStatus;
use App\Enums\TicketAuthorType;
use App\Enums\UserStatus;
use App\Enums\VerificationPurpose;
use App\Enums\WhoCanMessage;
use App\Models\Appeal;
use App\Models\ApprovalRequest;
use App\Models\BrandAsset;
use App\Models\BuildUpdate;
use App\Models\CatalogRequest;
use App\Models\ConfigVersion;
use App\Models\DataExport;
use App\Models\Decision;
use App\Models\LegalDocument;
use App\Models\Media;
use App\Models\ModerationCase;
use App\Models\PersonalAccessToken;
use App\Models\QrCode;
use App\Models\QrScanDaily;
use App\Models\Staff;
use App\Models\SupportTicket;
use App\Models\TicketMessage;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VerificationCode;
use App\Services\AppConfig\AppConfig;
use App\Services\AppConfig\LegalDocuments;
use App\Services\Approvals\Approvals;
use App\Services\Auth\LoginThrottle;
use App\Services\Auth\TwoFactor;
use App\Services\Config\ConfigSchemas;
use App\Services\Config\ConfigVersions;
use App\Services\DataExport\BuildDataExport;
use App\Services\Home\HomeCuration;
use App\Services\Media\BlurMedia;
use App\Services\Moderation\DecisionInput;
use App\Services\Moderation\SendAppealOutcomeMail;
use App\Services\Moderation\SendDecisionMail;
use App\Services\Moderation\Statement;
use App\Services\Team\OwnerRules;
use App\Support\ClientAddress;
use App\Support\ViewAs;
use Carbon\CarbonImmutable;
use Database\Seeders\DemoSeeder;
use Illuminate\Bus\UniqueLock;
use Illuminate\Contracts\Bus\Dispatcher;
use Illuminate\Contracts\Cache\Repository as CacheRepository;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\Uid\Ulid;
use Laravel\Fortify\Fortify;
use Laravel\Fortify\RecoveryCode;
use Spatie\Health\Commands\RunHealthChecksCommand;

const E2E_DOMAIN = '@e2e.speedclub.test';
/** The addresses the server sees for a browser on this machine. */
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
/** Throttle names of the routes (with dashes) and the key prefix RateLimits gives them (with underscores). */
const AUTH_LIMITERS = [
    'member-register', 'member-login', 'member-verify', 'member-email', 'username-check',
    // Phase 2 per-address limits a run reaches from one machine: AUTH-11, WEB-05, WEB-09 and WEB-10 (m2.5/m2.6 handovers).
    'two-factor-challenge', 'web-account-deletion', 'reports', 'contact-form',
    // M4.6 Auth 2.0 per IP: F9 and F10 ask for several codes and passkey ceremonies a run (20 codes an hour per IP).
    'auth-email-start', 'auth-email-verify', 'auth-passkeys', 'auth-social',
];
/** Accounts the visual matrix photographs in the middle of onboarding (AUTH-08, AUTH-09). */
const ONBOARDING = [
    'username' => ['email' => 'onboarding.username'.E2E_DOMAIN, 'username' => null],
    'profile' => ['email' => 'onboarding.profile'.E2E_DOMAIN, 'username' => 'jonas.e30'],
];

/**
 * Staff fixtures of the admin tests (M3.1): one per role, plus the accounts some pages need. Created fresh by every run (ensure-staff)
 * with a password and TOTP secrets that only that run knows, and removed with what they made (delete-staff). Nothing else on the staff
 * table is ever touched: demo staff and real staff keep their rows, sessions and approvals.
 *   challenge        enrolled; its pending sign-in is the ADM-02 page (a password step without the code)
 *   enrol            not enrolled; signed in, EnsureStaffTwoFactor holds it at ADM-03
 *   signin-chromium  admins, enrolled; the UI sign-in and the password confirmation (ADR-215) of flows/a0-admin-shell.spec.ts, one
 *                    per browser project in a session of its own, so neither reuses the
 *   signin-webkit    other's code inside one TOTP step (Fortify refuses a code it has seen)
 *   a1-admin-*       flows/a1-restrict-member.spec.ts, one set per browser project, each in a session of its own (they confirm their
 *   a1-approver-*    password, ADR-215): the admin who restricts and lifts, the admin who approves the moderator's suspension on
 *   a1-moderator-*   ADM-43 (approvals.decide + members.suspend; no Owner needed, ADR-214), and the moderator who asks for it
 *   a2-moderator-*   flows/a2-report-handling.spec.ts, one set per browser project, each in a session of its own (they confirm their
 *   a2-appeals-*     password, ADR-215): the moderator who takes and decides the reported photo, the second moderator who decides the
 *   a2-messages-*    appeal against that decision (Art. 20(6) DSA: never the decider), and the moderator of the reported message (ADM-22)
 *   a3-brand-*       flows/a3-branding.spec.ts, per browser project: the content editor (brand.manage) who uploads, publishes and rolls
 *                    back the branding (its versions and uploads go with remove-branding-fixture, see removeFixtureBranding())
 *   a4-admin-*       flows/a4-role-assignment.spec.ts, per browser project: the admin who asks, the second admin who approves, and the
 *   a4-approver-*    support member whose roles change (support → Admin → support)
 *   a4-subject-*
 *   a4-owner         the Owner who asks to grant Owner (A4 refusals), shared by both projects
 *
 * Owners (ADR-237, at most speedclub.team.max_owners = 3, counted with the seeded `owner@speedclub.test`): only `owner` (the registry's
 * staff-owner: Owner-only pages ADM-39 count, ADM-52 edits, ADM-40 two-factor reset) and `a4-owner`. Every other kind is an admin where
 * an Owner is not needed. ensure-staff refuses a list or a database that would exceed the maximum, so ADM-39 never shows more.
 */
const STAFF_DOMAIN = '@staff.e2e.speedclub.test';
/** How many fixtures may be Owners: the maximum less the seeded Owner. */
const STAFF_FIXTURE_OWNERS = 2;
const STAFF_FIXTURES = [
    'owner' => ['role' => 'owner', 'name' => 'Lena Hoffmann', 'enrolled' => true],
    'admin' => ['role' => 'admin', 'name' => 'Jonas Weber', 'enrolled' => true],
    'moderator' => ['role' => 'moderator', 'name' => 'Mara Schulz', 'enrolled' => true],
    'support' => ['role' => 'support', 'name' => 'Timo Becker', 'enrolled' => true],
    'content-editor' => ['role' => 'content_editor', 'name' => 'Clara Wolf', 'enrolled' => true],
    'analyst' => ['role' => 'analyst', 'name' => 'Felix Braun', 'enrolled' => true],
    'challenge' => ['role' => 'analyst', 'name' => 'Nora Keller', 'enrolled' => true],
    'enrol' => ['role' => 'analyst', 'name' => 'Paul Richter', 'enrolled' => false],
    'signin-chromium' => ['role' => 'admin', 'name' => 'Eva Lorenz', 'enrolled' => true],
    'signin-webkit' => ['role' => 'admin', 'name' => 'Ben Krüger', 'enrolled' => true],
    'a1-admin-chromium' => ['role' => 'admin', 'name' => 'Lea Brandt', 'enrolled' => true],
    'a1-admin-webkit' => ['role' => 'admin', 'name' => 'Nils Hartmann', 'enrolled' => true],
    'a1-approver-chromium' => ['role' => 'admin', 'name' => 'Sophie Kraus', 'enrolled' => true],
    'a1-approver-webkit' => ['role' => 'admin', 'name' => 'David Vogel', 'enrolled' => true],
    'a1-moderator-chromium' => ['role' => 'moderator', 'name' => 'Julia Roth', 'enrolled' => true],
    'a1-moderator-webkit' => ['role' => 'moderator', 'name' => 'Erik Lang', 'enrolled' => true],
    'a2-moderator-chromium' => ['role' => 'moderator', 'name' => 'Miriam Falk', 'enrolled' => true],
    'a2-moderator-webkit' => ['role' => 'moderator', 'name' => 'Tobias Engel', 'enrolled' => true],
    'a2-appeals-chromium' => ['role' => 'moderator', 'name' => 'Hanna Seidel', 'enrolled' => true],
    'a2-appeals-webkit' => ['role' => 'moderator', 'name' => 'Lukas Brenner', 'enrolled' => true],
    'a2-messages-chromium' => ['role' => 'moderator', 'name' => 'Selin Aydin', 'enrolled' => true],
    'a2-messages-webkit' => ['role' => 'moderator', 'name' => 'Jakob Winter', 'enrolled' => true],
    'a3-brand-chromium' => ['role' => 'content_editor', 'name' => 'Marie Schubert', 'enrolled' => true],
    'a3-brand-webkit' => ['role' => 'content_editor', 'name' => 'Leon Fischer', 'enrolled' => true],
    'a4-admin-chromium' => ['role' => 'admin', 'name' => 'Katrin Albrecht', 'enrolled' => true],
    'a4-admin-webkit' => ['role' => 'admin', 'name' => 'Florian Wagner', 'enrolled' => true],
    'a4-approver-chromium' => ['role' => 'admin', 'name' => 'Anna Köhler', 'enrolled' => true],
    'a4-approver-webkit' => ['role' => 'admin', 'name' => 'Moritz Frank', 'enrolled' => true],
    'a4-subject-chromium' => ['role' => 'support', 'name' => 'Laura Pohl', 'enrolled' => true],
    'a4-subject-webkit' => ['role' => 'support', 'name' => 'Simon Böhm', 'enrolled' => true],
    'a4-owner' => ['role' => 'owner', 'name' => 'Greta Schmitt', 'enrolled' => true],
];

/**
 * The demo member the registry's view-as cells look at (VIEWAS-*, m3.2-contract §3): one no spec and no other cell signs in as or
 * opens, so the view (read only by contract) can never change a picture of another route. Only this member, only the owner fixture.
 */
const VIEW_AS_MEMBER = 'marco.amg';
const VIEW_AS_STAFF = 'owner';
/** SAFE-01-staff and SAFE-01-reversal (ensure-decisions-fixture): their decisions carry these fixed times, so the pictures stay put. */
/**
 * ADM-43 (DQ-528, ensure-approvals-fixture): the fixed instant the visual run's browser clock stands at (support/qa.mjs QA_NOW). The
 * requests' creation and decision times are fixed relative to it; a pending one expires on the server's real clock (it must stay
 * pending there), and the page counts down from the server's `expires_in`.
 */
const APPROVALS_QA_NOW = '2026-11-02T10:00:00Z';
const DECISION_FIXTURE_TIMES = [
    'original' => '2026-10-20 09:30:00',
    'reversal' => '2026-10-22 16:45:00',
    'staff' => '2026-10-27 11:10:00',
];

/**
 * Stage fixtures of the visual runner (support/stage-fixtures.mjs): things every viewer would see, so they exist only while the cells
 * that photograph them run (run.mjs takes those cells last, one fixture at a time) and are removed right after.
 *
 * HOME-01-announcement-info / -warning: one announcement each (fixed ids, so the testIDs and the pictures stay put), audience all,
 * dismissible, no schedule, as a published announcements version of its own above every version of the key, the staff draft included
 * (announcementFixturePlan()). Not through ConfigVersions::saveDraft()/publish(): the engine holds one draft per key, and the demo seed's
 * content editor has one (BrandContentDemoSeeder), which the fixture never takes over, edits or deletes. The payload goes through the
 * schema's normalize() like a publish; no audit event (a stage of the visual run, not a change of the product, like the premium fixture).
 */
const ANNOUNCEMENT_FIXTURES = [
    'info' => [
        'id' => '01m5c56300qvs6qrsknavmtw8e',
        'title' => ['de' => 'Neu: deine Support-Anfragen in der App', 'en' => 'New: your support requests in the app'],
        'body' => [
            'de' => 'Unter Einstellungen → Hilfe & FAQ siehst du jetzt alle deine Anfragen und die Antworten unseres Teams.',
            'en' => 'Under Settings → Help & FAQ you can now see all your requests and our team’s replies.',
        ],
        'cta' => ['label' => ['de' => 'Anfragen ansehen', 'en' => 'View requests'], 'url' => '/settings/help/requests'],
        'audience' => 'all',
        'dismissible' => true,
        'severity' => 'info',
    ],
    'warning' => [
        'id' => '01m5c57xk06gk22nnr2wrv5vjt',
        'title' => ['de' => 'Wartung am Sonntag, 15. November', 'en' => 'Maintenance on Sunday, 15 November'],
        'body' => [
            'de' => 'Von 2:00 bis 4:00 Uhr ist SPEED CLUB wegen Wartungsarbeiten nicht erreichbar.',
            'en' => 'From 2:00 to 4:00 am, SPEED CLUB is unavailable for maintenance.',
        ],
        'cta' => null,
        'audience' => 'all',
        'dismissible' => true,
        'severity' => 'warning',
    ],
];
const ANNOUNCEMENT_FIXTURE_REASON = 'QA-Fixture HOME-01-announcement (visual registry): wird nach der Aufnahme wieder entfernt';

/**
 * CONSENT: a re-consent version of AGB and of Datenschutz (DE and EN, the current text's body, a summary of the change) published at a
 * fixed time after the seeded version, and consent.fixture, who accepted the seeded version. Marked by RECONSENT_FIXTURE_REASON and
 * removed after the capture, so SET-17/18 and the Blade pages show the seeded texts again. Its version is the one above every version of
 * that document (both locales, drafts too): BrandContentDemoSeeder seeds a Datenschutz draft "2" (ADM-31), so with the seeded data the
 * fixture is AGB "2" and Datenschutz "3", and the draft stays as it is (reconsentFixturePlan()).
 */
const RECONSENT_FIXTURE_PUBLISHED_AT = '2026-11-01 08:00:00';
const RECONSENT_FIXTURE_REASON = 'QA-Fixture CONSENT (visual registry): wird nach der Aufnahme wieder entfernt';
const RECONSENT_FIXTURE_SUMMARIES = [
    'terms' => [
        'de' => 'Neu in §6: Du lädst nur Fotos hoch, an denen du die Rechte hast. Außerdem steht jetzt drin, was mit deinen QR-Stickern passiert, wenn du ein Fahrzeug löschst.',
        'en' => 'New in §6: you only upload photos you hold the rights to. We also explain what happens to your QR stickers when you delete a vehicle.',
    ],
    'privacy' => [
        'de' => 'Wir nennen jetzt jeden Dienstleister, der Daten für uns verarbeitet, mit Sitz und Zweck, und wie lange wir Support-Anfragen aufbewahren: 24 Monate.',
        'en' => 'We now name every service provider that processes data for us, with its location and purpose, and how long we keep support requests: 24 months.',
    ],
];

/**
 * SET-15a / SET-15b: support.fixture with two requests at fixed times and with fixed ids (the reference "SC-…" is the end of the id): an
 * open one about the e-mail change, and one about a QR sticker the team answered (waiting for the member). Removed with the account.
 */
const SUPPORT_FIXTURE_TICKETS = [
    [
        'id' => '01m69jjkc0t38tsy1y4e2vr6qz',
        'category' => 'account',
        'subject' => 'Code für die neue E-Mail-Adresse kommt nicht an',
        'status' => 'open',
        'created_at' => '2026-10-31 18:12:00',
        'messages' => [
            ['id' => '01m69jjr88j9yznx3wgzd4tv89', 'author' => 'member', 'at' => '2026-10-31 18:12:05',
                'body' => 'Ich will meine E-Mail-Adresse ändern, aber an die neue Adresse kommt kein Code. Den Spam-Ordner habe ich schon geprüft, und „Code erneut senden“ hat auch nichts gebracht.'],
        ],
    ],
    [
        'id' => '01m60y2yc0sqf4b7tm20wb940h',
        'category' => 'qr',
        'subject' => 'QR-Sticker zeigt noch mein altes Auto',
        'status' => 'pending',
        'created_at' => '2026-10-28 09:40:00',
        'messages' => [
            ['id' => '01m60y3388deqctpy0dvzppda8', 'author' => 'member', 'at' => '2026-10-28 09:40:05',
                'body' => 'Ich habe meinen Golf verkauft und den Sticker auf den Civic geklebt. Beim Scannen kommt aber immer noch die Seite vom Golf. Wie ziehe ich den Sticker auf den Civic um?'],
            ['id' => '01m63nb9v0mgjfwsbgym30h06v', 'author' => 'team', 'at' => '2026-10-29 11:05:00',
                'body' => "Hallo Jonas, ein Sticker gehört fest zu einem Fahrzeug, umziehen lässt er sich nicht. Deaktivier den Code beim Golf unter Garage → Golf → QR-Sticker und leg für den Civic einen neuen an.\n\nWer den alten Sticker scannt, sieht dann nur noch, dass der Code nicht mehr aktiv ist."],
        ],
    ],
];

$web = dirname(__DIR__, 3);
chdir($web);
require $web.'/vendor/autoload.php';
$app = require $web.'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

function finish(array $result, int $code = 0): never
{
    echo json_encode($result, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES), "\n";
    exit($code);
}

function refuse(string $message): never
{
    fwrite(STDERR, $message."\n");
    exit(2);
}

function staffFixtureEmail(string $label): string
{
    return 'e2e-'.$label.STAFF_DOMAIN;
}

/**
 * @return list<string>
 */
function staffFixtureEmails(): array
{
    return array_map(staffFixtureEmail(...), array_keys(STAFF_FIXTURES));
}

/**
 * Removes the approval requests a fixture asked for (with an executed export's file) and lets go of any it decided, so the staff row
 * can go (approval_requests restricts the delete) and no fixture's request waits in a real approver's queue (ADM-08, ADM-43).
 */
function releaseStaffApprovals(Staff $staff): int
{
    $disk = Storage::disk(config()->string('speedclub.media.private_disk'));
    $removed = 0;
    foreach (DB::table('approval_requests')->where('requested_by', $staff->getKey())->get(['id', 'result']) as $row) {
        $result = is_string($row->result) ? json_decode($row->result, true) : null;
        $file = is_array($result) ? ($result['file'] ?? null) : null;
        if (is_string($file) && $file !== '') {
            $disk->delete($file);
        }
        DB::table('approval_requests')->where('id', $row->id)->delete();
        $removed++;
    }
    DB::table('approval_requests')->where('decided_by', $staff->getKey())->update(['decided_by' => null]);

    return $removed;
}

/**
 * Removes one staff fixture (or a leftover of an earlier fixture list under STAFF_DOMAIN) with its approval requests, saved views and
 * the branding it made (removeFixtureBranding() runs first, while uploaded_by and created_by still name it). Audit events stay.
 */
function deleteStaffFixture(Staff $staff): int
{
    if (! str_ends_with($staff->email, STAFF_DOMAIN)) {
        return 0;
    }

    return DB::transaction(function () use ($staff): int {
        endFixtureViewAs($staff);
        $requests = releaseStaffApprovals($staff);
        DB::table('admin_saved_views')->where('staff_id', $staff->getKey())->delete();
        $staff->syncRoles([]);
        $staff->syncPermissions([]);
        $staff->delete();

        return $requests;
    });
}

/** Staff rows under STAFF_DOMAIN whose label is no longer in STAFF_FIXTURES (an earlier list, e.g. the M3.2 `a1-owner-*` Owners). */
function staleStaffFixtures(): Collection
{
    return Staff::query()->where('email', 'like', '%'.STAFF_DOMAIN)->whereNotIn('email', staffFixtureEmails())->get();
}

/** Every string anywhere in a decoded JSON value. @return list<string> */
function stringsIn(mixed $value): array
{
    if (is_string($value)) {
        return [$value];
    }

    return is_array($value) ? array_merge([], ...array_map(stringsIn(...), array_values($value))) : [];
}

/** The ids of every staff row under STAFF_DOMAIN. @return list<int> */
function staffFixtureIds(): array
{
    return Staff::query()->where('email', 'like', '%'.STAFF_DOMAIN)->pluck('id')->map(fn ($id): int => (int) $id)->all();
}

/** Where park-branding-draft keeps a staff member's branding draft while A3 runs: a key no ConfigKey reads. */
const PARKED_BRANDING_KEY = 'e2e-parked:branding';

/** The config keys whose seeded drafts (BrandContentDemoSeeder) the visual stage `draft-owner` lends to a fixture: ADM-28 and ADM-30. */
const LENT_DRAFT_KEYS = [ConfigKey::Branding, ConfigKey::Announcements];

/** One config_versions row with all its columns and its hash (the before/after proof of a fixture that only moves it). */
function rowState(object $row): array
{
    return ['id' => (int) $row->id, 'version' => (int) $row->version, 'sha256' => hash('sha256', json_encode((array) $row, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE))];
}

/**
 * Gives every draft that a staff fixture holds but did not start back to the staff member who started it: the first config.draft_saved
 * event of the row names its creator (the audit log is append-only, so this survives an aborted run and a cleared cache). Only the
 * created_by column changes (the query builder writes no updated_at), so the row is again what it was before lend-seeded-drafts. Runs
 * before anything removes fixture branding or fixtures: those delete what a fixture created, and staff deletes null created_by.
 */
function restoreSeededDraftOwners(): int
{
    $fixtureIds = staffFixtureIds();
    if ($fixtureIds === []) {
        return 0;
    }
    $morph = (new ConfigVersion)->getMorphClass();
    $restored = 0;
    foreach (DB::table('config_versions')->where('status', ConfigVersionStatus::Draft->value)->whereIn('created_by', $fixtureIds)->get(['id']) as $row) {
        $first = DB::table('audit_events')->where('action', ContentEvent::ConfigDraftSaved->value)
            ->where('target_type', $morph)->where('target_id', (string) $row->id)->orderBy('id')->first(['actor_type', 'actor_id']);
        if ($first === null || $first->actor_type !== 'staff' || in_array((int) $first->actor_id, $fixtureIds, true)) {
            continue;
        }
        if (! Staff::query()->whereKey((int) $first->actor_id)->exists()) {
            continue;
        }
        DB::table('config_versions')->where('id', $row->id)->update(['created_by' => (int) $first->actor_id]);
        $restored++;
    }

    return $restored;
}

/**
 * Puts a staff member's branding draft back under its key after A3 (park-branding-draft moved it aside), once the fixture's versions
 * are gone. Only the key column changes back. Refused when the key has a draft again (the engine allows one per key).
 */
function unparkBrandingDraft(): ?int
{
    $parked = DB::table('config_versions')->where('key', PARKED_BRANDING_KEY)->first();
    if ($parked === null) {
        return null;
    }
    $taken = DB::table('config_versions')->where('key', ConfigKey::Branding->value)
        ->where(fn ($q) => $q->where('status', ConfigVersionStatus::Draft->value)->orWhere('version', $parked->version))->exists();
    if ($taken) {
        refuse('refusing: branding has a draft or a v'.$parked->version.' again; the parked draft (id '.$parked->id.') stays under '.PARKED_BRANDING_KEY);
    }
    DB::table('config_versions')->where('id', $parked->id)->update(['key' => ConfigKey::Branding->value]);

    return (int) $parked->version;
}

/**
 * The branding a staff fixture made (flows/a3-branding.spec.ts), so ADM-28, ADM-34 and ADM-35 look the same before and after a run,
 * like removeAnnouncementFixture(): every `branding` version (draft, published, rollback copy) a fixture created or published goes;
 * when no published version is left, the newest remaining one (the version that was live before the run, since numbers only grow) is
 * live again, without a rollback copy. Then the brand images a fixture uploaded go, but only those no remaining version names (a real
 * version that uses one keeps it), and their files only where no remaining asset shares them (file names carry the content hash, so
 * the same photo uploaded twice shares its files). App-config is flushed. Brand assets have no delete path in the product (ADR-236 d:
 * versions point at them); this is test data, removed only after the versions that named it.
 *
 * @return array{versions: int, restored: int|null, assets: int, files: int}
 */
function removeFixtureBranding(): array
{
    // A seeded draft a visual stage lent to a fixture is the seeder's again before anything a fixture created goes.
    $owners = restoreSeededDraftOwners();
    $fixtureIds = staffFixtureIds();
    if ($fixtureIds === []) {
        return ['versions' => 0, 'restored' => null, 'assets' => 0, 'files' => 0, 'owners' => $owners, 'unparked' => unparkBrandingDraft()];
    }

    $result = DB::transaction(function () use ($fixtureIds): array {
        $rows = ConfigVersion::query()->where('key', ConfigKey::Branding->value)->orderBy('version')->lockForUpdate()->get();
        $fixtures = $rows->filter(fn (ConfigVersion $row): bool => in_array((int) $row->created_by, $fixtureIds, true)
            || in_array((int) $row->published_by, $fixtureIds, true));
        foreach ($fixtures as $row) {
            $row->delete();
        }
        $left = $rows->diff($fixtures);
        $restored = null;
        if ($fixtures->isNotEmpty() && ! $left->contains(fn (ConfigVersion $row): bool => $row->status === ConfigVersionStatus::Published)) {
            $base = $left->filter(fn (ConfigVersion $row): bool => $row->status === ConfigVersionStatus::Superseded)->sortByDesc('version')->first();
            if ($base instanceof ConfigVersion) {
                $base->forceFill(['status' => ConfigVersionStatus::Published])->save();
                $restored = $base->version;
            }
        }

        $named = ConfigVersion::query()->where('key', ConfigKey::Branding->value)->get()
            ->flatMap(fn (ConfigVersion $row): array => stringsIn($row->payload))->unique()->all();
        $assets = BrandAsset::query()->whereIn('uploaded_by', $fixtureIds)->get()
            ->reject(fn (BrandAsset $asset): bool => in_array((string) $asset->id, $named, true));
        $files = [];
        foreach ($assets as $asset) {
            $files[] = ['private', (string) $asset->getRawOriginal('original_path')];
            foreach ((array) $asset->variants as $path) {
                $files[] = ['public', (string) $path];
            }
            foreach (['png_path', 'og_path'] as $column) {
                $files[] = ['public', (string) $asset->getRawOriginal($column)];
            }
            $asset->delete();
        }

        return ['versions' => $fixtures->count(), 'restored' => $restored, 'assets' => $assets->count(), 'files' => $files];
    });

    // Files after the commit, and only those no remaining asset uses.
    $kept = BrandAsset::query()->get()->flatMap(fn (BrandAsset $asset): array => [
        (string) $asset->getRawOriginal('original_path'), ...array_map(strval(...), array_values((array) $asset->variants)),
        (string) $asset->getRawOriginal('png_path'), (string) $asset->getRawOriginal('og_path'),
    ])->filter()->unique()->all();
    $removed = 0;
    foreach ($result['files'] as [$which, $path]) {
        if ($path === '' || in_array($path, $kept, true)) {
            continue;
        }
        $disk = Storage::disk(config()->string($which === 'private' ? 'speedclub.brand.private_disk' : 'speedclub.brand.public_disk'));
        if ($disk->exists($path)) {
            $disk->delete($path);
            $removed++;
        }
    }
    app(AppConfig::class)->flush();

    return [...$result, 'files' => $removed, 'owners' => $owners, 'unparked' => unparkBrandingDraft()];
}

/** Where the live branding stands, for flows/a3-branding.spec.ts: the live version and a draft that is not a fixture's. */
function brandingState(): array
{
    $fixtureIds = Staff::query()->where('email', 'like', '%'.STAFF_DOMAIN)->pluck('id')->map(fn ($id): int => (int) $id)->all();
    $rows = ConfigVersion::query()->where('key', ConfigKey::Branding->value)->orderBy('version')->get();
    $live = $rows->first(fn (ConfigVersion $row): bool => $row->status === ConfigVersionStatus::Published);
    $draft = $rows->first(fn (ConfigVersion $row): bool => $row->status === ConfigVersionStatus::Draft);

    $staffDraft = DB::table('config_versions')->whereIn('key', [ConfigKey::Branding->value, PARKED_BRANDING_KEY])
        ->where('status', ConfigVersionStatus::Draft->value)->where(fn ($q) => $q->whereNull('created_by')->orWhereNotIn('created_by', $fixtureIds === [] ? [0] : $fixtureIds))
        ->first();

    return [
        'live' => $live?->version,
        'versions' => $rows->filter(fn (ConfigVersion $row): bool => $row->status !== ConfigVersionStatus::Draft)->pluck('version')->all(),
        'foreign_draft' => $draft !== null && ! in_array((int) $draft->created_by, $fixtureIds, true) ? $draft->version : null,
        // A staff member's draft wherever it stands (under the key, or parked by A3), all columns hashed, and whether it is parked.
        'staff_draft' => $staffDraft === null ? null : [...rowState($staffDraft), 'parked' => $staffDraft->key === PARKED_BRANDING_KEY],
    ];
}

/** ADM-48 (stage fixture `health-run`): the cache key that lists the batches of health results the fixture made. */
const HEALTH_FIXTURE_MARK = 'e2e.health-fixture';

/**
 * ADM-48: one run of the health checks, as the scheduler makes every five minutes on a host. A local demo has no cron, so on a fresh seed
 * the page is its empty state, and its default cells would show the same picture as the empty one (visual run 3). The run is the
 * command the scheduler calls, without notifications and without an audit row; its batches are marked, and only those are removed.
 *
 * @return array<string, mixed>
 */
function healthFixture(bool $on): array
{
    $cache = app(CacheRepository::class);
    /** @var list<string> $marked */
    $marked = (array) $cache->get(HEALTH_FIXTURE_MARK, []);
    if ($on) {
        $before = (int) (DB::table('health_check_result_history_items')->max('id') ?? 0);
        Artisan::call(RunHealthChecksCommand::class, ['--no-notification' => true]);
        $batches = DB::table('health_check_result_history_items')->where('id', '>', $before)->distinct()->pluck('batch')->map(fn (mixed $b): string => (string) $b)->all();
        if ($batches === []) {
            refuse('refusing: the health checks stored no results');
        }
        $cache->forever(HEALTH_FIXTURE_MARK, array_values(array_unique([...$marked, ...$batches])));

        return ['batches' => $batches, 'results' => DB::table('health_check_result_history_items')->whereIn('batch', $batches)->count()];
    }
    $removed = $marked === [] ? 0 : DB::table('health_check_result_history_items')->whereIn('batch', $marked)->delete();
    $cache->forget(HEALTH_FIXTURE_MARK);

    return ['removed' => $removed];
}

/** ADM-F1/F2 (stage fixture `premium`): the cache key that says the fixture, not a person, switched premium.enabled on. */
const PREMIUM_FIXTURE_MARK = 'e2e.premium-fixture';

/**
 * Switches premium.enabled on for the memberships cells, or off again. Only the `enabled` column changes (updated_at and rules stay, so
 * ADM-36 shows the same row before and after a run), and only when the fixture switched it on: a flag a person switched on is refused
 * by the setup and never switched off by the removal. No flag.changed audit event: this is a stage of the visual run, not a change of
 * the product, like the stage fixtures above. App-config is flushed both ways.
 */
function premiumFixture(bool $on): array
{
    $flag = DB::table('feature_flags')->where('key', 'premium.enabled')->first(['id', 'enabled']);
    if ($flag === null) {
        refuse('refusing: there is no premium.enabled flag; run the FeatureFlagSeeder');
    }
    $cache = app(CacheRepository::class);
    $marked = $cache->get(PREMIUM_FIXTURE_MARK) === true;
    if ($on) {
        if ((bool) $flag->enabled && ! $marked) {
            refuse('refusing: premium.enabled is on, and not by this fixture; it never changes a real setting');
        }
        DB::table('feature_flags')->where('id', $flag->id)->update(['enabled' => true]);
        $cache->forever(PREMIUM_FIXTURE_MARK, true);
    } elseif ($marked) {
        DB::table('feature_flags')->where('id', $flag->id)->update(['enabled' => false]);
        $cache->forget(PREMIUM_FIXTURE_MARK);
    }
    app(AppConfig::class)->flush();

    return ['enabled' => (bool) DB::table('feature_flags')->where('id', $flag->id)->value('enabled'), 'by_fixture' => $on || $marked];
}

/** M4.14 (stage fixture `m414-flags`, F13): the cache key that says the fixture, not a person, switched the two flags on. */
const M414_FIXTURE_MARK = 'e2e.m414-flags-fixture';
/** The flags of M4.14, off everywhere until its design QA passed (ADR-455), on only while the matrix captures or F13 runs. */
const M414_FLAGS = ['parts_catalogue', 'businesses'];

/**
 * Switches parts_catalogue and businesses on for the M4.14 cells and F13, or off again, like premiumFixture: only the `enabled` column,
 * only flags this fixture switched on (a flag a person switched on is refused and never switched off), app-config flushed both ways.
 */
function m414FlagsFixture(bool $on): array
{
    $flags = DB::table('feature_flags')->whereIn('key', M414_FLAGS)->get(['id', 'key', 'enabled']);
    if ($flags->count() !== count(M414_FLAGS)) {
        refuse('refusing: parts_catalogue or businesses is missing; run the FeatureFlagSeeder');
    }
    $cache = app(CacheRepository::class);
    $marked = $cache->get(M414_FIXTURE_MARK) === true;
    if ($on) {
        if (! $marked && $flags->contains(fn (object $flag): bool => (bool) $flag->enabled)) {
            refuse('refusing: a M4.14 flag is on, and not by this fixture; it never changes a real setting');
        }
        DB::table('feature_flags')->whereIn('key', M414_FLAGS)->update(['enabled' => true]);
        $cache->forever(M414_FIXTURE_MARK, true);
    } elseif ($marked) {
        DB::table('feature_flags')->whereIn('key', M414_FLAGS)->update(['enabled' => false]);
        $cache->forget(M414_FIXTURE_MARK);
    }
    app(AppConfig::class)->flush();
    $business = $on ? m414BusinessFixture() : removeM414BusinessFixture();

    return [
        'flags' => DB::table('feature_flags')->whereIn('key', M414_FLAGS)->pluck('enabled', 'key')->map(fn (mixed $enabled): bool => (bool) $enabled)->all(),
        'by_fixture' => $on || $marked,
        'business' => $business,
    ];
}

/** The fixed ids of the M4.14 stage business: the prefix makes sure the removal only ever deletes these rows. */
const M414_BUSINESS_ID = '01m414fx000000000000000001';
const M414_PREFIX = '01m414fx';

/**
 * BIZ-03 / BIZ-04 / BIZ-01 with data (stage fixture `m414-flags`): lukas.sc owns the verified "Werkstatt am Kanal" (test data, the
 * Impressum says so) with kenji.r34 as staff, one confirmed build of jann.ptrs in the portfolio, one request of max.e46 waiting for
 * the business, one proposal of the business waiting for nina.neu, and 30 days of profile views. Rows with fixed ids only; a member
 * who already belongs to a business is left alone (refused), so a real business is never touched.
 */
function m414BusinessFixture(): array
{
    removeM414BusinessFixture();
    $users = DB::table('users')->whereIn('username', ['lukas.sc', 'kenji.r34', 'jann.ptrs', 'max.e46', 'nina.neu'])->pluck('id', 'username');
    if ($users->count() !== 5) {
        refuse('refusing: the demo members are missing; run the DemoSeeder');
    }
    if (DB::table('business_members')->whereIn('user_id', [$users['lukas.sc'], $users['kenji.r34']])->exists()) {
        refuse('refusing: lukas.sc or kenji.r34 already belongs to a business');
    }
    $publicMod = fn (string $username): ?string => DB::table('modifications as m')
        ->join('vehicles as v', 'v.id', '=', 'm.vehicle_id')
        ->where('v.owner_id', $users[$username])->where('v.status', 'published')->where('v.visibility', 'public')
        ->whereNull('v.deleted_at')->whereNull('m.deleted_at')->whereNull('m.installed_by_business_id')
        ->whereNotExists(fn ($tags) => $tags->selectRaw('1')->from('mod_business_tags as t')->whereColumn('t.mod_id', 'm.id'))
        ->orderBy('m.created_at')->value('m.id');
    $cover = DB::table('businesses')->where('slug', 'beispiel-werkstatt-nord')->value('cover_media_id');
    $now = now();
    DB::table('businesses')->insert([
        'id' => M414_BUSINESS_ID,
        'owner_id' => $users['lukas.sc'],
        'slug' => 'werkstatt-am-kanal-m414',
        'name' => 'Werkstatt am Kanal',
        'kind' => 'workshop',
        'legal_name' => 'Werkstatt am Kanal GmbH (Testdaten)',
        'legal_form' => 'gmbh',
        'representative' => 'Lukas Scholz (Testdaten)',
        'street' => 'Kanalstraße 12',
        'postcode' => '22085',
        'city' => 'Hamburg',
        'country' => 'DE',
        'lat' => 53.5725,
        'lng' => 10.0237,
        'phone' => '+49 40 0000000',
        'email' => 'werkstatt-am-kanal@speedclub.test',
        'website' => null,
        'register_court' => 'Amtsgericht Hamburg',
        'register_number' => 'HRB 000000 (Testdaten)',
        'vat_id' => null,
        'about' => 'Fahrwerk, Abgasanlage und Achsvermessung für Japaner und Youngtimer. Eigene Bühne, Termine nach Absprache.',
        'services' => json_encode(['Fahrwerk', 'Abgasanlage', 'Achsvermessung', 'Bremsen', 'Einzelabnahme']),
        'opening_hours' => json_encode(['mon' => [['08:00', '17:30']], 'tue' => [['08:00', '17:30']], 'wed' => [['08:00', '12:00'], ['13:00', '17:30']], 'thu' => [['08:00', '17:30']], 'fri' => [['08:00', '15:00']], 'sat' => [['10:00', '13:00']]]),
        'logo_media_id' => null,
        'cover_media_id' => $cover,
        'document_note' => 'Gewerbeanmeldung und Handelsregisterauszug liegen vor.',
        'status' => 'verified',
        'submitted_at' => $now->copy()->subDays(20),
        'reviewed_at' => $now->copy()->subDays(18),
        'verified_at' => $now->copy()->subDays(18),
        'is_sample' => false,
        'created_at' => $now->copy()->subDays(20),
        'updated_at' => $now,
    ]);
    DB::table('business_members')->insert([
        ['id' => M414_PREFIX.'000000000000000m01', 'business_id' => M414_BUSINESS_ID, 'user_id' => $users['lukas.sc'], 'role' => 'owner', 'created_at' => $now, 'updated_at' => $now],
        ['id' => M414_PREFIX.'000000000000000m02', 'business_id' => M414_BUSINESS_ID, 'user_id' => $users['kenji.r34'], 'role' => 'staff', 'created_at' => $now, 'updated_at' => $now],
    ]);
    $tags = [];
    foreach ([['jann.ptrs', 'accepted', 'member', 't01'], ['max.e46', 'pending', 'member', 't02'], ['nina.neu', 'pending', 'business', 't03']] as [$member, $status, $by, $suffix]) {
        $mod = $publicMod($member);
        if ($mod === null) {
            continue;
        }
        DB::table('mod_business_tags')->insert([
            'id' => M414_PREFIX.'000000000000000'.$suffix,
            'mod_id' => $mod,
            'business_id' => M414_BUSINESS_ID,
            'status' => $status,
            'initiated_by' => $by,
            'requested_by' => $by === 'member' ? $users[$member] : $users['lukas.sc'],
            'decided_by' => $status === 'accepted' ? $users['lukas.sc'] : null,
            'decided_at' => $status === 'accepted' ? $now->copy()->subDays(3) : null,
            'created_at' => $now->copy()->subDays($status === 'accepted' ? 5 : 1),
            'updated_at' => $now,
        ]);
        if ($status === 'accepted') {
            DB::table('modifications')->where('id', $mod)->update(['installed_by_business_id' => M414_BUSINESS_ID]);
        }
        $tags[] = $status;
    }
    $views = [];
    for ($day = 1; $day <= 30; $day++) {
        $views[] = ['business_id' => M414_BUSINESS_ID, 'day' => $now->copy()->subDays($day)->toDateString(), 'views' => 3 + ($day * 7) % 11];
    }
    DB::table('business_view_days')->insert($views);

    return ['id' => M414_BUSINESS_ID, 'tags' => $tags];
}

/** Removes the stage business and everything hanging on it (its tags, team, view days, the mods' installed_by). */
function removeM414BusinessFixture(): array
{
    $mods = DB::table('modifications')->where('installed_by_business_id', M414_BUSINESS_ID)->update(['installed_by_business_id' => null]);
    $tags = DB::table('mod_business_tags')->where('business_id', M414_BUSINESS_ID)->where('id', 'like', M414_PREFIX.'%')->delete();
    DB::table('mod_business_tags')->where('business_id', M414_BUSINESS_ID)->delete();
    DB::table('business_members')->where('business_id', M414_BUSINESS_ID)->delete();
    DB::table('business_view_days')->where('business_id', M414_BUSINESS_ID)->delete();
    $business = DB::table('businesses')->where('id', M414_BUSINESS_ID)->delete();

    return ['removed' => $business, 'tags' => $tags, 'mods' => $mods];
}

/**
 * SEC-P1-53: the GET /sanctum/csrf-cookie limit of the loopback clients (LimitCsrfCookieRequests keys it 'csrf-cookie:' plus
 * ClientAddress::key(), so ::1 counts as "::/64"). Every browser context of a run is a new client without a cookie, and all of them
 * come from this one address: a full run asks more than 30 times a minute, which no single client does. Only this limiter: clearing
 * the auth limiters too would undo a limit a running test provokes on purpose.
 */
function clearCsrfCookieLimit(): int
{
    $keys = [];
    foreach (LOOPBACK as $ip) {
        $keys[] = 'csrf-cookie:'.ClientAddress::key(Request::create('/', 'GET', server: ['REMOTE_ADDR' => $ip]));
    }
    $keys = array_values(array_unique($keys));
    foreach ($keys as $key) {
        RateLimiter::clear($key);
    }

    return count($keys);
}

function isTestAccount(string $email): bool
{
    return str_ends_with(mb_strtolower($email), E2E_DOMAIN);
}

/**
 * Ends every view-as a staff fixture holds (the registry's VIEWAS-* cells start one), through EndViewAs, so it is audited like an end
 * in the admin. Called before a fixture goes or is reset; a view-as also ends by itself after 30 minutes.
 */
function endFixtureViewAs(Staff $staff): int
{
    $members = PersonalAccessToken::query()
        ->where('name', ViewAs::NAME_PREFIX.$staff->getKey())
        ->where('tokenable_type', (new User)->getMorphClass())
        ->distinct()
        ->pluck('tokenable_id');
    $ended = 0;
    foreach (User::withTrashed()->whereIn('id', $members)->get() as $member) {
        $ended += app(EndViewAs::class)->byStaff($staff, $member);
    }

    return $ended;
}

/**
 * The queued jobs of one test account that the worker would run (it does not run locally): plate blur (BlurMedia), data export
 * (BuildDataExport, one job per step), the statement-of-reasons mail of a decision about it (SendDecisionMail) and the outcome mail of
 * an appeal it filed (SendAppealOutcomeMail), in order, until none is left. Every other job (a demo member's, another test's) stays
 * in the queue untouched. `$only` (a class basename) runs that kind alone, so a spec can read each of two mails before the next one
 * replaces it as the newest in the local mailbox.
 *
 * @return list<string>
 */
function runQueuedJobsOf(User $user, ?string $only = null): array
{
    $ran = [];
    for ($round = 0; $round < 40; $round++) {
        $next = null;
        foreach (DB::table('jobs')->orderBy('id')->get(['id', 'payload']) as $row) {
            $payload = json_decode((string) $row->payload, true);
            $command = is_array($payload) ? ($payload['data']['command'] ?? null) : null;
            if (! is_string($command) || (! str_contains($command, 'BlurMedia') && ! str_contains($command, 'BuildDataExport') && ! str_contains($command, 'SendDecisionMail') && ! str_contains($command, 'SendAppealOutcomeMail'))) {
                continue;
            }
            $job = unserialize($command);
            if ($only !== null && class_basename($job) !== $only) {
                continue;
            }
            $owner = match (true) {
                $job instanceof BlurMedia => Media::query()->find($job->mediaId)?->owner_id,
                $job instanceof BuildDataExport => DataExport::query()->find($job->exportId)?->user_id,
                $job instanceof SendDecisionMail => Decision::query()->find($job->decisionId)?->subject_id,
                $job instanceof SendAppealOutcomeMail => Appeal::query()->find($job->appealId)?->appellant_id,
                default => null,
            };
            if ($owner !== null && (string) $owner === (string) $user->getKey()) {
                $next = [$row->id, $job];
                break;
            }
        }
        if ($next === null) {
            break;
        }
        [$rowId, $job] = $next;
        DB::table('jobs')->where('id', $rowId)->delete();
        app(Dispatcher::class)->dispatchNow($job);
        // A worker releases the lock of a unique job once it is done, so the next dispatch of the same id is accepted.
        if ($job instanceof ShouldBeUnique) {
            (new UniqueLock(app(CacheRepository::class)))->release($job);
        }
        $ran[] = class_basename($job);
    }

    return $ran;
}

/**
 * A fixture member under E2E_DOMAIN with the demo password (signed in like a demo member, support/auth.mjs sessionOf), onboarding
 * done, every earlier session and token of it ended.
 */
/**
 * Runs $make with ULIDs whose last 8 characters are fixed (DQ-689). Admin pages print a case's number as those 8 characters
 * (CaseRecord `reference`), so a fixture made through the real Actions keeps its numbers from run to run. The first 18 characters
 * stay a normal ULID (time and randomness), so every id is still unique, also beside the rows of an earlier make.
 *
 * @template T
 *
 * @param  Closure(): T  $make
 * @return T
 */
function withFixedUlidTails(string $salt, Closure $make): mixed
{
    $n = 0;
    Str::createUlidsUsing(function () use (&$n, $salt): Ulid {
        $n++;
        $alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
        $hash = hash('sha256', $salt.':'.$n, true);
        $tail = '';
        for ($i = 0; $i < 8; $i++) {
            $tail .= $alphabet[ord($hash[$i]) % 32];
        }

        return Ulid::fromString(substr((string) new Ulid, 0, 18).$tail);
    });

    try {
        return $make();
    } finally {
        Str::createUlidsNormally();
    }
}

function fixtureMember(string $email, string $username, string $displayName, string $city): User
{
    $password = config('speedclub.demo.member_password');
    if (! is_string($password) || $password === '') {
        refuse('DEMO_MEMBER_PASSWORD is not set in web/.env');
    }
    $user = User::withTrashed()->where('email', $email)->first()
        ?? new User(['email' => $email, 'password' => $password, 'locale' => 'de', 'consented_at' => now()]);
    $user->fill(['username' => $username, 'display_name' => $displayName, 'city' => $city]);
    $user->forceFill(['password' => $password, 'email_verified_at' => now(), 'profile_setup_at' => now(), 'deleted_at' => null])->save();
    $user->tokens()->delete();
    if (Schema::hasTable('sessions')) {
        DB::table('sessions')->where('user_id', $user->getKey())->delete();
    }

    return $user;
}

/**
 * A seeded staff account (never a fixture of this file) with every given atom: the one whose email starts with $preferred first, else the
 * first that has them all.
 *
 * @param  list<string>  $atoms
 */
function seededStaffWith(array $atoms, string $preferred): Staff
{
    $can = fn (Staff $staff): bool => collect($atoms)->every(fn (string $atom): bool => $staff->hasPermissionTo($atom, 'staff'));
    $seeded = Staff::query()->where('email', 'not like', '%'.STAFF_DOMAIN)->orderBy('id')->get();

    return $seeded->first(fn (Staff $staff): bool => $staff->email === $preferred.'@'.DemoSeeder::EMAIL_DOMAIN && $can($staff))
        ?? $seeded->first($can)
        ?? refuse('no seeded staff account with '.implode(' and ', $atoms).': run the StaffSeeder');
}

/** Whether a config_versions payload holds an announcement of ANNOUNCEMENT_FIXTURES. */
function isAnnouncementFixture(mixed $payload): bool
{
    $ids = array_column(ANNOUNCEMENT_FIXTURES, 'id');
    $items = is_array($payload) && is_array($payload['items'] ?? null) ? $payload['items'] : [];

    return collect($items)->contains(fn ($item): bool => is_array($item) && in_array($item['id'] ?? null, $ids, true));
}

/**
 * Where publish-announcement-fixture puts its version, without touching anything (also the self-test's entry, `announcement-fixture-plan`):
 * one above the highest version of the key (drafts included, so the staff draft keeps its number and stays the draft), with the live
 * version, if any, superseded for as long as the fixture stands. Rows of an earlier fixture do not count (they are removed first).
 * Refuses when more than one version is published (the engine's invariant is broken; the fixture would not know which to restore).
 *
 * @param  list<array{version: int, status: string, fixture?: bool}>  $rows
 * @return array{version: int, supersede: int|null}|string  the plan, or the reason to refuse
 */
function announcementFixturePlan(array $rows): array|string
{
    $own = array_values(array_filter($rows, fn (array $row): bool => ($row['fixture'] ?? false) !== true));
    $published = array_values(array_filter($own, fn (array $row): bool => $row['status'] === ConfigVersionStatus::Published->value));
    if (count($published) > 1) {
        return 'refusing: announcements has '.count($published).' published versions ('.implode(', ', array_map(fn (array $row): string => 'v'.$row['version'], $published)).'); the engine allows one';
    }
    $highest = array_reduce($own, fn (int $carry, array $row): int => max($carry, (int) $row['version']), 0);

    return ['version' => $highest + 1, 'supersede' => $published === [] ? null : (int) $published[0]['version']];
}

/** Every config_versions row of the announcements key with all its columns, in id order, and their hash (the fixture's before/after proof). */
function announcementsState(): array
{
    $rows = DB::table('config_versions')->where('key', ConfigKey::Announcements->value)->orderBy('id')->get()->map(fn (object $row): array => (array) $row)->all();

    return ['count' => count($rows), 'sha256' => hash('sha256', json_encode($rows, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE))];
}

/** App-config and the Start curation forget what they cached, as ConfigVersions does after a publish. */
function flushPublishedConfig(): void
{
    app(AppConfig::class)->flush();
    app(HomeCuration::class)->forget();
}

/**
 * Removes every announcements version (and draft) that holds a fixture announcement. When the removed one was live and nothing else went
 * live since, the version it replaced (its base_version) is live again, exactly as before the fixture: only its status column changes
 * back (no rollback copy, no new updated_at), so the rows of the key are, column for column, what they were before (announcementsState),
 * and the history of ADM-35 is the same before and after a run. App-config is flushed.
 *
 * @return array{removed: int, restored: int|null}
 */
function removeAnnouncementFixture(): array
{
    $result = DB::transaction(function (): array {
        $rows = ConfigVersion::query()->where('key', ConfigKey::Announcements->value)->orderBy('version')->lockForUpdate()->get();
        $fixtures = $rows->filter(fn (ConfigVersion $row): bool => isAnnouncementFixture($row->payload));
        $wasLive = $fixtures->first(fn (ConfigVersion $row): bool => $row->status === ConfigVersionStatus::Published);
        foreach ($fixtures as $row) {
            $row->delete();
        }
        $restored = null;
        $liveLeft = $rows->diff($fixtures)->contains(fn (ConfigVersion $row): bool => $row->status === ConfigVersionStatus::Published);
        if ($wasLive instanceof ConfigVersion && ! $liveLeft && $wasLive->base_version !== null) {
            $base = $rows->diff($fixtures)->first(fn (ConfigVersion $row): bool => $row->version === $wasLive->base_version && $row->status === ConfigVersionStatus::Superseded);
            if ($base instanceof ConfigVersion) {
                DB::table('config_versions')->where('id', $base->getKey())->update(['status' => ConfigVersionStatus::Published->value]);
                $restored = $base->version;
            }
        }

        return ['removed' => $fixtures->count(), 'restored' => $restored];
    });
    flushPublishedConfig();

    return $result;
}

/** Removes the re-consent fixture's legal versions (by their reason) and flushes app-config. */
function removeReconsentFixture(): int
{
    $removed = LegalDocument::query()->where('reason', RECONSENT_FIXTURE_REASON)->whereNull('created_by')->delete();
    app(AppConfig::class)->flush();

    return (int) $removed;
}

/**
 * What ensure-reconsent-fixture makes of the legal_documents rows of AGB and Datenschutz, without touching anything (also the self-test's
 * entry, `reconsent-fixture-plan`). Per document key: the fixture's version is one above the highest version of that key in any locale,
 * drafts included, so it never meets a real row's (key, locale, version) and never replaces a draft; the version the fixture member
 * accepted is the current published one in the binding locale. Refuses when a key has no published text in a locale, when a published
 * text is dated at or after the fixture (the fixture would not be the current text), or when a version is not a whole number (there is
 * no "above" it).
 *
 * @param  list<array{key: string, locale: string, version: string, published_at: string|null, reason?: string|null}>  $rows
 * @param  list<string>  $keys
 * @param  list<string>  $locales  the binding locale first
 * @return array{versions: array<string, string>, accepted: array<string, string>}|string  the plan, or the reason to refuse
 */
function reconsentFixturePlan(array $rows, array $keys, array $locales, CarbonImmutable $at): array|string
{
    $versions = [];
    $accepted = [];
    foreach ($keys as $key) {
        $own = array_values(array_filter($rows, fn (array $row): bool => $row['key'] === $key && ($row['reason'] ?? null) !== RECONSENT_FIXTURE_REASON));
        $highest = 0;
        foreach ($own as $row) {
            if (preg_match('/^[1-9][0-9]{0,8}$/', $row['version']) !== 1) {
                return "refusing: {$key} ({$row['locale']}) has the version \"{$row['version']}\", not a whole number, so the fixture has no version above it";
            }
            $highest = max($highest, (int) $row['version']);
        }
        foreach ($locales as $locale) {
            $published = array_values(array_filter($own, fn (array $row): bool => $row['locale'] === $locale && $row['published_at'] !== null));
            if ($published === []) {
                return "refusing: no published {$key} ({$locale}): run the seeders";
            }
            usort($published, fn (array $a, array $b): int => strcmp((string) $b['published_at'], (string) $a['published_at']));
            if (CarbonImmutable::parse((string) $published[0]['published_at'], 'UTC')->greaterThanOrEqualTo($at)) {
                return "refusing: {$key} ({$locale}) has a version published at or after the fixture's time; the fixture would not be the current text";
            }
            $accepted[$key] ??= $published[0]['version'];
        }
        $versions[$key] = (string) ($highest + 1);
    }

    return ['versions' => $versions, 'accepted' => $accepted];
}

/** Every legal_documents row with all its columns, in id order, and their hash: the stage fixture's proof that it left them as they were. */
function legalDocumentsState(): array
{
    $rows = DB::table('legal_documents')->orderBy('id')->get()->map(fn (object $row): array => (array) $row)->all();

    return ['count' => count($rows), 'sha256' => hash('sha256', json_encode($rows, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE))];
}

if (! app()->environment('local', 'testing')) {
    refuse('refusing: the QA backend helper runs in the local and testing environments only');
}

$command = $argv[1] ?? '';
$args = array_slice($argv, 2);

switch ($command) {
    case 'reset-limits':
        $cleared = 0;
        foreach (AUTH_LIMITERS as $name) {
            $prefix = str_replace('-', '_', $name);
            foreach (LOOPBACK as $ip) {
                // Since M3.1 limiter keys use ClientAddress::key() (ADR-219: an IPv6 client counts by its /64, so ::1 is "::/64"); the
                // raw address is kept too for limits keyed before that.
                $keys = array_unique([$ip, ClientAddress::key(Request::create('/', 'GET', server: ['REMOTE_ADDR' => $ip]))]);
                foreach ($keys as $key) {
                    // ThrottleRequests hashes the limiter name and the key of the Limit (RateLimits::define).
                    RateLimiter::clear(md5($name.$prefix.'|ip:'.$key));
                    // The per-address cap of a member-keyed limiter (RateLimits::define with $ipMax).
                    RateLimiter::clear(md5($name.$prefix.'|address|ip:'.$key));
                    $cleared++;
                }
            }
        }
        $cleared += clearCsrfCookieLimit();
        $throttle = app(LoginThrottle::class);
        foreach ($args as $email) {
            RateLimiter::clear('account-exists:'.hash('sha256', $email));
            $throttle->clear($email);
        }
        finish(['cleared' => $cleared, 'addresses' => count($args)]);

    case 'reset-csrf-limit':
        // Called by the harness once when a CSRF cookie request answered 429 (support/auth.mjs, support/fixtures.ts), never in a loop.
        finish(['cleared' => clearCsrfCookieLimit()]);

    case 'age-codes':
        // The open codes of a test account as if they were older than their expiry and the resend cooldown.
        [$email, $purpose] = $args + [null, null];
        if (! is_string($email) || ! isTestAccount($email)) {
            refuse('refusing: age-codes takes a test account under '.E2E_DOMAIN);
        }
        $purpose = VerificationPurpose::tryFrom((string) $purpose) ?? refuse('unknown purpose');
        $user = User::query()->where('email', $email)->first() ?? refuse('no such account');
        $past = now()->subSeconds(config()->integer('speedclub.verification.resend_cooldown_seconds') + 5);
        $aged = VerificationCode::query()
            ->where('user_id', $user->getKey())
            ->where('purpose', $purpose)
            ->whereNull('consumed_at')
            ->update(['created_at' => $past, 'expires_at' => now()->subSecond()]);
        finish(['aged' => $aged]);

    case 'ensure-onboarding':
        $password = config('speedclub.demo.member_password');
        if (! is_string($password) || $password === '') {
            refuse('DEMO_MEMBER_PASSWORD is not set in web/.env');
        }
        $accounts = [];
        foreach (ONBOARDING as $kind => $spec) {
            // Playwright workers ask at the same time: whoever loses the insert takes the winner's row.
            for ($attempt = 1; ; $attempt++) {
                $user = User::withTrashed()->where('email', $spec['email'])->first()
                    ?? new User(['email' => $spec['email'], 'password' => $password, 'locale' => 'de', 'consented_at' => now()]);
                $user->fill(['username' => $spec['username'], 'display_name' => null, 'city' => null, 'bio' => null]);
                try {
                    $user->forceFill(['email_verified_at' => now(), 'profile_setup_at' => null, 'deleted_at' => null])->save();
                    break;
                } catch (UniqueConstraintViolationException $e) {
                    if ($attempt >= 3) {
                        throw $e;
                    }
                }
            }
            $accounts[$kind] = ['email' => $spec['email'], 'next_step' => $user->refresh()->onboardingStep()?->value];
        }
        finish(['accounts' => $accounts]);

    case 'create-member':
        // A verified member, for flows that start signed out (forgot + reset) or in the middle of onboarding (F1 resume):
        // step "done" finished onboarding, "username" still has to choose a name (AUTH-08, the username argument is then
        // ignored), "profile" has one and still has the profile setup open (AUTH-09). The password comes from
        // E2E_MEMBER_PASSWORD, so it never shows up in a process list.
        [$email, $username, $step] = $args + [null, null, 'done'];
        $password = getenv('E2E_MEMBER_PASSWORD');
        if (! is_string($email) || ! isTestAccount($email) || ! is_string($username) || ! in_array($step, ['done', 'username', 'profile'], true)
            || ! is_string($password) || $password === '') {
            refuse('usage: E2E_MEMBER_PASSWORD=… backend.php create-member <test email> <username> [done|username|profile]');
        }
        if (User::withTrashed()->where('email', $email)->exists()) {
            refuse('refusing: the account exists already');
        }
        $user = new User([
            'email' => $email,
            'password' => $password,
            'username' => $step === 'username' ? null : $username,
            'locale' => 'de',
            'consented_at' => now(),
        ]);
        $user->forceFill(['email_verified_at' => now(), 'profile_setup_at' => $step === 'done' ? now() : null])->save();
        finish(['id' => $user->getKey(), 'next_step' => $user->onboardingStep()?->value]);

    case 'delete-accounts':
        $prefix = $args[0] ?? '';
        $action = app(DeleteUnverifiedAccount::class);
        $deleted = 0;
        foreach (User::withTrashed()->where('email', 'like', '%'.E2E_DOMAIN)->get() as $user) {
            if (! isTestAccount($user->email) || ($prefix !== '' && ! str_starts_with($user->email, $prefix))) {
                continue;
            }
            // What a garage test made goes with it: the catalogue requests of "Nicht gefunden?", which would wait in the
            // admin queue, and the QR codes, which a hard delete keeps on purpose for real vehicles (ADR-148).
            $vehicles = Vehicle::withTrashed()->where('owner_id', $user->getKey())->pluck('id');
            CatalogRequest::query()->where('user_id', $user->getKey())->orWhereIn('vehicle_id', $vehicles)->delete();
            QrCode::query()->whereIn('vehicle_id', $vehicles)->delete();
            // A test member who followed or saved something of a demo member (HOME-01's suggestions are demo members) notified
            // that member. The row goes with the test member when it was its only actor, so the seeded histories stay as they are;
            // a grouped row with other actors keeps them (the foreign keys drop this actor from it).
            $caused = DB::table('notification_actors')->where('actor_id', $user->getKey())->pluck('notification_id');
            DB::table('notifications')
                ->where(fn ($query) => $query->where('actor_id', $user->getKey())->orWhereIn('id', $caused))
                ->where('actor_count', '<=', 1)
                ->delete();
            // Reports about a test account and support tickets of one would wait in the staff queues (ADM-20, ADM-25) after the
            // account is gone: the cases (their reports cascade) and the tickets go with it. Demo cases have demo subjects.
            DB::table('moderation_cases')->where('subject_id', $user->getKey())->delete();
            DB::table('support_tickets')->where('user_id', $user->getKey())->orWhere('email', $user->email)->delete();
            $action->handle($user);
            $deleted++;
        }
        // Guest tickets of WEB-10 sent from a test address have no account to go with.
        if ($prefix === '') {
            DB::table('support_tickets')->whereNull('user_id')->where('email', 'like', '%'.E2E_DOMAIN)->delete();
        }
        finish(['deleted' => $deleted]);

    case 'close-updates':
        // Ends the 10-minute window of a test vehicle's open build update, as if the time had passed: the next change starts
        // an entry of its own (BuildUpdates::record).
        $vehicle = Vehicle::withTrashed()->with('owner')->find((string) ($args[0] ?? '')) ?? refuse('no such vehicle');
        if (! isTestAccount((string) $vehicle->owner?->email)) {
            refuse('refusing: close-updates takes a vehicle of a test account under '.E2E_DOMAIN);
        }
        $closed = BuildUpdate::query()->where('vehicle_id', $vehicle->getKey())->whereNotNull('open_until')->update(['open_until' => null]);
        finish(['closed' => $closed]);

    case 'age-test-member':
        // M4.12 F15: an organiser needs an account at least 14 days old (09 §8.7 creation rights). Moves a test account's
        // creation back by that many days; nothing else of the account changes.
        [$email, $days] = $args + [null, '15'];
        if (! is_string($email) || ! isTestAccount($email) || ! ctype_digit((string) $days) || (int) $days > 400) {
            refuse('usage: backend.php age-test-member <test email> <days ≤ 400>');
        }
        $user = User::query()->where('email', $email)->first() ?? refuse('no such account');
        $user->forceFill(['created_at' => now()->subDays((int) $days)])->saveQuietly();
        finish(['id' => $user->getKey(), 'created_at' => $user->created_at?->toIso8601String()]);

    case 'review-test-event':
        // M4.12 F15: the ADM-53 decision on a test organiser's pending event, without the admin queue (its UI is lane B's): approve
        // publishes it, reject keeps it out with a reason. Only events of accounts under E2E_DOMAIN.
        [$slug, $outcome] = $args + [null, 'approve'];
        $event = \App\Models\Event::query()->where('slug', (string) $slug)->with('organiser')->first() ?? refuse('no such event');
        if (! isTestAccount((string) $event->organiser?->email) || ! in_array($outcome, ['approve', 'reject'], true)) {
            refuse('usage: backend.php review-test-event <slug of a test organiser> approve|reject');
        }
        $event->forceFill($outcome === 'approve'
            ? ['status' => \App\Enums\EventStatus::Published, 'published_at' => now(), 'reviewed_at' => now(), 'review_reason' => null]
            : ['status' => \App\Enums\EventStatus::Rejected, 'reviewed_at' => now(), 'review_reason' => 'Bitte nenn die Genehmigung des Platzes.'])->save();
        finish(['slug' => $event->slug, 'status' => $event->status->value]);

    case 'qr-scans':
        // The counted scans of a code (F4), and what a stored row holds: one number per code and day, nothing about who.
        $code = QrCode::query()->where('code', strtoupper((string) ($args[0] ?? '')))->first() ?? refuse('no such code');
        $rows = QrScanDaily::query()->where('qr_code_id', $code->getKey())->get();
        finish([
            'total' => (int) $rows->sum('count'),
            'columns' => array_keys($rows->first()?->getAttributes() ?? []),
        ]);

    case 'set-discoverable':
        // "In der Suche auffindbar" of a test account (users.discoverable, M1.8 member search). The member setting arrives
        // with the Phase 2 privacy screen; until then only this helper flips it, and only for accounts under E2E_DOMAIN.
        [$email, $flag] = $args + [null, null];
        if (! is_string($email) || ! isTestAccount($email) || ! in_array($flag, ['0', '1'], true)) {
            refuse('usage: backend.php set-discoverable <test email under '.E2E_DOMAIN.'> <0|1>');
        }
        $user = User::query()->where('email', $email)->first() ?? refuse('no such account');
        $user->forceFill(['discoverable' => $flag === '1'])->save();
        finish(['discoverable' => (bool) $user->refresh()->getAttribute('discoverable')]);

    case 'set-who-can-message':
        // "Wer darf mir schreiben" of a test account (users.who_can_message, M2.1 can_message on PROF-02). The member setting
        // arrives with SET-07 (M2.5); until then only this helper sets it, and only for accounts under E2E_DOMAIN.
        [$email, $value] = $args + [null, null];
        $choice = is_string($value) ? WhoCanMessage::tryFrom($value) : null;
        if (! is_string($email) || ! isTestAccount($email) || $choice === null) {
            refuse('usage: backend.php set-who-can-message <test email under '.E2E_DOMAIN.'> <everyone|following|nobody>');
        }
        $user = User::query()->where('email', $email)->first() ?? refuse('no such account');
        $user->forceFill(['who_can_message' => $choice])->save();
        $stored = $user->refresh()->getAttribute('who_can_message');
        finish(['who_can_message' => $stored instanceof WhoCanMessage ? $stored->value : (string) $stored]);

    case 'run-test-jobs':
        // The queue worker does not run locally (README), so the plate blur, the data export and the decision mail of a test account would
        // wait forever: runQueuedJobsOf runs exactly those queued jobs of that one account.
        $email = (string) ($args[0] ?? '');
        if (! isTestAccount($email)) {
            refuse('refusing: run-test-jobs takes a test account under '.E2E_DOMAIN);
        }
        $only = $args[1] ?? null;
        if ($only !== null && ! in_array($only, ['BlurMedia', 'BuildDataExport', 'SendDecisionMail', 'SendAppealOutcomeMail'], true)) {
            refuse('usage: backend.php run-test-jobs <test email> [BlurMedia|BuildDataExport|SendDecisionMail|SendAppealOutcomeMail]');
        }
        $user = User::withTrashed()->where('email', $email)->first() ?? refuse('no such account');
        finish(['ran' => runQueuedJobsOf($user, $only)]);

    case 'decide-test-case':
        // A decision on the open case about a test account (F6: SAFE-01 and the appeal of a member of its own), through DecideCase,
        // the only writer of decisions, with the system as decider: remove_content, Community-Richtlinien §4. Demo cases are refused.
        $email = (string) ($args[0] ?? '');
        if (! isTestAccount($email)) {
            refuse('refusing: decide-test-case takes a test account under '.E2E_DOMAIN);
        }
        $user = User::query()->where('email', $email)->first() ?? refuse('no such account');
        $case = ModerationCase::query()->where('subject_id', $user->getKey())->whereNotNull('open_target')->oldest()->first()
            ?? refuse('no open case about this account');
        $decision = app(DecideCase::class)->handle($case, new DecisionInput(
            action: DecisionAction::RemoveContent,
            facts: 'Das gemeldete Foto zeigt ein fremdes Bild ohne Erlaubnis des Urhebers.',
            ground: 'Community-Richtlinien §4: Lade nur Fotos hoch, an denen du die Rechte hast.',
            groundDocument: GroundDocument::Community,
            groundSection: '4',
            reason: 'E2E F6 appeal flow',
        ));
        finish(['decision_id' => (string) $decision->getKey()]);

    case 'test-cases':
        // The moderation cases about a test account (flows/a2-report-handling.spec.ts: which case its report opened), newest first. Read
        // only, ids and kinds, never a report's content. Demo members are refused.
        $email = (string) ($args[0] ?? '');
        if (! isTestAccount($email)) {
            refuse('refusing: test-cases takes a test account under '.E2E_DOMAIN);
        }
        $user = User::withTrashed()->where('email', $email)->first() ?? refuse('no such account');
        $cases = ModerationCase::query()->where('subject_id', $user->getKey())->orderByDesc('created_at')->orderByDesc('id')->get();
        finish(['cases' => $cases->map(fn (ModerationCase $case): array => [
            'id' => (string) $case->getKey(),
            'target_type' => $case->target_type->value,
            'target_id' => (string) $case->getAttribute('target_id'),
            'status' => $case->status->value,
        ])->values()->all()]);

    case 'ensure-sessions-fixture':
        // DQ-453: SET-06 of a member nobody else signs in as, with a fixed set of app devices. Every call ends whatever sessions and
        // tokens the account had (a capture run's own sign-in included) and seeds the same three devices again, so the list is the
        // same in every run: the capturing browser ("Dieses Gerät") first, then these by their fixed last use.
        $password = config('speedclub.demo.member_password');
        if (! is_string($password) || $password === '') {
            refuse('DEMO_MEMBER_PASSWORD is not set in web/.env');
        }
        $email = 'sessions.fixture'.E2E_DOMAIN;
        $user = User::withTrashed()->where('email', $email)->first()
            ?? new User(['email' => $email, 'password' => $password, 'locale' => 'de', 'consented_at' => now()]);
        $user->fill(['username' => 'mia.sessions', 'display_name' => 'Mia Brandt', 'city' => 'Leipzig']);
        $user->forceFill(['email_verified_at' => now(), 'profile_setup_at' => now(), 'deleted_at' => null])->save();
        $user->tokens()->delete();
        if (Schema::hasTable('sessions')) {
            DB::table('sessions')->where('user_id', $user->getKey())->delete();
        }
        $devices = [
            ['iPhone 15 Pro', 'ios', 'qa-fixture-ios', '2026-10-30 18:20:00'],
            ['Pixel 8', 'android', 'qa-fixture-android', '2026-10-27 09:05:00'],
            ['iPad Air', 'ios', 'qa-fixture-ipad', '2026-10-12 21:40:00'],
        ];
        foreach ($devices as [$name, $platform, $deviceId, $used]) {
            $token = $user->createToken($name)->accessToken;
            $token->forceFill([
                'device_name' => $name,
                'platform' => $platform,
                'device_id' => $deviceId,
                'app_version' => '0.2.0',
                'last_used_at' => $used,
                'created_at' => $used,
            ])->save();
        }
        finish(['email' => $email, 'devices' => count($devices)]);

    case 'ensure-staff':
        // The staff fixtures of this run (STAFF_FIXTURES), each reset to: active, no password proof pending (ADR-218: an account with
        // it cannot sign in), the run's password, its role, and for enrolled ones the run's TOTP secret, confirmed. The password and
        // the secrets come in the environment, never on the command line, and are printed nowhere. A new credentials epoch ends any
        // session an earlier run left (EnsureStaffActive), and requests an aborted run left behind go first.
        $password = getenv('E2E_STAFF_PASSWORD');
        $secrets = json_decode((string) getenv('E2E_STAFF_SECRETS'), true);
        if (! is_string($password) || strlen($password) < 16 || ! is_array($secrets)) {
            refuse('usage: E2E_STAFF_PASSWORD=… E2E_STAFF_SECRETS={"label":"BASE32"} backend.php ensure-staff');
        }
        // ADR-237: at most speedclub.team.max_owners Owners that are not deactivated, the seeded one included. The fixture list keeps
        // to its share, and a database that already holds more Owners than the rest of the maximum is refused rather than pushed over it.
        $fixtureOwners = count(array_filter(STAFF_FIXTURES, fn (array $spec): bool => $spec['role'] === 'owner'));
        if ($fixtureOwners > STAFF_FIXTURE_OWNERS) {
            refuse("refusing: {$fixtureOwners} Owner fixtures, at most ".STAFF_FIXTURE_OWNERS.' (ADR-237)');
        }
        // DQ-677: a run that needs only some fixtures (the visual runner: one per auth kind) names them in E2E_STAFF_LABELS; every other
        // fixture goes, so the team pages it photographs count the same people in every run, whatever an earlier or aborted run left.
        $only = getenv('E2E_STAFF_LABELS');
        $fixtures = STAFF_FIXTURES;
        if (is_string($only) && $only !== '') {
            $labels = json_decode($only, true);
            if (! is_array($labels) || $labels === [] || array_diff($labels, array_keys(STAFF_FIXTURES)) !== []) {
                refuse('refusing: E2E_STAFF_LABELS must be a JSON list of STAFF_FIXTURES labels');
            }
            $fixtures = array_intersect_key(STAFF_FIXTURES, array_flip($labels));
        }
        // Leftovers of an aborted run or an earlier fixture list go first, with the branding a fixture made.
        removeFixtureBranding();
        $unused = array_map(staffFixtureEmail(...), array_keys(array_diff_key(STAFF_FIXTURES, $fixtures)));
        foreach (staleStaffFixtures()->concat(Staff::query()->whereIn('email', $unused)->get()) as $stale) {
            deleteStaffFixture($stale);
        }
        $fixtureOwners = count(array_filter($fixtures, fn (array $spec): bool => $spec['role'] === 'owner'));
        $otherOwners = Staff::query()->role('owner', 'staff')->where('email', 'not like', '%'.STAFF_DOMAIN)
            ->where('status', '!=', StaffStatus::Deactivated->value)->whereNull('anonymised_at')->count();
        $maxOwners = OwnerRules::maxOwners();
        if ($otherOwners + $fixtureOwners > $maxOwners) {
            refuse("refusing: {$otherOwners} Owners besides the fixtures and {$fixtureOwners} Owner fixtures exceed the maximum of {$maxOwners} (ADR-237)");
        }
        $accounts = [];
        foreach ($fixtures as $label => $spec) {
            $secret = $secrets[$label] ?? null;
            if ($spec['enrolled'] && (! is_string($secret) || preg_match('/^[A-Z2-7]{32}$/', $secret) !== 1)) {
                refuse("refusing: fixture {$label} needs a 160-bit base32 secret");
            }
            $email = staffFixtureEmail($label);
            $staff = DB::transaction(function () use ($email, $spec, $password, $secret): Staff {
                $staff = Staff::query()->where('email', $email)->lockForUpdate()->first() ?? new Staff(['email' => $email]);
                $staff->fill(['name' => $spec['name'], 'password' => $password, 'status' => StaffStatus::Active]);
                $encrypter = Fortify::currentEncrypter();
                $staff->forceFill([
                    'password_proof_required' => false,
                    'two_factor_secret' => $spec['enrolled'] ? $encrypter->encrypt($secret) : null,
                    'two_factor_recovery_codes' => $spec['enrolled']
                        ? $encrypter->encrypt((string) json_encode(array_map(fn (): string => RecoveryCode::generate(), range(1, 8))))
                        : null,
                    'two_factor_confirmed_at' => $spec['enrolled'] ? now() : null,
                    'credentials_epoch' => Str::random(32),
                    'remember_token' => null,
                ])->save();
                releaseStaffApprovals($staff);
                DB::table('admin_saved_views')->where('staff_id', $staff->getKey())->delete();
                if ($staff->exists) {
                    endFixtureViewAs($staff);
                }
                $staff->syncRoles([$spec['role']]);

                return $staff;
            });
            $accounts[$label] = ['email' => $email, 'name' => $spec['name'], 'role' => $spec['role'], 'id' => $staff->getKey(), 'enrolled' => $spec['enrolled']];
        }
        finish(['accounts' => $accounts]);

    case 'delete-staff':
        // Only the fixtures of STAFF_FIXTURES (and leftovers of an earlier list under STAFF_DOMAIN), with their approval requests, saved
        // views and the branding they made. Their audit events stay: the log is a hash chain and append-only, and a sign-in of a removed
        // test account is still a true record.
        $branding = removeFixtureBranding();
        $deleted = 0;
        $requests = 0;
        foreach (Staff::query()->whereIn('email', staffFixtureEmails())->get()->concat(staleStaffFixtures()) as $staff) {
            $requests += deleteStaffFixture($staff);
            $deleted++;
        }
        finish(['deleted' => $deleted, 'approvals' => $requests, 'branding' => $branding]);

    case 'remove-branding-fixture':
        finish(removeFixtureBranding());

    case 'branding-state':
        finish(brandingState());

    case 'park-branding-draft':
        // A3 (flows/a3-branding.spec.ts) inside its lock: the engine allows one branding draft, and a staff member's draft (the content
        // editor's of BrandContentDemoSeeder, DQ-612) is theirs (draft_taken). A3 neither takes it over nor discards it: the row moves
        // aside under PARKED_BRANDING_KEY (only its key column) for the test, and remove-branding-fixture (also delete-staff and
        // ensure-staff, so after an aborted run too) puts it back once the fixture's versions are gone.
        restoreSeededDraftOwners();
        if (DB::table('config_versions')->where('key', PARKED_BRANDING_KEY)->exists()) {
            refuse('refusing: a parked branding draft exists already; run remove-branding-fixture first');
        }
        $fixtureIds = staffFixtureIds();
        $draft = DB::table('config_versions')->where('key', ConfigKey::Branding->value)->where('status', ConfigVersionStatus::Draft->value)->first();
        if ($draft === null || in_array((int) $draft->created_by, $fixtureIds, true)) {
            finish(['parked' => null]);
        }
        $state = rowState($draft);
        DB::table('config_versions')->where('id', $draft->id)->update(['key' => PARKED_BRANDING_KEY]);
        finish(['parked' => $state]);

    case 'lend-seeded-drafts':
        // The visual stage `draft-owner` (support/stage-fixtures.mjs, DQ-674): ADM-28 and ADM-30 as the owner of the seeded drafts sees
        // them, editable, captured with the fixture of the given label. Only created_by changes, and restore-seeded-drafts (also run by
        // remove-branding-fixture, delete-staff and ensure-staff) gives each back to the staff member its first config.draft_saved names.
        $label = $args[0] ?? '';
        $staff = Staff::query()->where('email', staffFixtureEmail($label))->first() ?? refuse("no staff fixture {$label}: run ensure-staff first");
        restoreSeededDraftOwners();
        $fixtureIds = staffFixtureIds();
        $lent = [];
        foreach (LENT_DRAFT_KEYS as $key) {
            $draft = DB::table('config_versions')->where('key', $key->value)->where('status', ConfigVersionStatus::Draft->value)->first();
            if ($draft === null || $draft->created_by === null || in_array((int) $draft->created_by, $fixtureIds, true)) {
                continue;
            }
            DB::table('config_versions')->where('id', $draft->id)->update(['created_by' => $staff->getKey()]);
            $lent[$key->value] = (int) $draft->version;
        }
        finish(['lent' => $lent, 'to' => $staff->getAttribute('name')]);

    case 'restore-seeded-drafts':
        finish(['restored' => restoreSeededDraftOwners()]);

    case 'm414-ids':
        // M4.14 visual path tokens: the seeded KW Variante 3 (ids change with every seed) and a public build's mod that links it, for
        // BRD-02 and VEH-02's "Builds mit {Produkt}". Read from the database, so the lookup works while parts_catalogue is still off.
        $product = DB::table('products as p')->join('brands as b', 'b.id', '=', 'p.brand_id')
            ->where('b.slug', 'kw')->where('p.slug', 'variante-3')->value('p.id') ?? refuse('no KW Variante 3; run the catalogue seeder');
        $mod = DB::table('modifications as m')->join('vehicles as v', 'v.id', '=', 'm.vehicle_id')
            ->where('m.product_id', $product)->where('v.status', 'published')->where('v.visibility', 'public')
            ->whereNull('v.deleted_at')->whereNull('m.deleted_at')->orderBy('v.created_at')->first(['m.id as mod', 'v.slug as vehicle']);
        // M4.17: the seeded sample business (ShowcaseBusinesses) for ADM-55's pane and ADM-56.
        $sampleBusiness = DB::table('businesses')->where('slug', 'beispiel-werkstatt-nord')->value('id');
        finish(['kwProduct' => $product, 'productMod' => $mod?->mod, 'productModVehicle' => $mod?->vehicle, 'sampleBusiness' => $sampleBusiness]);

    case 'enable-m414-flags':
        finish(m414FlagsFixture(true));

    case 'disable-m414-flags':
        finish(m414FlagsFixture(false));

    case 'review-test-business':
        // M4.14 F13: the ADM-55 decision on a test applicant's business, without the admin queue (lane B's UI): verify makes it
        // public with the badge, reject keeps it out with a reason. Only businesses owned by accounts under E2E_DOMAIN.
        [$slug, $outcome] = $args + [null, 'verify'];
        $business = \App\Models\Business::query()->where('slug', (string) $slug)->with('owner')->first() ?? refuse('no such business');
        if (! isTestAccount((string) $business->owner?->email) || ! in_array($outcome, ['verify', 'reject'], true)) {
            refuse('usage: backend.php review-test-business <slug of a test owner> verify|reject');
        }
        $business->forceFill($outcome === 'verify'
            ? ['status' => \App\Enums\BusinessStatus::Verified, 'verified_at' => now(), 'reviewed_at' => now(), 'review_reason' => null]
            : ['status' => \App\Enums\BusinessStatus::Rejected, 'reviewed_at' => now(), 'review_reason' => 'Bitte ergänze die Registernummer.'])->save();
        finish(['slug' => $business->slug, 'status' => $business->status->value]);

    case 'enable-premium-fixture':
        finish(premiumFixture(true));

    case 'disable-premium-fixture':
        finish(premiumFixture(false));

    case 'run-health-fixture':
        finish(healthFixture(true));

    case 'remove-health-fixture':
        finish(healthFixture(false));

    case 'remove-maintenance-fixture':
        // The exit path of the visual stage fixture `maintenance` (support/maintenance.mjs): its fixed-id items and log entries of one
        // vehicle, and the HU/AU month the HU/AU item mirrored onto that vehicle (ADR-441). The normal teardown deletes through the API.
        $vehicle = (string) ($args[0] ?? '') ?: refuse('usage: remove-maintenance-fixture <vehicle> <id>...');
        $ids = array_values(array_filter(array_slice($args, 1), fn ($id) => str_starts_with((string) $id, '01mntfx')));
        $logs = DB::table('maintenance_logs')->where('vehicle_id', $vehicle)->whereIn('id', $ids)->delete();
        $items = DB::table('maintenance_items')->where('vehicle_id', $vehicle)->whereIn('id', $ids)->delete();
        DB::table('vehicles')->where('id', $vehicle)->update(['hu_au_due' => null, 'hu_au_reminded_for' => null]);
        finish(['logs' => $logs, 'items' => $items]);

    case 'reset-staff-limits':
        // The staff sign-in limiter (FortifyServiceProvider 'login': per address + client, and per client) of the loopback clients, for
        // the fixture addresses only, and their progressive delay (LoginThrottle). Called once when a sign-in of a run answered 429
        // because a run right before it used the same minute, never in a loop.
        $cleared = 0;
        $throttle = app(LoginThrottle::class);
        foreach (LOOPBACK as $ip) {
            $client = ClientAddress::of($ip);
            RateLimiter::clear(md5('login'.'staff-login-client|'.$client));
            $cleared++;
            foreach (staffFixtureEmails() as $email) {
                RateLimiter::clear(md5('login'.Str::transliterate($email.'|'.$client)));
                $cleared++;
            }
        }
        foreach (staffFixtureEmails() as $email) {
            $throttle->clear('staff|'.Str::transliterate($email));
        }
        finish(['cleared' => $cleared]);

    case 'seeded-audit-event':
        // ADM-44-event (ADR-223): the newest audit event of the seeded history, with a before/after diff when one has it. The seeders
        // date their history on the demo clock (DemoSeeder::NOW); everything a run or a person writes later carries the real time, so
        // nothing after that instant is a seeded event. Read only: the id changes with every seed, the event it names does not.
        $seeded = DB::table('audit_events')->where('occurred_at', '<=', DemoSeeder::NOW);
        $event = (clone $seeded)->where(fn ($q) => $q->whereNotNull('after')->orWhereNotNull('before'))
            ->orderByDesc('occurred_at')->orderByDesc('id')->first(['id', 'action'])
            ?? (clone $seeded)->orderByDesc('occurred_at')->orderByDesc('id')->first(['id', 'action'])
            ?? refuse('no seeded audit event: run the DemoSeeder');
        finish(['id' => (string) $event->id, 'action' => (string) $event->action]);

    case 'start-view-as':
        // VIEWAS-* (m3.2-contract §3): a view-as of VIEW_AS_MEMBER by the owner fixture of this run, through StartViewAs as the admin's
        // "Ansicht als" does it (reason, 30 minutes, audited), answering the one-time URL. A new start ends the fixture's previous view
        // of that member. The run ends it (delete-staff, endFixtureViewAs); expiry ends it too.
        $label = (string) ($args[0] ?? '');
        if ($label !== VIEW_AS_STAFF) {
            refuse('refusing: start-view-as takes the staff fixture '.VIEW_AS_STAFF);
        }
        $staff = Staff::query()->where('email', staffFixtureEmail($label))->first() ?? refuse('no staff fixture '.$label.': run ensure-staff first');
        $member = User::query()->where('username', VIEW_AS_MEMBER)->where('email', VIEW_AS_MEMBER.'@'.DemoSeeder::EMAIL_DOMAIN)->first()
            ?? refuse('no demo member '.VIEW_AS_MEMBER.': run the DemoSeeder');
        $started = app(StartViewAs::class)->handle($staff, $member, 'QA: Bildschirmfotos der Ansicht als Mitglied (visual registry)', false);
        finish(['url' => $started['url'], 'expires_at' => $started['expires_at'], 'member' => VIEW_AS_MEMBER, 'staff' => $staff->name]);

    case 'ensure-decisions-fixture':
        // SAFE-01-staff and SAFE-01-reversal: a member of its own (decisions.fixture@E2E_DOMAIN) with three decisions of the team made
        // through the admin's own Actions (RestrictMember, LiftRestriction: own-initiative cases, DecideCase, the reverse action), by a
        // seeded staff account with members.restrict: a messaging restriction, its reversal, and a publishing restriction without an end
        // that stands. Kept while it is whole (a second call answers the same ids); otherwise its cases go and it is made again. Their
        // times are fixed (DECISION_FIXTURE_TIMES) and their mails sent, so the pictures and the queue stay put.
        $user = fixtureMember('decisions.fixture'.E2E_DOMAIN, 'ida.entscheid', 'Ida Krämer', 'Bremen');
        $reversal = Decision::query()->where('subject_id', $user->getKey())->where('action', DecisionAction::Reverse)->first();
        $standing = Decision::query()->where('subject_id', $user->getKey())->where('action', DecisionAction::Restrict)
            ->where('restriction->type', RestrictionType::Publishing->value)->first();
        $restrictions = is_array($user->restrictions) ? $user->restrictions : [];
        $whole = $reversal instanceof Decision && $reversal->reverses_decision_id !== null && $standing instanceof Decision
            && ($restrictions[RestrictionType::Publishing->value]['decision_id'] ?? null) === $standing->getKey()
            && ! isset($restrictions[RestrictionType::Messaging->value]);
        if (! $whole) {
            DB::table('moderation_cases')->where('subject_id', $user->getKey())->delete();
            $user->forceFill(['restrictions' => null, 'status' => UserStatus::Active])->save();
            $staff = Staff::query()->where('email', 'moderator@'.DemoSeeder::EMAIL_DOMAIN)->first();
            if (! $staff instanceof Staff || ! $staff->hasPermissionTo('members.restrict', 'staff')) {
                $staff = Staff::query()->where('email', 'not like', '%'.STAFF_DOMAIN)->orderBy('id')->get()
                    ->first(fn (Staff $s): bool => $s->hasPermissionTo('members.restrict', 'staff'))
                    ?? refuse('no seeded staff account with members.restrict: run the StaffSeeder');
            }
            // DQ-689: the three cases get the same numbers on every make (ADM-20-decided prints them).
            [$original, $reversal, $standing] = withFixedUlidTails('decisions-fixture', function () use ($staff, $user): array {
                $restrict = app(RestrictMember::class);
                $original = $restrict->handle($staff, $user, RestrictionType::Messaging, CarbonImmutable::now()->addDays(7), new Statement(
                    facts: 'Du hast innerhalb von zwei Tagen 23 Mitgliedern dieselbe Nachricht mit einem Link zu einem Teile-Shop geschickt.',
                    ground: 'Community-Richtlinien §4: keine Werbung und keine Massennachrichten an Mitglieder, die dich nicht kennen.',
                    groundDocument: GroundDocument::Community,
                    groundSection: '4',
                ), 'QA-Fixture SAFE-01: Einschränkung, die später aufgehoben wird');
                $reversal = app(LiftRestriction::class)->handle($staff, $user->refresh(), DecisionRestriction::Messaging,
                    'Der Shop-Link stammt aus einer Club-Aktion, die wir selbst angekündigt hatten. Die Einschränkung war deshalb nicht nötig.',
                    'QA-Fixture SAFE-01: Aufhebung');
                $standing = $restrict->handle($staff, $user->refresh(), RestrictionType::Publishing, null, new Statement(
                    facts: 'Dein Fahrzeug „Golf GTI Clubsport“ zeigt Fotos, die aus der Anzeige eines Händlers stammen, ohne dessen Erlaubnis.',
                    ground: 'Nutzungsbedingungen §6: Du lädst nur Inhalte hoch, an denen du die nötigen Rechte hast.',
                    groundDocument: GroundDocument::Terms,
                    groundSection: '6',
                ), 'QA-Fixture SAFE-01: Einschränkung des Teams ohne Meldung');
                runQueuedJobsOf($user);

                return [$original->refresh(), $reversal, $standing];
            });
        } else {
            $original = Decision::query()->findOrFail($reversal->reverses_decision_id);
        }
        foreach (['original' => $original, 'reversal' => $reversal, 'staff' => $standing] as $key => $decision) {
            $at = CarbonImmutable::parse(DECISION_FIXTURE_TIMES[$key], 'Europe/Berlin');
            $decision->forceFill(['decided_at' => $at, 'notified_at' => $at, 'mailed_at' => $at, 'created_at' => $at, 'updated_at' => $at])->save();
            ModerationCase::query()->whereKey($decision->case_id)->update(['decided_at' => $at, 'created_at' => $at, 'updated_at' => $at]);
        }
        $restriction = $original->restriction;
        if (is_array($restriction)) {
            $original->forceFill(['restriction' => [...$restriction, 'until' => CarbonImmutable::parse(DECISION_FIXTURE_TIMES['original'], 'Europe/Berlin')->addDays(7)->toIso8601String()]])->save();
        }
        finish(['email' => $user->email, 'staff_decision' => (string) $standing->getKey(), 'reversal' => (string) $reversal->getKey(), 'original' => (string) $original->getKey()]);

    case 'ensure-two-factor-fixture':
        // SET-03-2fa and SET-04-2fa: a member of its own (twofactor.fixture@E2E_DOMAIN) with two-factor on, its secret the run's
        // (E2E_MEMBER_TOTP, from the environment, never the command line). Every call ends its sessions and sets the secret again, so the
        // run's sign-in (support/auth.mjs, AUTH-11 over HTTP) is the only one.
        $secret = (string) getenv('E2E_MEMBER_TOTP');
        if (preg_match('/^[A-Z2-7]{32}$/', $secret) !== 1) {
            refuse('usage: E2E_MEMBER_TOTP=<160-bit base32> backend.php ensure-two-factor-fixture');
        }
        $user = fixtureMember('twofactor.fixture'.E2E_DOMAIN, 'tom.zweifaktor', 'Tom Albers', 'Kassel');
        $user->forceFill([
            'two_factor_secret' => $secret,
            'two_factor_confirmed_at' => now(),
            'two_factor_recovery_codes' => app(TwoFactor::class)->newRecoveryCodes()['hashes'],
            'two_factor_last_step' => null,
            'two_factor_locked_at' => null,
        ])->save();
        finish(['email' => $user->email, 'two_factor' => $user->refresh()->hasTwoFactor()]);

    case 'ensure-approvals-fixture':
        // ADM-43, ADM-43-mine, ADM-43-all (DQ-528): the four-eyes queue as the `admin` fixture sees it, every request asked for by a staff
        // FIXTURE (so delete-staff removes them with the run, and none waits in a real approver's queue) about demo members no other
        // route opens: two pending for the admin (a deletion by the owner fixture, a bulk restriction by the moderator fixture), one
        // pending of the admin's own, one the owner denied with a comment, one executed bulk with three failed records and one expired.
        // Asked for through Approvals::request() and denied through deny() (the real path, audited); the executed and the expired one
        // are set afterwards: nothing is ever executed. Run it after ensure-staff (which removes every fixture's requests).
        $fixture = fn (string $label): Staff => Staff::query()->where('email', staffFixtureEmail($label))->first()
            ?? refuse('no staff fixture '.$label.': run ensure-staff first');
        $owner = $fixture('owner');
        $admin = $fixture('admin');
        $moderator = $fixture('moderator');
        foreach ([$owner, $admin, $moderator] as $staff) {
            releaseStaffApprovals($staff);
        }
        $demo = User::query()->where('email', 'like', '%@'.DemoSeeder::EMAIL_DOMAIN)->whereNotNull('username')->orderBy('username')->get();
        $member = fn (string $username): User => $demo->firstWhere('username', $username) ?? refuse('no demo member '.$username.': run the DemoSeeder');
        $ids = $demo->pluck('id')->map(fn ($id): string => (string) $id)->values()->all();
        $approvals = app(Approvals::class);
        $at = CarbonImmutable::parse(APPROVALS_QA_NOW);
        $pendingUntil = now()->addHours(config()->integer('speedclub.approvals.ttl_hours'))->subMinutes(5);
        $statement = [
            'type' => RestrictionType::Messaging->value,
            'until' => now()->addDays(7)->toIso8601String(),
            'facts' => 'Mehrere Mitglieder haben dieselbe Werbenachricht für einen Teile-Shop bekommen, aus einer Kontaktanfrage heraus.',
            'ground' => 'Community-Richtlinien §4: keine Werbung und keine Massennachrichten an Mitglieder, die dich nicht kennen.',
            'ground_document' => GroundDocument::Community->value,
            'ground_section' => '4',
        ];

        $made = DB::transaction(function () use ($approvals, $owner, $admin, $moderator, $member, $ids, $statement): array {
            $delete = $member('jann.ptrs');
            $exportOwn = $member('finn.jdm');
            $exportExpired = $member('max.e46');

            return [
                'pending_delete' => $approvals->request('members.delete', ['member_id' => $delete->id],
                    'Das Mitglied hat per Support-Ticket die Löschung beantragt. Es kommt nicht mehr in sein Konto, weil es die alte E‑Mail‑Adresse nicht mehr hat.',
                    $owner, $delete),
                'pending_bulk' => $approvals->request('members.bulk', ['action' => 'restrict', 'ids' => $ids, 'options' => $statement],
                    'Dieselbe Shop-Nachricht kam innerhalb einer Stunde von all diesen Konten: Nachrichten für eine Woche einschränken.',
                    $moderator),
                'pending_own' => $approvals->request('members.export', ['member_id' => $exportOwn->id],
                    'Auskunftsersuchen nach Art. 15 DSGVO per Brief; das Mitglied kommt nicht mehr in die App.',
                    $admin, $exportOwn),
                'denied' => $approvals->request('members.list_export', ['filter' => [], 'sort' => 'username', 'rows_at_request' => count($ids)],
                    'Liste aller Mitglieder mit Adressen für die Einladung zum Clubtreffen.',
                    $admin),
                'executed' => $approvals->request('members.bulk', ['action' => 'revoke_sessions', 'ids' => $ids, 'options' => []],
                    'Verdacht auf abgegriffene Zugangsdaten nach der Phishing-Warnung: alle Sitzungen dieser Konten beenden.',
                    $admin),
                'expired' => $approvals->request('members.export', ['member_id' => $exportExpired->id],
                    'Das Mitglied hat telefonisch eine Kopie seiner Daten angefragt.',
                    $admin, $exportExpired),
            ];
        });
        $approvals->deny($made['denied'], $owner, 'Bitte nur die Adressen der Mitglieder, die zugesagt haben, nicht die ganze Liste.');

        $failed = array_slice($ids, 0, 3);
        $codes = ['not_found', 'not_possible', 'not_possible'];
        $rows = array_map(fn (string $id): array => ['id' => $id, 'ok' => ! in_array($id, $failed, true), 'code' => in_array($id, $failed, true) ? $codes[array_search($id, $failed, true)] : null], $ids);
        $times = [
            'pending_delete' => ['created' => $at->subMinutes(20)],
            'pending_bulk' => ['created' => $at->subMinutes(70)],
            'pending_own' => ['created' => $at->subMinutes(150)],
            'denied' => ['created' => $at->subDay()->subHours(3), 'decided' => $at->subDay()],
            'executed' => ['created' => $at->subDays(2)->subHours(2), 'decided' => $at->subDays(2)],
            'expired' => ['created' => $at->subHours(30), 'decided' => $at->subHours(6)],
        ];
        foreach ($made as $key => $request) {
            $request = ApprovalRequest::query()->findOrFail($request->getKey());
            $fill = ['created_at' => $times[$key]['created'], 'updated_at' => $times[$key]['decided'] ?? $times[$key]['created']];
            $fill += match ($key) {
                'denied' => ['decided_at' => $times[$key]['decided'], 'expires_at' => $times[$key]['created']->addHours(24)],
                'executed' => [
                    'status' => ApprovalStatus::Executed, 'pending_key' => null, 'decided_by' => $owner->getKey(), 'decided_at' => $times[$key]['decided'],
                    'executed_at' => $times[$key]['decided'], 'decision_comment' => null, 'expires_at' => $times[$key]['created']->addHours(24),
                    'result' => ['done' => count($ids) - 3, 'failed' => 3, 'rows' => $rows],
                ],
                'expired' => ['status' => ApprovalStatus::Expired, 'pending_key' => null, 'decided_at' => $times[$key]['decided'], 'expires_at' => $times[$key]['decided']],
                default => ['expires_at' => $pendingUntil],
            };
            $request->forceFill($fill)->save();
        }
        finish(['created' => count($made), 'members' => count($ids), 'ids' => array_map(fn (ApprovalRequest $r): string => (string) $r->getKey(), $made)]);

    case 'publish-announcement-fixture':
        // HOME-01-announcement-info / -warning (stage fixture): the announcement of that kind as the only live one, a published version of
        // its own above every version of the key (announcementFixturePlan); the live version is superseded (its status column only) until
        // remove-announcement-fixture makes it live again. A staff draft stays as it is. A leftover of an aborted run goes first.
        $kind = (string) ($args[0] ?? '');
        $item = ANNOUNCEMENT_FIXTURES[$kind] ?? refuse('usage: backend.php publish-announcement-fixture <info|warning>');
        removeAnnouncementFixture();
        $staff = seededStaffWith(['content.edit', 'content.publish'], 'content-editor');
        $payload = app(ConfigSchemas::class)->for(ConfigKey::Announcements)->normalize(['items' => [$item]]);
        $made = DB::transaction(function () use ($staff, $payload, $kind): array {
            $rows = ConfigVersion::query()->where('key', ConfigKey::Announcements->value)->orderBy('version')->lockForUpdate()->get();
            $plan = announcementFixturePlan($rows->map(fn (ConfigVersion $row): array => [
                'version' => (int) $row->version,
                'status' => $row->status->value,
                'fixture' => isAnnouncementFixture($row->payload),
            ])->values()->all());
            if (is_string($plan)) {
                refuse($plan);
            }
            if ($plan['supersede'] !== null) {
                DB::table('config_versions')->where('key', ConfigKey::Announcements->value)->where('version', $plan['supersede'])
                    ->update(['status' => ConfigVersionStatus::Superseded->value]);
            }
            $fixture = new ConfigVersion;
            $fixture->forceFill([
                'key' => ConfigKey::Announcements->value,
                'version' => $plan['version'],
                'status' => ConfigVersionStatus::Published,
                'revision' => 1,
                'base_version' => $plan['supersede'],
                'payload' => $payload,
                'created_by' => $staff->getKey(),
                'published_by' => $staff->getKey(),
                'published_at' => now(),
                'reason' => ANNOUNCEMENT_FIXTURE_REASON.' ('.$kind.')',
            ])->save();

            return ['version' => $plan['version'], 'base' => $plan['supersede']];
        });
        flushPublishedConfig();
        $live = app(ConfigVersions::class)->live(ConfigKey::Announcements);
        if ($live === null || (int) $live->version !== $made['version']) {
            refuse('the fixture version v'.$made['version'].' is not the live announcements version (live: v'.($live?->version ?? '-').')');
        }
        finish(['id' => $item['id'], ...$made, 'draft' => app(ConfigVersions::class)->draft(ConfigKey::Announcements)?->version]);

    case 'remove-announcement-fixture':
        finish(removeAnnouncementFixture());

    case 'announcement-fixture-plan':
        // Pure, for the harness self-test: the plan for the rows given as JSON (version, status, fixture).
        $given = json_decode($args[0] ?? '[]', true, 8, JSON_THROW_ON_ERROR);
        $plan = announcementFixturePlan(is_array($given) ? array_values($given) : []);
        finish(is_string($plan) ? ['refused' => $plan] : $plan);

    case 'announcements-state':
        finish(announcementsState());

    case 'ensure-reconsent-fixture':
        // CONSENT (stage fixture): a version of AGB and of Datenschutz with requires_reconsent, in both locales, published at a fixed time
        // after the seeded current version, with the current body (so SET-18 would read the same text) and a summary of the change; and
        // consent.fixture, who accepted the version current before it. The version is the one above every row of that document, drafts
        // included (the seeded Datenschutz draft of ADM-31 stays untouched); refuses when the seeded texts are not what it expects
        // (a version published at or after the fixture's time, a version that is no whole number), rather than hide or change a real text.
        removeReconsentFixture();
        $at = CarbonImmutable::parse(RECONSENT_FIXTURE_PUBLISHED_AT, 'UTC');
        $accepted = [];
        $versions = [];
        $made = 0;
        DB::transaction(function () use ($at, &$accepted, &$versions, &$made): void {
            /** @var list<string> $locales */
            $locales = array_values(config()->array('speedclub.locales'));
            $keys = array_map(fn (LegalDocumentKey $key): string => $key->value, LegalDocuments::RECONSENT);
            $rows = LegalDocument::query()->whereIn('key', $keys)->lockForUpdate()->get()
                ->map(fn (LegalDocument $document): array => [
                    'key' => $document->key->value,
                    'locale' => (string) $document->locale,
                    'version' => (string) $document->version,
                    'published_at' => $document->published_at?->utc()->format('Y-m-d H:i:s'),
                    'reason' => $document->reason,
                ])->all();
            $plan = reconsentFixturePlan(array_values($rows), $keys, $locales, $at);
            if (is_string($plan)) {
                refuse($plan);
            }
            ['versions' => $versions, 'accepted' => $accepted] = $plan;
            foreach (LegalDocuments::RECONSENT as $key) {
                foreach ($locales as $locale) {
                    $current = LegalDocument::query()->where('key', $key)->where('locale', $locale)->whereNotNull('published_at')
                        ->orderByDesc('published_at')->orderByDesc('id')->firstOrFail();
                    $document = new LegalDocument([
                        'key' => $key,
                        'locale' => $locale,
                        'version' => $versions[$key->value],
                        'body_md' => (string) $current->getRawOriginal('body_md'),
                        'summary' => RECONSENT_FIXTURE_SUMMARIES[$key->value][$locale] ?? null,
                        'reason' => RECONSENT_FIXTURE_REASON,
                    ]);
                    $document->forceFill(['requires_reconsent' => true, 'published_at' => $at, 'created_at' => $at, 'updated_at' => $at])->save();
                    $made++;
                }
            }
        });
        $user = fixtureMember('consent.fixture'.E2E_DOMAIN, 'jana.vogt', 'Jana Vogt', 'Freiburg');
        $user->forceFill([
            'terms_version' => $accepted[LegalDocumentKey::Terms->value],
            'privacy_version' => $accepted[LegalDocumentKey::Privacy->value],
            'consented_at' => CarbonImmutable::parse('2026-10-30 12:30:00', 'UTC'),
        ])->save();
        app(AppConfig::class)->flush();
        finish(['email' => $user->email, 'documents' => $made, 'accepted' => $accepted, 'reconsent' => $versions]);

    case 'remove-reconsent-fixture':
        // The account goes with delete-accounts consent.fixture.
        finish(['removed' => removeReconsentFixture()]);

    case 'reconsent-fixture-plan':
        // Pure, for the harness self-test: the plan for the rows given as JSON (key, locale, version, published_at, reason).
        $given = json_decode($args[0] ?? '[]', true, 8, JSON_THROW_ON_ERROR);
        $plan = reconsentFixturePlan(is_array($given) ? array_values($given) : [], ['terms', 'privacy'], ['de', 'en'], CarbonImmutable::parse(RECONSENT_FIXTURE_PUBLISHED_AT, 'UTC'));
        finish(is_string($plan) ? ['refused' => $plan] : $plan);

    case 'legal-documents-state':
        finish(legalDocumentsState());

    case 'ensure-support-fixture':
        // SET-15a / SET-15b (stage fixture): support.fixture with exactly the requests of SUPPORT_FIXTURE_TICKETS, made again on every
        // call. Written directly at their fixed times (no receipt mail is queued, nothing is audited); the team's reply carries the seeded
        // support account when there is one. The tickets go with the account (delete-accounts support.fixture), so ADM-25 never lists
        // them outside the stage.
        $user = fixtureMember('support.fixture'.E2E_DOMAIN, 'jonas.civic', 'Jonas Keller', 'Dresden');
        $ids = array_column(SUPPORT_FIXTURE_TICKETS, 'id');
        $agent = Staff::query()->where('email', 'support@'.DemoSeeder::EMAIL_DOMAIN)->first();
        DB::transaction(function () use ($user, $ids, $agent): void {
            DB::table('support_tickets')->where('user_id', $user->getKey())->orWhereIn('id', $ids)->delete();
            foreach (SUPPORT_FIXTURE_TICKETS as $spec) {
                $last = collect($spec['messages'])->max('at');
                $answered = collect($spec['messages'])->contains(fn (array $m): bool => $m['author'] === 'team');
                $ticket = new SupportTicket(['category' => SupportCategory::from($spec['category']), 'subject' => $spec['subject'], 'locale' => 'de']);
                $ticket->forceFill([
                    'id' => $spec['id'],
                    'user_id' => $user->getKey(),
                    'source' => SupportTicketSource::App,
                    'status' => SupportTicketStatus::from($spec['status']),
                    'assigned_staff_id' => $answered ? $agent?->getKey() : null,
                    'last_activity_at' => $last,
                    'created_at' => $spec['created_at'],
                    'updated_at' => $last,
                ])->save();
                foreach ($spec['messages'] as $m) {
                    $team = $m['author'] === 'team';
                    $message = new TicketMessage(['body' => $m['body']]);
                    $message->forceFill([
                        'id' => $m['id'],
                        'ticket_id' => $ticket->getKey(),
                        'author_type' => $team ? TicketAuthorType::Staff : TicketAuthorType::Member,
                        'user_id' => $team ? null : $user->getKey(),
                        'staff_id' => $team ? $agent?->getKey() : null,
                        'internal' => false,
                        'mailed_at' => null,
                        'created_at' => $m['at'],
                    ])->save();
                }
            }
        });
        finish(['email' => $user->email, 'tickets' => $ids]);

    default:
        refuse('usage: backend.php reset-limits|age-codes|ensure-onboarding|create-member|delete-accounts|close-updates|qr-scans|set-discoverable|set-who-can-message|run-test-jobs|decide-test-case|ensure-sessions-fixture|ensure-staff|delete-staff|reset-staff-limits|seeded-audit-event|start-view-as|ensure-decisions-fixture|ensure-two-factor-fixture|ensure-approvals-fixture|publish-announcement-fixture|remove-announcement-fixture|announcement-fixture-plan|announcements-state|ensure-reconsent-fixture|remove-reconsent-fixture|reconsent-fixture-plan|legal-documents-state|ensure-support-fixture|remove-branding-fixture|branding-state|enable-premium-fixture|disable-premium-fixture|run-health-fixture|remove-health-fixture|remove-maintenance-fixture');
}
