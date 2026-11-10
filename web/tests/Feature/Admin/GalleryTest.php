<?php

use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Support/helpers.php';

/* Admin gallery (contract §2.4): local and testing only, staff with TOTP. */

it('opens for every role with TOTP in testing', function () {
    assertAdminMatrix('GET', '/admin/dev/gallery', ADMIN_ROLES, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->component('Dev/Gallery')));
});

it('is not registered outside local and testing', function () {
    $routes = file_get_contents(base_path('routes/admin/dev.php'));

    expect($routes)->toContain("app()->environment(['local', 'testing'])");
});

it('refuses itself outside local and testing even if the route were cached elsewhere', function () {
    seedStaffRoles();
    app()->detectEnvironment(fn (): string => 'production');

    assertAdminErrorPage(actingAsStaff(staffWithRole('owner'))->get('/admin/dev/gallery'), 404);
});
