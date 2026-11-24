<?php

namespace App\Console\Commands;

use App\Services\Wrapped\WrappedCardImages;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('speedclub:wrapped:prune-cards')]
#[Description('Season Wrapped: delete the card images of members and seasons without a Wrapped (deleted accounts, removed rows)')]
class PruneWrappedCardsCommand extends Command
{
    public function handle(WrappedCardImages $images): int
    {
        $this->info('Removed '.$images->prune().' folders.');

        return self::SUCCESS;
    }
}
