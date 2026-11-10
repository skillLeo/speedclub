<?php

namespace App\Console\Commands;

use App\Services\PublicPages\SitemapWriter;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('sitemap:generate')]
#[Description('Writes /sitemap.xml: public vehicles and members who allow search engines')]
class GenerateSitemapCommand extends Command
{
    public function handle(SitemapWriter $sitemap): int
    {
        $sitemap->write();

        return self::SUCCESS;
    }
}
