<?php

use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Enums\LegalDocumentKey;
use App\Enums\StaffStatus;
use App\Models\AuditEvent;
use App\Models\ConfigVersion;
use App\Models\LegalDocument;
use App\Services\Privacy\OrgIdentity;

require_once __DIR__.'/../M32/Helpers.php';

/**
 * ADM-52 company data over HTTP (client report 2026-11-23: "I can't save the company data"). The Owner saves through the real route
 * (FormRequest, recent password, config engine) and the Impressum shows the value at once, also when it was rendered (and the org
 * cached) before the save; an Admin reads the page and is told who can change it; every other role and a guest are refused.
 */
function orgHttpValues(array $values = []): array
{
    return [
        ...array_fill_keys(OrgIdentity::FIELDS, null),
        'company_name' => 'Nachtfahrt Media GmbH', 'street' => 'Hafenstraße 12', 'postal_city' => '20457 Hamburg',
        'contact_email' => 'kontakt@speedclub.de', 'vat_id' => 'de 123 456 789', 'default_locale' => 'de',
        ...$values,
    ];
}

function orgHttpImprint(string $body = "# Impressum\n\n[[Firmenname]]\n\n[[Anschrift]], [[PLZ und Ort]]\n\nUSt-IdNr.: [[USt-IdNr.]]"): LegalDocument
{
    return LegalDocument::factory()->create([
        'key' => LegalDocumentKey::Imprint, 'locale' => 'de', 'version' => '1', 'published_at' => now()->subDay(), 'body_md' => $body,
    ]);
}

function orgHttpPublished(): int
{
    return ConfigVersion::query()->where('key', ConfigKey::Org->value)->where('status', ConfigVersionStatus::Published)->count();
}

beforeEach(function () {
    OrgIdentity::forget();
});

describe('ADM-52 page', function () {
    it('opens for the Owner (editable) and the Admin (read-only), refuses every other role', function (string $role, int $status, ?bool $canEdit) {
        adm32SignedIn($role);
        $response = $this->get('/admin/settings');

        $response->assertStatus($status);
        if ($canEdit !== null) {
            $response->assertInertia(fn ($page) => $page->component('Settings/Index')->where('canEdit', $canEdit));
        }
    })->with([
        'owner' => ['owner', 200, true], 'admin' => ['admin', 200, false], 'moderator' => ['moderator', 403, null],
        'support' => ['support', 403, null], 'content_editor' => ['content_editor', 403, null], 'analyst' => ['analyst', 403, null],
    ]);

    it('sends a guest to the sign-in', function () {
        $this->get('/admin/settings')->assertRedirect();
        $this->patch('/admin/settings', ['values' => orgHttpValues(), 'reason' => 'Firmendaten für das Impressum eingetragen.'])->assertRedirect();

        expect(orgHttpPublished())->toBe(0);
    });

    it('tells an Admin which Owners can change the company data (the client used an Admin account)', function () {
        seedStaffRoles();
        $owner = staffWithRole('owner');
        $owner->forceFill(['name' => 'Lena Weber'])->save();
        $second = staffWithRole('owner');
        $second->forceFill(['name' => 'Jonas Brandt'])->save();
        $disabled = staffWithRole('owner');
        $disabled->forceFill(['name' => 'Ehemals Owner', 'status' => StaffStatus::Deactivated, 'deactivated_at' => now()])->save();
        $admin = adm32SignedIn('admin');
        $admin->forceFill(['name' => 'Demo Admin'])->save();

        $this->get('/admin/settings')->assertInertia(fn ($page) => $page
            ->where('canEdit', false)
            // The seeded Owner of seedStaffRoles() is listed too; the deactivated Owner and the Admin are not. Sorted by name.
            ->where('owners', fn ($owners) => ($list = collect($owners)->values())->contains('Jonas Brandt') && $list->contains('Lena Weber')
                && ! $list->contains('Ehemals Owner') && ! $list->contains('Demo Admin') && $list->all() === $list->sort()->values()->all()));
    });

    it('gives the Owner no owner list to read (they can save themselves)', function () {
        adm32SignedIn('owner');

        $this->get('/admin/settings')->assertInertia(fn ($page) => $page->where('canEdit', true)->where('owners', []));
    });
});

describe('ADM-52 save', function () {
    it('lets only an Owner save; every other role hears 403 and nothing is published', function (string $role, bool $allowed) {
        adm32SignedIn($role);
        $response = $this->from('/admin/settings')->patch('/admin/settings', ['values' => orgHttpValues(), 'reason' => 'Firmendaten für das Impressum eingetragen.']);

        if ($allowed) {
            $response->assertStatus(303)->assertSessionHas('success', 'settings.flash.saved')->assertSessionHasNoErrors();
            expect(orgHttpPublished())->toBe(1);
        } else {
            $response->assertStatus(403);
            expect(orgHttpPublished())->toBe(0);
        }
    })->with([
        'owner' => ['owner', true], 'admin' => ['admin', false], 'moderator' => ['moderator', false], 'support' => ['support', false],
        'content_editor' => ['content_editor', false], 'analyst' => ['analyst', false],
    ]);

    it('shows the saved company data on the Impressum at once, also when it was rendered before the save', function () {
        orgHttpImprint();
        adm32SignedIn('owner');

        // The Impressum before the save: placeholders, and the (empty) org cached.
        $this->get('/impressum', ['Accept-Language' => 'de'])->assertOk()->assertSee('[[Firmenname]]', false);

        $this->from('/admin/settings')->patch('/admin/settings', ['values' => orgHttpValues(), 'reason' => 'Firmendaten für das Impressum eingetragen.'])
            ->assertSessionHas('success', 'settings.flash.saved');

        $this->get('/impressum', ['Accept-Language' => 'de'])->assertOk()
            ->assertSee('Nachtfahrt Media GmbH')
            ->assertSee('Hafenstraße 12, 20457 Hamburg')
            ->assertSee('DE123456789')
            ->assertDontSee('[[Firmenname]]', false);

        expect(AuditEvent::query()->where('action', 'config.published')->latest('id')->firstOrFail()->reason)->toBe('Firmendaten für das Impressum eingetragen.');
    });

    it('fills placeholders written with the field key, as the legal editor hint names them ([[company_name]])', function () {
        orgHttpImprint("# Impressum\n\n[[company_name]]\n\n[[street]], [[postal_city]]\n\n[[Datum]]");
        adm32SignedIn('owner');

        $this->from('/admin/settings')->patch('/admin/settings', ['values' => orgHttpValues(), 'reason' => 'Firmendaten für das Impressum eingetragen.'])
            ->assertSessionHas('success');

        $this->get('/impressum', ['Accept-Language' => 'de'])->assertOk()
            ->assertSee('Nachtfahrt Media GmbH')
            ->assertSee('Hafenstraße 12, 20457 Hamburg')
            ->assertSee('[[Datum]]', false);
    });

    it('answers a bad field and a stale password confirmation where the dialog shows them, and publishes nothing', function () {
        adm32SignedIn('owner');

        // ADR-540: a missing reason is no longer an error (the save itself is GovernanceOptionalTest's).
        $this->from('/admin/settings')->patch('/admin/settings', ['values' => orgHttpValues(['support_email' => 'hilfe@']), 'reason' => 'Firmendaten für das Impressum eingetragen.'])
            ->assertSessionHasErrors('support_email');
        $this->withSession(['auth.password_confirmed_at' => time() - 3600])->from('/admin/settings')
            ->patch('/admin/settings', ['values' => orgHttpValues(), 'reason' => 'Firmendaten für das Impressum eingetragen.'])
            ->assertStatus(303)->assertSessionHas('confirm_password', true);

        expect(orgHttpPublished())->toBe(0);
    });

    it('says so when the values equal the live ones instead of failing silently', function () {
        adm32SignedIn('owner');
        $this->from('/admin/settings')->patch('/admin/settings', ['values' => orgHttpValues(), 'reason' => 'Firmendaten für das Impressum eingetragen.'])->assertSessionHas('success');

        $this->from('/admin/settings')->patch('/admin/settings', ['values' => orgHttpValues(), 'reason' => 'Firmendaten noch einmal gespeichert.'])
            ->assertStatus(303)->assertSessionHas('error', 'config.refused.unchanged');

        expect(orgHttpPublished())->toBe(1);
    });
});
