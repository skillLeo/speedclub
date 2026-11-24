<?php

namespace App\Console\Commands;

use App\Services\Garage\PlanDuePrompts;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('plans:due-prompts')]
#[Description('M5.7: ask owners once whether a planned mod whose target month arrived is installed (max 1 per owner and week, ≤ 40 s)')]
class SendPlanDuePromptsCommand extends Command
{
    public function handle(PlanDuePrompts $prompts): int
    {
        $asked = $prompts->run();
        $this->info($asked === null ? 'Another run is still asking.' : "Asked $asked owners.");

        return self::SUCCESS;
    }
}
