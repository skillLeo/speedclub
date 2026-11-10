<?php

use App\Enums\StaffSecurityEvent;
use App\Models\AuditEvent;
use App\Models\ConfigVersion;
use App\Services\Privacy\OrgIdentity;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Helpers.php';

/**
 * ADM-51 my account and ADM-52 org settings (m3.6-contract §1/§3, ADR-238/239, SEC-P1-36/39), lane a: every staff member reaches their
 * account; the code steps answer no-store JSON only, need a current code and a recent password, and nothing secret is ever a prop;
 * org settings are readable with staff.manage and saved by an Owner only, with reason and recent password.
 */
beforeEach(fn () => Mail::fake());

describe('ADM-51 my account', function () {
    it('opens for every role and carries nothing secret', function () {
        assertAdminMatrix('GET', '/admin/account', ADM36_EVERYONE, function (TestResponse $r): void {
            $r->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->component('Account/Index')->has('account.email')->has('sessions')->where('qaSample', null));
            expect(adm36PropsJson($r))->not->toContain('two_factor_secret')->not->toContain('recovery');
        });
    });

    it('starts a rotation only with a current code, answers no-store JSON and refuses an Inertia visit', function () {
        $staff = adm36As('support');

        $this->postJson('/admin/account/two-factor/rotation', ['code' => '000000'])->assertStatus(422)->assertJsonPath('code', 'code_invalid')->assertHeader('Cache-Control', 'no-store, private');
        $this->post('/admin/account/two-factor/rotation', ['code' => adm36Code($staff)], ['X-Inertia' => 'true'])->assertStatus(409);

        $answer = $this->postJson('/admin/account/two-factor/rotation', ['code' => adm36Code($staff)])->assertOk()->assertHeader('Cache-Control', 'no-store, private');
        expect($answer->json('secret'))->toHaveLength(32)->and($answer->json('qr_svg'))->toStartWith('<svg');

        // The page never gets the key again.
        $page = $this->get('/admin/account')->assertInertia(fn (AssertableInertia $p) => $p->whereNot('account.rotation_expires_at', null));
        expect(adm36PropsJson($page))->not->toContain((string) $answer->json('secret'));
    });

    it('needs a recent password for the code steps', function (string $uri) {
        $staff = adm36As('support');
        adm36StalePassword();

        $this->postJson($uri, ['code' => adm36Code($staff)])->assertStatus(403)->assertJsonPath('code', 'password_confirmation_required');
    })->with(['/admin/account/two-factor/rotation', '/admin/account/two-factor/rotation/confirm', '/admin/account/recovery-codes', '/admin/account/recovery-codes/regenerate']);

    it('shows the recovery codes only after a current code, audited, no-store', function () {
        $staff = adm36As('support');

        $this->postJson('/admin/account/recovery-codes', ['code' => '000000'])->assertStatus(422);
        $codes = $this->postJson('/admin/account/recovery-codes', ['code' => adm36Code($staff)])->assertOk()->assertHeader('Cache-Control', 'no-store, private')->json('codes');

        expect($codes)->toHaveCount(8)
            ->and(AuditEvent::query()->where('action', StaffSecurityEvent::RecoveryCodesViewed->value)->exists())->toBeTrue()
            ->and(json_encode(AuditEvent::query()->where('action', StaffSecurityEvent::RecoveryCodesViewed->value)->sole()->after))->not->toContain($codes[0]);
    });

    it('signs out other sessions without a password, never the current one', function () {
        adm36As('support');

        $this->post('/admin/account/sessions/others')->assertSessionHas('success', 'account.flash.sessions_ended');
        $this->delete('/admin/account/sessions/'.str_repeat('a', 32))->assertSessionHas('error', __('team.refused.session_unknown'));
    });
});

describe('ADM-52 org settings', function () {
    it('opens for staff.manage, read-only for an Admin', function () {
        assertAdminMatrix('GET', '/admin/settings', ADM36_OWNER_ADMIN, fn (TestResponse $r, string $role) => $r->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->component('Settings/Index')
            ->where('canEdit', $role === 'owner')->has('fields', 17)->where('placeholders.company_name', 'Firmenname')));
    });

    it('lets only an Owner save, with a reason and a recent password', function () {
        adm32WriteMatrix('PATCH', '/admin/settings', ['owner'], ['values' => ['company_name' => 'SPEED CLUB GmbH'], 'reason' => 'Firmierung nach Eintragung.']);
    });

    it('publishes the org config and fills the legal placeholders', function () {
        adm36As('owner');

        $this->patch('/admin/settings', ['values' => ['vat_id' => 'kaputt'], 'reason' => adm36Reason()])->assertSessionHasErrors();
        $this->patch('/admin/settings', ['values' => ['company_name' => 'SPEED CLUB GmbH', 'support_email' => 'hilfe@speedclub.test', 'default_locale' => 'de'], 'reason' => adm36Reason()])
            ->assertSessionHas('success', 'settings.flash.saved');

        expect(app(OrgIdentity::class)->get('company_name'))->toBe('SPEED CLUB GmbH')
            ->and(app(OrgIdentity::class)->resolve('[[Firmenname]]'))->toBe('SPEED CLUB GmbH');

        adm36StalePassword();
        $this->patch('/admin/settings', ['values' => ['company_name' => 'Andere GmbH'], 'reason' => adm36Reason()])->assertSessionHas('confirm_password', true);
        expect(ConfigVersion::query()->where('key', 'org')->where('status', 'published')->count())->toBe(1);
    });
});
