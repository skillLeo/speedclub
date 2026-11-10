<?php

namespace App\Console\Commands;

use App\Services\Releases\ReleaseRegister;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('speedclub:releases-sync {--path= : The register file; defaults to speedclub.content.releases_path (docs/RELEASES.md)}')]
#[Description('Copy the build entries of docs/RELEASES.md into the release register (ADM-38); idempotent')]
class ReleasesSyncCommand extends Command
{
    public function handle(ReleaseRegister $register): int
    {
        $option = $this->option('path');
        $path = is_string($option) && $option !== '' ? $option : config()->string('speedclub.content.releases_path');

        if (! is_file($path) || ! is_readable($path)) {
            $this->error("No readable release register at $path.");

            return self::FAILURE;
        }

        $result = $register->sync((string) file_get_contents($path));

        $this->info(sprintf('Releases: %d new, %d updated, %d unchanged, %d duplicate headings (the later entry wins).',
            $result['created'], $result['updated'], $result['unchanged'], $result['duplicates']));

        return self::SUCCESS;
    }
}
