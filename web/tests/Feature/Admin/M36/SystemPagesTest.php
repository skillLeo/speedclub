<?php

use App\Models\AuditEvent;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Helpers.php';

/**
 * ADM-48…50 (m3.6-contract §1/§3), lane a: pages by system.view / integrations.view, retry and forget by system.jobs with a recent
 * password, job payloads never in a prop (class names only), integrations never showing a configured value.
 */
beforeEach(fn () => Mail::fake());

function adm36FailedJob(string $secret = 'geheimer-token-4711'): string
{
    $uuid = (string) Str::uuid();
    DB::table('failed_jobs')->insert([
        'uuid' => $uuid,
        'connection' => 'database',
        'queue' => 'default',
        'payload' => json_encode(['uuid' => $uuid, 'displayName' => 'App\\Jobs\\BuildDataExport', 'job' => 'Illuminate\\Queue\\CallQueuedHandler@call', 'data' => ['command' => "O:8:\"stdClass\":1:{s:5:\"token\";s:19:\"{$secret}\";}"]]),
        'exception' => "RuntimeException: Mail to lena@beispiel.test failed with {$secret} in /var/www/app.php:12",
        'failed_at' => now(),
    ]);

    return $uuid;
}

describe('authorisation matrix', function () {
    it('guards the System pages', function (string $uri, string $component) {
        assertAdminMatrix('GET', $uri, ADM36_OWNER_ADMIN, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->component($component)));
    })->with([
        'ADM-48' => ['/admin/system/health', 'System/Health'],
        'ADM-49' => ['/admin/system/jobs', 'System/Jobs'],
        'ADM-50' => ['/admin/system/integrations', 'System/Integrations'],
    ]);

    it('guards the System writes', function (string $method, string $uri, array $data) {
        adm32WriteMatrix($method, $uri, ADM36_OWNER_ADMIN, $data);
    })->with([
        'retry' => ['POST', '/admin/system/jobs/retry', ['ids' => ['5b6c1a8e-7a7f-4c1d-9b1a-6f0f2f1a1b2c']]],
        'forget' => ['POST', '/admin/system/jobs/forget', ['ids' => ['5b6c1a8e-7a7f-4c1d-9b1a-6f0f2f1a1b2c']]],
        'test mail' => ['POST', '/admin/system/integrations/mail/test', []],
        'test push' => ['POST', '/admin/system/integrations/push/test', []],
    ]);
});

describe('ADM-49 jobs', function () {
    it('shows class names only, never a payload or an exception message', function () {
        adm36FailedJob();
        adm36As('admin');

        $response = $this->get('/admin/system/jobs')->assertOk();
        $response->assertInertia(fn (AssertableInertia $p) => $p->where('counts.failed', 1)->where('failed.0.job', 'App\\Jobs\\BuildDataExport')->where('failed.0.exception', 'RuntimeException')->where('canManage', true));

        expect(adm36PropsJson($response))->not->toContain('geheimer-token-4711')->not->toContain('lena@beispiel.test')->not->toContain('stdClass');
    });

    it('forgets with a recent password and audits counts only', function () {
        $uuid = adm36FailedJob();
        adm36As('admin');
        adm36StalePassword();
        $this->post('/admin/system/jobs/forget', ['ids' => [$uuid]])->assertSessionHas('confirm_password', true);
        expect(DB::table('failed_jobs')->count())->toBe(1);

        adm36As('admin');
        $this->post('/admin/system/jobs/forget', ['ids' => [$uuid]])->assertSessionHas('success', 'system.flash.forgotten');
        expect(DB::table('failed_jobs')->count())->toBe(0)
            ->and(json_encode(AuditEvent::query()->where('action', 'system.jobs_forgotten')->sole()->after))->not->toContain('geheimer-token-4711');
    });
});

describe('ADM-48 health', function () {
    it('shows the empty report before the first run and runs the checks on demand', function () {
        adm36As('admin');

        $this->get('/admin/system/health')->assertInertia(fn (AssertableInertia $p) => $p->where('report.status', 'unknown')->where('report.checks', []));
        $this->post('/admin/system/health/run')->assertRedirect();
        $this->get('/admin/system/health')->assertInertia(fn (AssertableInertia $p) => $p->whereNot('report.status', 'unknown')->where('report.checks', fn ($checks) => count($checks) >= 15));
    });
});

describe('ADM-50 integrations', function () {
    it('never puts a configured secret, host or user into the props', function () {
        $values = [
            'mail.mailers.smtp.host' => 'smtp.geheim-host.test', 'mail.mailers.smtp.username' => 'smtp-user-4711', 'mail.mailers.smtp.password' => 'smtp-pass-4711',
            'broadcasting.connections.pusher.key' => 'pusher-key-4711', 'broadcasting.connections.pusher.secret' => 'pusher-secret-4711', 'broadcasting.connections.pusher.app_id' => 'pusher-app-4711',
            'speedclub.services.expo_access_token' => 'expo-token-4711', 'speedclub.services.turnstile_secret' => 'turnstile-secret-4711',
            'speedclub.services.turnstile_site_key' => 'turnstile-site-4711', 'speedclub.services.sentry_dsn' => 'https://sentry-dsn-4711@sentry.test/1',
            'ai.providers.anthropic.key' => 'ai-key-4711', 'speedclub.services.ai_provider' => 'anthropic',
        ];
        config($values);
        adm36As('admin');

        $response = $this->get('/admin/system/integrations')->assertOk();
        $json = adm36PropsJson($response);
        foreach ($values as $key => $value) {
            if ($key !== 'speedclub.services.ai_provider') {
                expect($json)->not->toContain($value);
            }
        }
        $response->assertInertia(fn (AssertableInertia $p) => $p->where('integrations', fn ($rows) => collect($rows)->firstWhere('key', 'turnstile')['configured'] === true
            && collect($rows)->firstWhere('key', 'push')['test'] === ['available' => false, 'reason' => 'no_device']));
    });

    it('refuses the push test with its reason and runs the AI test against the stand-in without a key', function () {
        config(['speedclub.services.ai_provider' => null]);
        adm36As('admin');

        $this->post('/admin/system/integrations/push/test')->assertSessionHas('error', __('team.refused.no_device'));
        $this->post('/admin/system/integrations/ai/test')->assertSessionHas('integration_test', fn ($outcome) => $outcome['key'] === 'ai' && $outcome['faked'] === true && ! array_key_exists('answer', $outcome));
    });
});
