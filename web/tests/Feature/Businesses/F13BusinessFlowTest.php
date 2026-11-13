<?php

use App\Actions\Admin\Businesses\ReviewBusiness;
use App\Models\Business;
use App\Models\User;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/BusinessTestHelpers.php';
require_once __DIR__.'/../Admin/Support/helpers.php';

/**
 * F13 (09 §14.5), the API and Blade parts: a member applies → staff verifies in ADM-55 → member A tags the business on a mod → the
 * business accepts in BIZ-04 → the portfolio shows the build (API and /b/{slug}) → the Impressum is visible. The browser part (Playwright)
 * belongs to lane A with the BIZ screens.
 */
it('runs F13 from application to the portfolio on the public page', function () {
    bizFlags();
    $applicant = User::factory()->create(['username' => 'jana.werkstatt']);
    $memberA = User::factory()->create(['username' => 'paul.e30']);
    $mod = bizBuildWithMod($memberA);

    // 1. Apply (BIZ-02).
    Sanctum::actingAs($applicant);
    $slug = $this->postJson('/api/v1/me/business', bizBody(['vat_id' => 'DE123456789']), ['Idempotency-Key' => 'f13-apply-0001'])
        ->assertCreated()->assertJsonPath('data.status', 'applied')->json('data.slug');
    $business = Business::query()->where('slug', $slug)->firstOrFail();

    // 2. Staff verify (ADM-55).
    seedStaffRoles();
    actingAsStaff(staffWithRole('moderator'));
    $this->withSession(['auth.password_confirmed_at' => time()])
        ->post("/admin/businesses/{$business->id}/verify", ['version' => ReviewBusiness::version($business)])->assertSessionHas('success', 'businesses.flash.verified');

    // 3. Member A tags the business on a mod.
    Sanctum::actingAs($memberA);
    $tag = $this->putJson("/api/v1/mods/{$mod->id}/business-tag", ['business' => $slug])->assertCreated()->assertJsonPath('data.status', 'pending')->json('data.id');

    // 4. The business accepts (BIZ-04).
    Sanctum::actingAs($applicant);
    $this->getJson('/api/v1/me/business/tag-requests')->assertJsonPath('data.0.id', $tag);
    $this->patchJson("/api/v1/me/business/tag-requests/$tag", ['decision' => 'accepted'])->assertOk();

    // 5. The portfolio shows the build; 6. the Impressum is on the page.
    app('auth')->forgetGuards();
    $this->getJson("/api/v1/businesses/$slug/portfolio")->assertJsonPath('data.0.id', $mod->vehicle_id);
    $this->getJson("/api/v1/businesses/$slug")->assertJsonPath('data.portfolio_count', 1)->assertJsonPath('data.impressum.vat_id', 'DE123456789');
    $html = $this->get("/b/$slug", ['Accept-Language' => 'de'])->assertOk()->getContent();
    expect($html)->toContain('data-testid="WEB-10.build"')->toContain('data-testid="WEB-10.impressum"')->toContain('Fahrwerkstatt Elbe GmbH')->toContain('DE123456789');
});
