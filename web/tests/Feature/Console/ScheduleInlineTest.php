<?php

use App\Console\Commands\ScheduleInlineCommand;
use App\Support\Doctor\EnvironmentDoctor;
use App\Support\HostFunctions;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Spatie\Backup\Commands\BackupCommand;

/*
 * docs/DEPLOY.md §5: hosts that disable proc_open (Hostinger's shared plans among them) cannot run schedule:run, which starts every
 * command as a child process. speedclub:schedule-inline runs the same due events in its own process.
 */

beforeEach(function () {
    // 10:01 UTC on a Tuesday: only the every-minute entries of routes/console.php are due, besides the probes below.
    $this->travelTo(Carbon::parse('2026-11-10 10:01:00', 'UTC'));
    Artisan::command('test:inline-probe {--flag=}', function () {
        Cache::put('inline-probe', [(string) $this->option('flag'), getmypid()]);
    });
});

afterEach(function () {
    HostFunctions::fakeProcOpen(null);
});

it('runs a due artisan command with its options inside this process, not as a child process', function () {
    app(Schedule::class)->command('test:inline-probe --flag=hello')->everyMinute();

    // The nested Artisan::call of each task replaces Artisan::output(), so the summary line is read from the command's own output.
    $this->artisan('speedclub:schedule-inline')->expectsOutputToContain('scheduled task(s), 0 failed')->assertExitCode(0);
    expect(Cache::get('inline-probe'))->toBe(['hello', getmypid()]);
});

it('keeps the overlap lock: a task whose lock is held is skipped, and the lock is released after a run', function () {
    $event = app(Schedule::class)->command('test:inline-probe --flag=locked')->everyMinute()->withoutOverlapping();
    $event->mutex->create($event);

    Artisan::call('speedclub:schedule-inline');
    expect(Cache::get('inline-probe'))->toBeNull();

    $event->mutex->forget($event);
    Artisan::call('speedclub:schedule-inline');
    expect(Cache::get('inline-probe')[0])->toBe('locked')
        ->and($event->mutex->exists($event))->toBeFalse();
});

it('runs nothing that is not due, and goes on after a failing task', function () {
    app(Schedule::class)->command('test:inline-probe --flag=hourly')->hourlyAt(30);
    app(Schedule::class)->call(fn () => throw new RuntimeException('boom'))->everyMinute()->name('boom');
    app(Schedule::class)->command('test:inline-probe --flag=after')->everyMinute();

    $this->artisan('speedclub:schedule-inline')->expectsOutputToContain('1 failed')->assertExitCode(1);
    expect(Cache::get('inline-probe')[0])->toBe('after');
});

it('gives the inline queue worker its own 128 MB on top of what the run already uses', function () {
    // The worker stops with exit code 12 once its process reaches --memory (128 MB by default). Inline, the process is shared, so a
    // run that already holds more than that (a long test process, or a heavy task earlier in the minute) must not stop it.
    $ballast = str_repeat('x', 150 * 1024 * 1024);
    expect(memory_get_usage(true) / 1024 / 1024)->toBeGreaterThan(128);

    $this->artisan('speedclub:schedule-inline')->expectsOutputToContain('scheduled task(s), 0 failed')->assertExitCode(0);
    expect(strlen($ballast))->toBe(150 * 1024 * 1024);
});

it('keeps the inline worker limit below PHP\'s own memory_limit', function () {
    // 128 MB on top of the run, capped 32 MB below memory_limit (null = -1, unlimited); below the current use it stops at once.
    expect(ScheduleInlineCommand::workerMemoryLimit(50, 512))->toBe(178)
        ->and(ScheduleInlineCommand::workerMemoryLimit(200, 256))->toBe(224)
        ->and(ScheduleInlineCommand::workerMemoryLimit(200, null))->toBe(328)
        ->and(ScheduleInlineCommand::workerMemoryLimit(300, 256))->toBe(224)
        ->and(ScheduleInlineCommand::workerMemoryLimit(10, 16))->toBe(1);
});

it('hands the capped limit to the inline worker on a host whose memory_limit leaves less than 128 MB of room', function () {
    // A stand-in for queue:work records the --memory it receives (registered after the framework's command, so it wins).
    Artisan::command('queue:work {connection?} {--stop-when-empty} {--max-time=} {--tries=} {--memory=}', function () {
        Cache::put('worker-memory', (int) $this->option('memory'));
    });
    $used = (int) ceil(memory_get_usage(true) / 1024 / 1024);
    $previous = ini_get('memory_limit');
    ini_set('memory_limit', ($used + 96).'M');

    try {
        $this->artisan('speedclub:schedule-inline')->expectsOutputToContain('scheduled task(s), 0 failed')->assertExitCode(0);
    } finally {
        ini_set('memory_limit', (string) $previous);
    }

    // Without the cap the worker would get its use + 128 MB, above PHP's own limit; with it, memory_limit − 32 MB.
    expect(Cache::get('worker-memory'))->toBe($used + 96 - 32);
});

it('leaves a worker with its own --memory as scheduled', function () {
    app(Schedule::class)->command('queue:work --stop-when-empty --memory=1')->everyMinute();

    // Every PHP process uses more than 1 MB, so this worker stops at once with exit code 12: its limit was not replaced.
    $this->artisan('speedclub:schedule-inline')->expectsOutputToContain('1 failed')->assertExitCode(1);
});

it('keeps the app backups off where proc_open is disabled, and on where it is available', function () {
    $backups = fn (): array => collect(app(Schedule::class)->events())
        ->filter(fn ($event): bool => str_contains((string) $event->command, 'backup:run'))
        ->values()->all();
    expect($backups())->toHaveCount(1)->and((string) $backups()[0]->command)->toContain((string) app(BackupCommand::class)->getName());

    HostFunctions::fakeProcOpen(false);
    expect($backups()[0]->filtersPass(app()))->toBeFalse();

    HostFunctions::fakeProcOpen(true);
    expect($backups()[0]->filtersPass(app()))->toBeTrue();
});

it('makes proc_open a warning with SCHEDULER_INLINE=true and a blocker without it, where the host disables it', function () {
    $check = fn () => collect(app(EnvironmentDoctor::class)->run())->firstWhere('check', 'proc_open');

    HostFunctions::fakeProcOpen(false);
    config(['speedclub.scheduler.inline' => false]);
    expect($check()->level->value)->toBe('blocker')->and($check()->detail)->toContain('speedclub:schedule-inline');

    config(['speedclub.scheduler.inline' => true]);
    expect($check()->level->value)->toBe('warning')->and($check()->detail)->toContain('host\'s backups');

    HostFunctions::fakeProcOpen(true);
    expect($check()->level->value)->toBe('ok');
});
