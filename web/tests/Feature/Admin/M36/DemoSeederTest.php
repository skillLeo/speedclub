<?php

use App\Models\PrivacyRequest;
use App\Models\Role;
use Carbon\CarbonImmutable;
use Database\Seeders\StaffSeeder;
use Database\Seeders\TeamPrivacyDemoSeeder;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/Helpers.php';

it('seeds the M3.6 demo rows with fixed ids, and again without duplicates', function () {
    seedStaffRoles();
    $run = fn () => app(TeamPrivacyDemoSeeder::class)->run(CarbonImmutable::parse('2026-10-30 12:00:00'));
    $run();
    $run();

    expect(PrivacyRequest::query()->count())->toBe(5)
        ->and(PrivacyRequest::query()->findOrFail(TeamPrivacyDemoSeeder::ACCESS_REQUEST)->due_at->toDateString())->toBe('2026-11-04')
        ->and(Role::findByName('Community-Team', StaffSeeder::GUARD)->getAttribute('description'))->not->toBeNull()
        ->and(DB::table('failed_jobs')->where('uuid', TeamPrivacyDemoSeeder::FAILED_JOB)->count())->toBe(1);
});
