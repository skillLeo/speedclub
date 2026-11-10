<?php

use App\Console\Commands\AuditVerifyCommand;
use App\Health\Checks\AiProviderCheck;
use App\Health\Checks\AuditChainCheck;
use App\Health\Checks\DiskSpaceCheck;
use App\Health\Checks\FailedJobsCheck;
use App\Health\Checks\LastBackupCheck;
use App\Health\Checks\MailConfigCheck;
use App\Health\Checks\PhpEnvironmentCheck;
use App\Health\Checks\PusherCheck;
use App\Health\Checks\QueueBacklogCheck;
use App\Services\System\HealthReport;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Spatie\Health\Enums\Status;
use Spatie\Health\Facades\Health;

function m36Status(object $check): string
{
    return $check->run()->status->value;
}

it('registers every check ADM-48 names', function () {
    $names = Health::registeredChecks()->map->getName()->all();

    expect($names)->toContain('Database', 'Cache', 'Queue', 'QueueBacklog', 'FailedJobs', 'Schedule', 'DiskSpace', 'StorageLink', 'GdWebp', 'PhpEnvironment', 'MailConfig', 'Pusher', 'AiProvider', 'LastBackup', 'AuditChain');
});

it('reads disk space and PHP without a shell', function () {
    expect(m36Status(DiskSpaceCheck::new()))->toBeIn([Status::ok()->value, Status::warning()->value, Status::failed()->value])
        ->and(m36Status(PhpEnvironmentCheck::new()))->toBe(Status::ok()->value);
});

it('warns about failed jobs and a stalled queue', function () {
    expect(m36Status(FailedJobsCheck::new()))->toBe('ok')->and(m36Status(QueueBacklogCheck::new()))->toBe('ok');

    DB::table('failed_jobs')->insert(['uuid' => (string) Str::uuid(), 'connection' => 'database', 'queue' => 'default', 'payload' => '{}', 'exception' => 'X', 'failed_at' => now()]);
    DB::table('jobs')->insert(['queue' => 'default', 'payload' => '{}', 'attempts' => 0, 'available_at' => now()->subMinutes(20)->getTimestamp(), 'created_at' => now()->subMinutes(20)->getTimestamp()]);

    expect(m36Status(FailedJobsCheck::new()))->toBe('warning')->and(m36Status(QueueBacklogCheck::new()))->toBe('failed');
});

it('fails a log mailer in production only and never shows mail credentials', function () {
    config(['mail.default' => 'log', 'mail.mailers.smtp.password' => 'geheim']);
    expect(m36Status(MailConfigCheck::new()))->toBe('ok');

    app()->detectEnvironment(fn () => 'production');
    $result = MailConfigCheck::new()->run();

    expect($result->status->value)->toBe('failed')->and(json_encode($result->meta))->not->toContain('geheim');
});

it('checks Pusher and the AI provider only when configured, with a short timeout', function () {
    config(['broadcasting.default' => 'null', 'speedclub.services.ai_provider' => null]);
    expect(PusherCheck::new()->run()->meta['configured'])->toBeFalse()
        ->and(m36Status(PusherCheck::new()))->toBe('ok')
        ->and(m36Status(AiProviderCheck::new()))->toBe('ok');

    Http::fake(['api-eu.pusher.com/*' => Http::response('', 404), 'api.anthropic.com/*' => fn () => throw new ConnectionException('down')]);
    config(['broadcasting.default' => 'pusher', 'broadcasting.connections.pusher.options.host' => 'api-eu.pusher.com',
        'speedclub.services.ai_provider' => 'anthropic', 'ai.providers.anthropic.key' => 'sk-geheim', 'ai.providers.anthropic.url' => 'https://api.anthropic.com/v1']);

    $ai = AiProviderCheck::new()->run();
    expect(m36Status(PusherCheck::new()))->toBe('ok')
        ->and($ai->status->value)->toBe('failed')
        ->and(json_encode($ai->meta))->not->toContain('sk-geheim');
});

it('reads the last backup and the audit chain', function () {
    Storage::fake('local');
    config(['backup.backup.destination.disks' => ['local'], 'backup.backup.name' => 'speedclub']);

    expect(m36Status(LastBackupCheck::new()))->toBe('warning');
    Storage::disk('local')->put('speedclub/2026-11-09-02-00-00.zip', 'zip');
    expect(m36Status(LastBackupCheck::new()))->toBe('ok');

    expect(m36Status(AuditChainCheck::new()))->toBe('warning');
    Cache::forever(AuditVerifyCommand::RESULT_CACHE_KEY, ['intact' => false, 'checked' => 3, 'broken_at' => 2, 'failure' => 'hash', 'verified_at' => now()->toIso8601String()]);
    expect(m36Status(AuditChainCheck::new()))->toBe('failed');
    Cache::forever(AuditVerifyCommand::RESULT_CACHE_KEY, ['intact' => true, 'checked' => 3, 'verified_at' => now()->toIso8601String()]);
    expect(m36Status(AuditChainCheck::new()))->toBe('ok');
});

it('reports the latest stored run for ADM-48', function () {
    expect(app(HealthReport::class)->latest())->toBe(['finished_at' => null, 'status' => 'unknown', 'checks' => []]);

    $this->artisan('health:check --no-notification')->assertSuccessful();
    $report = app(HealthReport::class)->latest();

    expect($report['finished_at'])->not->toBeNull()->and($report['checks'])->not->toBeEmpty();
});
