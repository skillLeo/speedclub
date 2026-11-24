<?php

use App\Actions\Admin\Members\RequestMemberDeletion;
use App\Enums\ApprovalEvent;
use App\Enums\ApprovalStatus;
use App\Enums\EventStatus;
use App\Enums\LegalDocumentKey;
use App\Enums\StaffSecurityEvent;
use App\Enums\UserStatus;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\ConfigVersion;
use App\Models\Event;
use App\Models\LegalDocument;
use App\Models\User;
use App\Services\Approvals\Approvals;
use App\Services\Config\Schemas\OrgSchema;
use App\Services\Governance\Governance;
use App\Services\Privacy\OrgIdentity;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Mail;

require_once __DIR__.'/../Support/helpers.php';
require_once __DIR__.'/../M32/Helpers.php';

/**
 * Client round 6 (ADR-540).
 * Item 1: the company data (ADM-52) as the client types it, every field, saved by an Owner without a reason, refused with a message
 * (never silently) for everyone else and for a stale password, and on /impressum and /datenschutz at once.
 * Item 2: governance optional. Four-eyes off by default (the action runs at once, audited as `approval.direct`), on again behaves as
 * before; staff 2FA Optional by default (sign-in without TOTP, own TOTP switched off with the password only), Pflicht as before.
 * The directory fixture publishes the strict governance (tests/Pest.php); each test here publishes what it is about.
 */
function r6Company(): array
{
    return [
        'company_name' => 'Schnellbau Fahrzeugkultur GmbH', 'legal_form' => 'GmbH', 'street' => 'Musterstraße 12', 'postal_city' => '10115 Berlin',
        'representative' => 'Jürgen Müller-Lüdenscheidt', 'responsible_person' => 'Jürgen Müller-Lüdenscheidt', 'contact_email' => 'kontakt@schnellbau-fahrzeugkultur.de',
        'phone' => '+49 (0) 30 1234567', 'support_email' => 'hilfe@schnellbau-fahrzeugkultur.de', 'privacy_email' => 'datenschutz@schnellbau-fahrzeugkultur.de',
        'dsa_email' => 'dsa@schnellbau-fahrzeugkultur.de', 'report_email' => 'meldung@schnellbau-fahrzeugkultur.de', 'register_court' => 'Amtsgericht Charlottenburg',
        'register_number' => 'HRB 123456 B', 'vat_id' => 'DE 123 456 789', 'supervisory_authority' => 'Landesamt für Bürger- und Ordnungsangelegenheiten Berlin',
        'default_locale' => 'de',
    ];
}

function r6LegalDocuments(): void
{
    LegalDocument::factory()->create([
        'key' => LegalDocumentKey::Imprint, 'locale' => 'de', 'version' => '1', 'published_at' => now()->subDay(),
        'body_md' => "[[Firmenname]]\n[[Anschrift]], [[PLZ und Ort]]\nVertreten durch [[Vertretungsberechtigte Person]]\n[[Registergericht]] [[Registernummer]]\nUSt-IdNr.: [[USt-IdNr.]]\nTelefon: [[phone]]",
    ]);
    LegalDocument::factory()->create([
        'key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => '1', 'published_at' => now()->subDay(),
        'body_md' => "Verantwortlich: [[Firmenname]], [[Anschrift]], [[PLZ und Ort]]\nDatenschutz: [[Datenschutz-E-Mail]]",
    ]);
}

describe('item 1: company data', function () {
    beforeEach(function () {
        OrgIdentity::forget();
    });

    it('saves every field as the client types it, without a reason, and shows it on /impressum and /datenschutz', function () {
        r6LegalDocuments();
        $this->get('/impressum')->assertOk()->assertSee('[[Firmenname]]', false);
        $owner = adm32SignedIn('owner');

        $this->patch('/admin/settings', ['values' => r6Company()])->assertRedirect()->assertSessionHas('success', 'settings.flash.saved')->assertSessionHasNoErrors();

        $version = ConfigVersion::query()->where('key', 'org')->where('status', 'published')->sole();
        expect($version->payload)->toMatchArray([...r6Company(), 'vat_id' => 'DE123456789'])
            ->and($version->published_by)->toBe($owner->id)
            ->and($version->reason)->toBeNull()
            ->and(AuditEvent::query()->where('action', 'config.published')->latest('id')->value('reason'))->toBeNull();

        $imprint = $this->get('/impressum')->assertOk();
        foreach (['Schnellbau Fahrzeugkultur GmbH', 'Musterstraße 12', '10115 Berlin', 'Jürgen Müller-Lüdenscheidt', 'Amtsgericht Charlottenburg', 'HRB 123456 B', 'DE123456789', '+49 (0) 30 1234567'] as $text) {
            $imprint->assertSee($text, false);
        }
        $imprint->assertDontSee('[[', false);
        $this->get('/datenschutz')->assertOk()->assertSee('Schnellbau Fahrzeugkultur GmbH', false)->assertSee('datenschutz@schnellbau-fahrzeugkultur.de', false)->assertDontSee('[[', false);

        // A second save publishes the next version and the legal pages follow at once (the org cache is forgotten).
        $this->patch('/admin/settings', ['values' => [...r6Company(), 'company_name' => 'Schnellbau Fahrzeugkultur UG']])->assertSessionHas('success', 'settings.flash.saved');
        expect(ConfigVersion::query()->where('key', 'org')->where('status', 'published')->sole()->version)->toBe(2);
        $this->get('/impressum')->assertSee('Schnellbau Fahrzeugkultur UG', false)->assertDontSee('Schnellbau Fahrzeugkultur GmbH', false);
    });

    it('normalises a VAT ID typed with spaces, dots, dashes or in lower case', function (string $typed) {
        expect(app(OrgSchema::class)->normalize(['vat_id' => $typed])['vat_id'])->toBe('DE123456789');
    })->with(['DE 123 456 789', 'de.123.456.789', 'DE-123-456-789', ' de 123456789 ']);

    it('names the field in German when a value is refused', function () {
        adm32SignedIn('owner');
        app()->setLocale('de');

        $this->patch('/admin/settings', ['values' => [...r6Company(), 'vat_id' => 'kaputt']])->assertSessionHasErrors(['vat_id' => __('content.org.vat_id')]);
        $this->patch('/admin/settings', ['values' => [...r6Company(), 'support_email' => 'keine-adresse']])->assertSessionHasErrors('support_email');
        expect(session('errors')->first('support_email'))->toContain('Support-E-Mail')
            ->and(ConfigVersion::query()->where('key', 'org')->exists())->toBeFalse();
    });

    it('lets only an Owner save: an Admin, who reads the page, gets a message, never silence (authz matrix)', function (string $role, string $outcome) {
        adm32SignedIn($role);

        // The page (Inertia).
        $page = $this->withHeader('X-Inertia', 'true')->patch('/admin/settings', ['values' => r6Company()]);
        match ($outcome) {
            'saved' => $page->assertSessionHas('success', 'settings.flash.saved'),
            // An Admin reads ADM-52 (staff.manage): back with the error in the dialog and as a toast.
            'told' => $page->assertStatus(303)->assertSessionHas('error', __('content.org.owner_only'))->assertSessionHasErrors('values'),
            // Without staff.manage the page itself is closed (the route's can:staff.manage): the admin's 403 page.
            default => $page->assertForbidden(),
        };

        if ($outcome !== 'saved') {
            // A JSON client gets the plain 403.
            $this->flushHeaders()->patchJson('/admin/settings', ['values' => r6Company()])->assertForbidden();
            expect(ConfigVersion::query()->where('key', 'org')->exists())->toBeFalse();
        }
    })->with([
        'owner' => ['owner', 'saved'], 'admin' => ['admin', 'told'], 'moderator' => ['moderator', 'forbidden'], 'support' => ['support', 'forbidden'],
        'content_editor' => ['content_editor', 'forbidden'], 'analyst' => ['analyst', 'forbidden'],
    ]);

    it('asks for the password again when the confirmation is stale, and saves nothing until then', function () {
        adm32SignedIn('owner');
        test()->withSession(['auth.password_confirmed_at' => time() - 3600]);

        $this->patch('/admin/settings', ['values' => r6Company()])->assertSessionHas('confirm_password', true);
        expect(ConfigVersion::query()->where('key', 'org')->exists())->toBeFalse();
    });
});

describe('item 2: four-eyes', function () {
    beforeEach(function () {
        Mail::fake();
        $this->withoutDefer();
    });

    it('is off and 2FA optional on a fresh install (no governance version)', function () {
        ConfigVersion::query()->where('key', 'governance')->delete();

        expect(Governance::fourEyes())->toBeFalse()
            ->and(Governance::twoFactorMode())->toBe(Governance::TWO_FACTOR_OPTIONAL)
            ->and(Governance::staffTwoFactorRequired())->toBeFalse();
    });

    it('runs an approval action at once while off, audited as a direct action', function () {
        publishGovernance(fourEyes: false);
        $member = User::factory()->create(['locale' => 'de']);
        $admin = adm32SignedIn('admin');

        $this->post("/admin/members/{$member->id}/delete", ['confirm' => 'LÖSCHEN'])->assertRedirect()->assertSessionHasNoErrors();

        $request = ApprovalRequest::query()->sole();
        expect($request->status)->toBe(ApprovalStatus::Executed)
            ->and($request->requested_by)->toBe($admin->id)
            ->and($request->decided_by)->toBe($admin->id)
            ->and($member->refresh()->status)->toBe(UserStatus::Deactivated)
            ->and(AuditEvent::query()->where('action', ApprovalEvent::Direct->value)->count())->toBe(1)
            ->and(AuditEvent::query()->where('action', ApprovalEvent::Requested->value)->exists())->toBeFalse()
            ->and(AuditEvent::query()->where('action', ApprovalEvent::Approved->value)->exists())->toBeFalse()
            ->and(AuditEvent::query()->where('action', ApprovalEvent::Direct->value)->value('reason'))->toBeNull()
            ->and(session('approval'))->toMatchArray(['direct' => true, 'status' => 'executed']);

        // No badge counts it, no list shows it.
        $this->get('/admin')->assertInertia(fn ($page) => $page->where('nav_counts.approvals_for_me', 0)->where('governance.four_eyes', false));
    });

    it('waits for a second person again once it is switched back on', function () {
        publishGovernance(fourEyes: true);
        $member = User::factory()->create(['locale' => 'de']);
        $admin = m31Staff('admin');

        $request = app(RequestMemberDeletion::class)->handle($admin, $member, '');

        expect($request->status)->toBe(ApprovalStatus::Pending)
            ->and($member->refresh()->status)->toBe(UserStatus::Active)
            ->and(AuditEvent::query()->where('action', ApprovalEvent::Requested->value)->count())->toBe(1);
    });

    it('still refuses what one person may never do alone while off: an Owner-only action by an Admin', function () {
        publishGovernance(fourEyes: false);
        $admin = m31Staff('admin');
        $target = m31Staff('support');

        expect(fn () => app(Approvals::class)->request('staff.role_elevation', ['staff_id' => $target->id, 'roles' => ['owner'], 'before' => ['support']], '', $admin))
            ->toThrow(AuthorizationException::class)
            ->and($target->refresh()->hasRole('owner'))->toBeFalse()
            ->and(ApprovalRequest::query()->exists())->toBeFalse();
    });

    it('lets an Owner switch four-eyes and the 2FA mode, audited; nobody else', function (string $role, bool $allowed) {
        publishGovernance(fourEyes: false);
        adm32SignedIn($role);

        $response = $this->patchJson('/admin/settings/governance', ['owner_override' => true, 'four_eyes' => true, 'staff_two_factor' => 'required']);

        if (! $allowed) {
            $response->assertForbidden();
            expect(Governance::fourEyes())->toBeFalse();

            return;
        }

        expect(Governance::fourEyes())->toBeTrue()
            ->and(Governance::staffTwoFactorRequired())->toBeTrue()
            ->and(AuditEvent::query()->where('action', ApprovalEvent::FourEyesSwitched->value)->count())->toBe(1)
            ->and(AuditEvent::query()->where('action', StaffSecurityEvent::TwoFactorPolicyChanged->value)->count())->toBe(1);
    })->with(['owner' => ['owner', true], 'admin' => ['admin', false], 'moderator' => ['moderator', false], 'analyst' => ['analyst', false]]);
});

describe('item 2: no reason', function () {
    it('accepts an admin write without a reason and records null', function () {
        publishGovernance(fourEyes: false);
        adm32SignedIn('owner');

        $this->patch('/admin/settings/governance', ['owner_override' => false])->assertSessionHas('success', 'settings.flash.governance_saved');

        expect(ConfigVersion::query()->where('key', 'governance')->where('status', 'published')->sole()->payload)->toEqual(['owner_override' => false, 'four_eyes' => false, 'staff_two_factor' => 'optional'])
            ->and(AuditEvent::query()->where('action', ApprovalEvent::OwnerOverrideSwitched->value)->sole()->reason)->toBeNull();
    });

    it('keeps the reason the member reads required (DSA): an event rejection without one is refused', function () {
        adm32SignedIn('moderator');
        $event = Event::factory()->create(['status' => EventStatus::PendingReview]);

        $this->post("/admin/events/{$event->id}/reject", ['version' => 'x'])->assertSessionHasErrors('reason');
    });
});

describe('item 2: staff 2FA', function () {
    it('lets an account without TOTP into the admin while Optional, and sends it to enrolment in Pflicht', function () {
        publishGovernance(fourEyes: false, staffTwoFactor: 'optional');
        seedStaffRoles();
        $staff = staffWithRole('admin', totp: false);
        actingAsStaff($staff);

        $this->get('/admin')->assertOk();
        // The steps that need a code it has not got stay closed.
        $this->postJson('/admin/account/recovery-codes', ['code' => '123456'])->assertStatus(409)->assertJsonPath('code', 'two_factor_required');

        publishGovernance(fourEyes: false, staffTwoFactor: 'required');
        $this->get('/admin')->assertRedirect('/admin/two-factor/setup');
    });

    it('signs an account without TOTP in with the password alone while Optional', function () {
        publishGovernance(fourEyes: false, staffTwoFactor: 'optional');
        seedStaffRoles();
        $staff = staffWithRole('admin', totp: false);

        $this->postJson('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])->assertOk()->assertJson(['two_factor' => false]);
        $this->get('/admin')->assertOk();
    });

    it('lets a staff member switch their own TOTP off with the password only, while Optional', function () {
        publishGovernance(fourEyes: false, staffTwoFactor: 'optional');
        $staff = adm32SignedIn('support');

        $this->delete('/admin/account/two-factor')->assertRedirect()->assertSessionHas('success', 'account.flash.two_factor_disabled');

        $staff->refresh();
        expect($staff->hasEnabledTwoFactorAuthentication())->toBeFalse()
            ->and($staff->getRawOriginal('two_factor_secret'))->toBeNull()
            ->and($staff->getRawOriginal('two_factor_recovery_codes'))->toBeNull()
            ->and(AuditEvent::query()->where('action', StaffSecurityEvent::TwoFactorDisabled->value)->where('actor_id', (string) $staff->id)->count())->toBe(1);
    });

    it('refuses switching TOTP off in Pflicht, with a stale password, or without TOTP', function () {
        publishGovernance(fourEyes: false, staffTwoFactor: 'required');
        $staff = adm32SignedIn('support');
        $this->delete('/admin/account/two-factor')->assertForbidden();

        publishGovernance(fourEyes: false, staffTwoFactor: 'optional');
        test()->withSession(['auth.password_confirmed_at' => time() - 3600]);
        $this->delete('/admin/account/two-factor')->assertSessionHas('confirm_password', true);
        expect($staff->refresh()->hasEnabledTwoFactorAuthentication())->toBeTrue();

        $plain = staffWithRole('support', totp: false);
        actingAsStaff($plain);
        test()->withSession(['auth.password_confirmed_at' => time()]);
        $this->deleteJson('/admin/account/two-factor')->assertStatus(409);
    });
});
