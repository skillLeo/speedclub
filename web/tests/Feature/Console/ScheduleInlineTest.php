<?php

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
