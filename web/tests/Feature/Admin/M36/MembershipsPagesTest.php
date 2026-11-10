<?php

use App\Models\Entitlement;
use App\Models\FeatureFlag;
use App\Models\MembershipPlan;
use App\Models\User;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Helpers.php';

/**
 * ADM-F1/F2 (m3.6-contract §1/§3), lane a: while `premium.enabled` is off every route answers 404 to everyone (before the atom) and the
 * nav atom is withheld from the UI; with it on the pages and writes follow memberships.manage, grant and revoke need a reason.
 */
function adm36Plan(): MembershipPlan
{
    return MembershipPlan::query()->forceCreate(['key' => 'club-plus', 'name' => ['de' => 'Club Plus', 'en' => 'Club Plus'], 'features' => ['de' => ['Mehr Fotos pro Fahrzeug'], 'en' => ['More photos per vehicle']], 'active' => true, 'sort' => 0]);
}

describe('with premium.enabled off', function () {
    it('answers 404 on every route, for every role', function (string $method, string $uri) {
        adm36Premium(false);
        foreach (ADM36_EVERYONE as $role) {
            adm36As($role);
            assertAdminErrorPage($this->call($method, $uri, ['reason' => adm36Reason()]), 404);
        }
    })->with([
        ['GET', '/admin/memberships/plans'],
        ['GET', '/admin/memberships/entitlements'],
        ['POST', '/admin/memberships/plans'],
        ['POST', '/admin/memberships/entitlements'],
    ]);

    it('keeps memberships.manage out of the permissions the UI gets, so the nav hides the entries', function () {
        FeatureFlag::query()->where('key', 'premium.enabled')->delete();
        adm36As('owner');
        $this->get('/admin/account')->assertInertia(fn (AssertableInertia $p) => $p->where('staff.permissions', fn ($atoms) => ! collect($atoms)->contains('memberships.manage') && collect($atoms)->contains('staff.manage')));

        adm36Premium();
        $this->get('/admin/account')->assertInertia(fn (AssertableInertia $p) => $p->where('staff.permissions', fn ($atoms) => collect($atoms)->contains('memberships.manage')));
    });
});

describe('with premium.enabled on', function () {
    beforeEach(fn () => adm36Premium());

    it('guards the pages by memberships.manage', function (string $uri, string $component) {
        assertAdminMatrix('GET', $uri, ADM36_OWNER_ADMIN, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->component($component)));
    })->with([
        'ADM-F1' => ['/admin/memberships/plans', 'Memberships/Plans'],
        'ADM-F2' => ['/admin/memberships/entitlements', 'Memberships/Entitlements'],
    ]);

    it('guards the writes by memberships.manage', function (string $method, string $uri, array $data) {
        $plan = adm36Plan();
        adm32WriteMatrix($method, str_replace('{plan}', (string) $plan->id, $uri), ADM36_OWNER_ADMIN, $data);
    })->with([
        'create plan' => ['POST', '/admin/memberships/plans', ['key' => 'garage-pro', 'name' => ['de' => 'Garage Pro'], 'features' => ['de' => []], 'active' => true]],
        'edit plan' => ['PATCH', '/admin/memberships/plans/{plan}', ['name' => ['de' => 'Club Plus'], 'features' => ['de' => []], 'active' => false]],
        'grant' => ['POST', '/admin/memberships/entitlements', ['member' => 'niemand', 'plan_id' => 1, 'reason' => 'Gewinner der Build-Challenge.']],
    ]);

    it('lists plans with holders and grants and revokes with a reason', function () {
        $plan = adm36Plan();
        $member = User::factory()->create(['username' => 'lukas.f2']);
        adm36As('admin');

        $this->post('/admin/memberships/entitlements', ['member' => '@lukas.f2', 'plan_id' => $plan->id])->assertSessionHasErrors('reason');
        $this->post('/admin/memberships/entitlements', ['member' => '@lukas.f2', 'plan_id' => $plan->id, 'reason' => 'Gewinner der Build-Challenge.'])->assertSessionHas('success', 'memberships.flash.granted');

        $this->get('/admin/memberships/plans')->assertInertia(fn (AssertableInertia $p) => $p->where('plans.0.holders', 1));
        $entitlement = Entitlement::query()->where('user_id', $member->id)->sole();
        $this->get('/admin/memberships/entitlements')->assertInertia(fn (AssertableInertia $p) => $p->where('entitlements.0.id', $entitlement->id)->where('entitlements.0.reason', 'Gewinner der Build-Challenge.'));

        $this->post("/admin/memberships/entitlements/{$entitlement->id}/revoke", ['reason' => 'Doppelt vergeben, bereinigt.'])->assertSessionHas('success', 'memberships.flash.revoked');
        expect($entitlement->fresh()->revoked_at)->not->toBeNull();
    });
});
