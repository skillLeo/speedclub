<?php

namespace App\Console\Commands;

use App\Services\BuildScore\BuildScoreNightly;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('build-score:nightly {--restart : Start the night again from the first task}')]
#[Description('Build Score upkeep in resumable steps: every score again, ranks by generation and Bundesland (m5.9c §3)')]
class BuildScoreNightlyCommand extends Command
{
    public function handle(BuildScoreNightly $nightly): int
    {
        if ($this->option('restart') === true) {
            $nightly->restart();
        }

        $result = $nightly->run();

        if ($result === null) {
            $this->info('Another build-score:nightly run is still working.');

            return self::SUCCESS;
        }

        $tasks = implode(', ', array_map(fn (string $task, int $count): string => "$task $count", array_keys($result['tasks']), $result['tasks']));
        $this->info(($result['done'] ? 'Done for today.' : 'Continues with the next run.').($tasks === '' ? '' : " Handled: $tasks."));

        return self::SUCCESS;
    }
}
