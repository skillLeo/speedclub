<?php

namespace App\Console\Commands;

use App\Services\Showcase\Showcase;
use App\Services\Showcase\ShowcasePurge;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use RuntimeException;

/**
 * The staging showcase (DemoShowcaseSeeder): without options it prints what is there; --purge removes every sample member and build
 * with everything that hangs off them, the showcase's admin rows and its staff account (ShowcasePurge), after a confirmation unless
 * --force; --dry-run only prints the counts. Refuses in production and any environment but local and staging.
 */
#[Signature('speedclub:demo {--purge : Remove the showcase} {--dry-run : With --purge: print what would go, change nothing} {--force : With --purge: no confirmation}')]
#[Description('Show or purge the staging showcase (is_sample members, builds and admin rows of DemoShowcaseSeeder)')]
class DemoShowcaseCommand extends Command
{
    public function handle(ShowcasePurge $purge): int
    {
        try {
            Showcase::assertEnvironment('speedclub:demo');
        } catch (RuntimeException $exception) {
            $this->error($exception->getMessage());

            return self::FAILURE;
        }

        $counts = $purge->counts();
        $this->table(['Showcase', 'Rows'], array_map(fn (string $key, int $count): array => [$key, $count], array_keys($counts), $counts));

        if (! $this->option('purge')) {
            $this->line('Seed or refresh it: php artisan db:seed --class=DemoShowcaseSeeder · remove it: php artisan speedclub:demo --purge');

            return self::SUCCESS;
        }

        if ($this->option('dry-run')) {
            $this->info('Dry run: nothing was removed.');

            return self::SUCCESS;
        }

        if (array_sum($counts) === 0) {
            $this->info('No showcase data on this host.');

            return self::SUCCESS;
        }

        if (! $this->option('force') && ! $this->confirm('Remove all showcase data listed above? Real members are not touched.', false)) {
            $this->warn('Nothing was removed.');

            return self::FAILURE;
        }

        $purge->purge();
        $left = array_filter($purge->counts());

        if ($left !== []) {
            $this->error('Some showcase rows are left: '.json_encode($left));

            return self::FAILURE;
        }

        $this->info('Showcase removed.');

        return self::SUCCESS;
    }
}
