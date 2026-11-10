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
 */
#[Signature('speedclub:schedule-inline')]
#[Description('Run the due scheduled tasks in this process, for hosts without proc_open (DEPLOY.md §5)')]
class ScheduleInlineCommand extends Command
{
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
                $exitCode = Artisan::call(substr($command, strlen($prefix)));
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
