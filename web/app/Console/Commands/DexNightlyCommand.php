<?php

namespace App\Console\Commands;

use App\Services\Dex\DexNightly;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('dex:nightly')]
#[Description('STREET DEX upkeep in resumable steps: Dex numbers, rarity, spot stats and set progress repair (m5.9b §6)')]
class DexNightlyCommand extends Command
{
    public function handle(DexNightly $nightly): int
    {
        $result = $nightly->run();

        if ($result === null) {
            $this->info('Another dex:nightly run is still working.');

            return self::SUCCESS;
        }

        $tasks = implode(', ', array_map(fn (string $task, int $count): string => "$task $count", array_keys($result['tasks']), $result['tasks']));
        $this->info(($result['done'] ? 'Done for today.' : 'Continues with the next run.').($tasks === '' ? '' : " Handled: $tasks."));

        return self::SUCCESS;
    }
}
