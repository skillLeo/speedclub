<?php

use App\Enums\StaffStatus;
use App\Support\Doctor\DoctorResult;
use App\Support\Doctor\EnvironmentDoctor;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Http;

require_once __DIR__.'/../Staff/Helpers.php';

/**
 * speedclub:doctor (plan queue, SEC-P3-05): warns for TRUSTED_PROXIES=* together with ADMIN_IP_ALLOWLIST, and for an install without
 * any active Owner. Warnings, never blockers: the doctor exits 0.
 */
beforeEach(fn () => Http::fake());

function m3qDoctor(string $check): ?DoctorResult
{
    return collect(app(EnvironmentDoctor::class)->run())->firstWhere('check', $check);
}

it('warns when the admin allow-list meets TRUSTED_PROXIES=*', function () {
    config(['speedclub.staff.ip_allowlist' => ['203.0.113.10'], 'speedclub.trusted_proxies' => ['*']]);

    expect(m3qDoctor('Admin IP allow-list'))->level->value->toBe('warning')
        ->and(m3qDoctor('Admin IP allow-list')->detail)->toContain('TRUSTED_PROXIES=*')
        ->and(Artisan::call('speedclub:doctor'))->toBe(0);
});

it('accepts the allow-list with listed proxies, and an empty one outside production and staging', function (array $settings, string $environment, string $level) {
    config($settings);
    app()->detectEnvironment(fn () => $environment);

    expect(m3qDoctor('Admin IP allow-list')->level->value)->toBe($level);
})->with([
    'listed proxies' => [['speedclub.staff.ip_allowlist' => ['203.0.113.10'], 'speedclub.trusted_proxies' => ['10.0.0.0/8']], 'production', 'ok'],
    'empty, local' => [['speedclub.staff.ip_allowlist' => []], 'local', 'ok'],
    'empty, production' => [['speedclub.staff.ip_allowlist' => []], 'production', 'warning'],
]);

it('warns without an active Owner and is fine with one', function () {
    expect(m3qDoctor('Active Owner')->level->value)->toBe('warning');

    m31Roles();
    expect(m3qDoctor('Active Owner')->level->value)->toBe('warning');

    m31Staff('owner', attributes: ['status' => StaffStatus::Suspended]);
    m31Staff('owner', attributes: ['password_proof_required' => true]);
    m31Staff('admin');
    expect(m3qDoctor('Active Owner')->level->value)->toBe('warning')
        ->and(m3qDoctor('Active Owner')->detail)->toContain('No active Owner');

    m31Staff('owner');
    expect(m3qDoctor('Active Owner')->level->value)->toBe('ok')
        ->and(Artisan::call('speedclub:doctor'))->toBe(0);
});
