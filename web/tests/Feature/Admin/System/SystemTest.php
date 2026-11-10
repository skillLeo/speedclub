<?php

use App\Actions\Admin\System\ManageFailedJobs;
use App\Actions\Admin\System\RunHealthChecks;
use App\Actions\Admin\System\RunIntegrationTest;
use App\Enums\SystemEvent;
use App\Mail\SystemTestMail;
use App\Models\AuditEvent;
use App\Services\System\Integrations;
use App\Services\System\JobsInspector;
use App\Services\System\SystemTestAgent;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

require_once __DIR__.'/../Team/TeamHelpers.php';

function m36FailedJob(string $secret = 'Geheime Nachricht an @lena: 482913'): string
{
    $uuid = (string) Str::uuid();
    DB::table('failed_jobs')->insert([
        'uuid' => $uuid, 'connection' => 'database', 'queue' => 'default',
        'payload' => json_encode(['uuid' => $uuid, 'displayName' => 'App\\Jobs\\DeliverPush', 'job' => 'Illuminate\\Queue\\CallQueuedHandler@call', 'data' => ['command' => serialize((object) ['body' => $secret, 'token' => 'ExponentPushToken[abc]'])]]),
        'exception' => "RuntimeException: (code 0)\n#0 /app/Jobs/DeliverPush.php(12)",
        'failed_at' => now(),
    ]);

    return $uuid;
}

it('runs the health checks for system.view and stores the run', function (string $role, bool $allowed) {
    $run = fn () => app(RunHealthChecks::class)->handle(m31Staff($role));

    if (! $allowed) {
        expect($run)->toThrow(AuthorizationException::class);

        return;
    }

    $report = $run();
    $names = array_column($report['checks'], 'name');

    expect($report['finished_at'])->not->toBeNull()
        ->and($names)->toContain('Database', 'Cache', 'Queue', 'QueueBacklog', 'FailedJobs', 'Schedule', 'DiskSpace', 'StorageLink', 'GdWebp', 'PhpEnvironment', 'MailConfig', 'Pusher', 'AiProvider', 'LastBackup', 'AuditChain')
        ->and(AuditEvent::query()->where('action', SystemEvent::HealthChecksRun->value)->exists())->toBeTrue();
})->with(m36Matrix('system.view'));

it('lists failed and pending jobs without any payload content', function () {
    m36FailedJob();
    DB::table('jobs')->insert(['queue' => 'default', 'payload' => json_encode(['displayName' => 'App\\Jobs\\SendMail', 'data' => ['command' => 'secret-body lena@example.org']]), 'attempts' => 0, 'reserved_at' => null, 'available_at' => now()->getTimestamp(), 'created_at' => now()->getTimestamp()]);

    $failed = app(JobsInspector::class)->failed();
    $pending = app(JobsInspector::class)->pending();
    $json = json_encode([$failed, $pending]);

    expect($failed[0]['job'])->toBe('App\\Jobs\\DeliverPush')
        ->and($failed[0]['exception'])->toBe('RuntimeException')
        ->and($pending[0]['job'])->toBe('App\\Jobs\\SendMail')
        ->and($json)->not->toContain('Geheime')->not->toContain('482913')->not->toContain('ExponentPushToken')
        ->not->toContain('lena@example.org')->not->toContain('secret-body')->not->toContain('DeliverPush.php');
});

it('retries and forgets failed jobs for system.jobs, audited without payloads', function (string $role, bool $allowed) {
    $uuid = m36FailedJob();
    $run = fn () => app(ManageFailedJobs::class)->forget(m31Staff($role), [$uuid]);

    if (! $allowed) {
        expect($run)->toThrow(AuthorizationException::class);

        return;
    }

    expect($run())->toBe(['done' => 1, 'missing' => 0])
        ->and(DB::table('failed_jobs')->count())->toBe(0)
        ->and(json_encode(AuditEvent::query()->where('action', SystemEvent::JobsForgotten->value)->sole()->after))->not->toContain('Geheime');
})->with(m36Matrix('system.jobs'));

it('puts a retried job back on its queue', function () {
    $uuid = m36FailedJob();

    expect(app(ManageFailedJobs::class)->retry(m31Staff('admin'), [$uuid, (string) Str::uuid()]))->toBe(['done' => 1, 'missing' => 1])
        ->and(DB::table('failed_jobs')->count())->toBe(0)
        ->and(DB::table('jobs')->count())->toBe(1);
});

it('shows integrations as configured or not, never a secret value', function () {
    config([
        'mail.default' => 'smtp',
        'mail.mailers.smtp.password' => 'smtp-pass-geheim',
        'broadcasting.default' => 'pusher',
        'broadcasting.connections.pusher.key' => 'pusher-key-geheim',
        'broadcasting.connections.pusher.secret' => 'pusher-secret-geheim',
        'broadcasting.connections.pusher.app_id' => '424242',
        'speedclub.services.expo_access_token' => 'expo-token-geheim',
        'speedclub.services.ai_provider' => 'anthropic',
        'ai.providers.anthropic.key' => 'sk-ant-geheim',
        'speedclub.services.turnstile_secret' => 'turnstile-geheim',
        'speedclub.services.sentry_dsn' => 'https://geheim@sentry.example/1',
    ]);

    $status = collect(app(Integrations::class)->status(m31Staff('admin')))->keyBy('key');
    $json = json_encode($status);

    expect($status['mail']['configured'])->toBeTrue()
        ->and($status['pusher']['configured'])->toBeTrue()
        ->and($status['ai'])->toMatchArray(['configured' => true, 'driver' => 'anthropic'])
        ->and($status['push']['test'])->toBe(['available' => false, 'reason' => 'no_device'])
        ->and($json)->not->toContain('geheim')->not->toContain('424242');
});

it('sends the test mail to the staff member', function () {
    Mail::fake();
    $staff = m31Staff('admin');

    expect(app(RunIntegrationTest::class)->mail($staff))->toBe(['ok' => true, 'error' => null]);
    Mail::assertSent(SystemTestMail::class, fn (SystemTestMail $mail) => $mail->hasTo($staff->email));

    expect(fn () => app(RunIntegrationTest::class)->mail(m31Staff('support')))->toThrow(AuthorizationException::class);
});

it('refuses the test push (no staff device) and the Pusher test without Pusher', function () {
    $staff = m31Staff('admin');

    expect(fn () => app(RunIntegrationTest::class)->pushNotice($staff))->toThrow(TeamRefused::class, __('team.refused.no_device'))
        ->and(fn () => app(RunIntegrationTest::class)->pusher($staff))->toThrow(TeamRefused::class, __('team.refused.not_configured'));
});

it('runs the AI test against the fake when no provider is set', function () {
    config(['speedclub.services.ai_provider' => null]);

    $result = app(RunIntegrationTest::class)->ai(m31Staff('admin'));

    expect($result)->toMatchArray(['ok' => true, 'faked' => true, 'provider' => null, 'answer' => 'OK']);
    SystemTestAgent::assertPrompted(fn ($prompt) => true);
});
