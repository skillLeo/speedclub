<?php

namespace App\Console\Commands;

use Illuminate\Console\Application as ConsoleApplication;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Console\Scheduling\CallbackEvent;
use Illuminate\Console\Scheduling\Event;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Artisan;
use Throwable;

/**
 * schedule:run for hosts that disable proc_open (Hostinger and many other shared hosts): the same due events, filters, time
 * zones, maintenance rule and overlap locks, but every artisan command runs inside this one PHP process instead of a child
 * process. Events run one after the other in the order of routes/console.php, so the queue worker, listed last, gets the
 * rest of the minute. The cron runs this command instead of schedule:run (docs/DEPLOY.md §5).
 *
 * The queue worker stops once its process uses `--memory` megabytes (128 by default). Inline, that process is shared with
 * the tasks that ran before it, so a worker without its own `--memory` gets those 128 MB on top of what this run already
 * uses, as it would in a fresh child process.
 */
#[Signature('speedclub:schedule-inline')]
#[Description('Run the due scheduled tasks in this process, for hosts without proc_open (DEPLOY.md §5)')]
class ScheduleInlineCommand extends Command
{
    /** The queue worker's own memory budget in a fresh process (`queue:work --memory`, default 128). */
    private const WORKER_MEMORY_MB = 128;

    /** Room left below PHP's memory_limit, so the worker stops between jobs instead of dying inside one. */
    private const PHP_LIMIT_MARGIN_MB = 32;

    public function handle(Schedule $schedule): int
    {
        $prefix = ConsoleApplication::formatCommandString('');
        $failed = 0;
        $ran = 0;

        foreach ($schedule->dueEvents($this->laravel) as $event) {
            if (! $event->filtersPass($this->laravel)) {
                continue;
            }

            if ($event instanceof CallbackEvent) {
                $failed += $this->attempt($event, fn () => $event->run($this->laravel)) ? 0 : 1;
                $ran++;

                continue;
            }

            $command = (string) $event->command;
            if (! str_starts_with($command, $prefix)) {
                // Schedule::exec() would need a shell, which this host does not give PHP.
                $this->warn("Skipped (not an artisan command): {$command}");

                continue;
            }

            if ($event->shouldSkipDueToOverlapping()) {
                continue;
            }

            $ok = $this->attempt($event, function () use ($event, $command, $prefix): void {
                $event->callBeforeCallbacks($this->laravel);
                $exitCode = Artisan::call($this->withWorkerMemory(substr($command, strlen($prefix))));
                $event->finish($this->laravel, $exitCode);
                if ($exitCode !== 0) {
                    throw new \RuntimeException('exit code '.$exitCode);
                }
            });
            $failed += $ok ? 0 : 1;
            $ran++;
        }

        $this->line("Ran {$ran} scheduled task(s), {$failed} failed.");

        return $failed === 0 ? self::SUCCESS : self::FAILURE;
    }

    /**
     * A queue worker without its own --memory gets the 128 MB of a fresh process on top of what this process already uses;
     * every other command, and a worker with an explicit --memory, runs as scheduled.
     */
    private function withWorkerMemory(string $arguments): string
    {
        if (preg_match('/^queue:work(\s|$)/', $arguments) !== 1 || preg_match('/(^|\s)--memory(=|\s|$)/', $arguments) === 1) {
            return $arguments;
        }

        $used = (int) ceil(memory_get_usage(true) / 1024 / 1024);
        $ini = (string) ini_get('memory_limit');
        $phpLimit = in_array($ini, ['', '-1'], true) ? null : intdiv(ini_parse_quantity($ini), 1024 * 1024);

        return $arguments.' --memory='.self::workerMemoryLimit($used, $phpLimit);
    }

    /**
     * The inline worker's --memory in MB: 128 on top of what the run already uses, capped 32 MB below PHP's own memory_limit
     * (null = unlimited). Without the cap, a worker on a 256 MB host after a 200 MB task would only notice its limit after PHP
     * had already died with a fatal error in the middle of a job. A cap below the current use stops the worker at once, which the
     * run reports as a failed task: there is no room left to work safely in this minute.
     */
    public static function workerMemoryLimit(int $usedMb, ?int $phpLimitMb): int
    {
        $limit = $usedMb + self::WORKER_MEMORY_MB;

        return $phpLimitMb === null ? $limit : max(1, min($limit, $phpLimitMb - self::PHP_LIMIT_MARGIN_MB));
    }

    /**
     * One event failing does not stop the next one (the queue worker comes last); the failure is reported and its lock released.
     *
     * @param  callable(): void  $run
     */
    private function attempt(Event $event, callable $run): bool
    {
        try {
            $run();

            return true;
        } catch (Throwable $exception) {
            report($exception);
            $this->error(($event->description ?? $event->command ?? 'task').' failed: '.$exception->getMessage());
            if ($event->withoutOverlapping) {
                $event->mutex->forget($event);
            }

            return false;
        }
    }
}
