<?php

namespace App\Console\Commands;

use App\Services\PublicPages\OgImages;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('og:prune')]
#[Description('Removes OG images of what is no longer public or has changed, and files nothing points at')]
class PruneOgImagesCommand extends Command
{
    public function handle(OgImages $images): int
    {
        $this->info('Removed '.$images->prune().' OG images.');

        return self::SUCCESS;
    }
}
