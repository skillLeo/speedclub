<?php

namespace App\Console\Commands;

use App\Actions\Shop\PurgeDeletedShopProducts;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('shop:purge')]
#[Description('Shop: remove products deleted in ADM-66 more than speedclub.shop.purge_after_days ago, with their photos')]
class PurgeShopProductsCommand extends Command
{
    public function handle(PurgeDeletedShopProducts $purge): int
    {
        $this->info('Purged '.$purge->handle().' shop products.');

        return self::SUCCESS;
    }
}
