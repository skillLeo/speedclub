<?php

namespace Database\Seeders\Concerns;

use Illuminate\Console\Command;
use RuntimeException;

/**
 * Seed data lives in database/data so an admin import can reuse the same files.
 */
trait SeedsFromData
{
    /**
     * @return array<array-key, mixed>
     */
    protected function readJson(string $file): array
    {
        $path = database_path('data/'.$file);
        $contents = is_file($path) ? file_get_contents($path) : false;

        if ($contents === false) {
            throw new RuntimeException("Seed data file [$path] is missing.");
        }

        $data = json_decode($contents, true, 64, JSON_THROW_ON_ERROR);

        if (! is_array($data)) {
            throw new RuntimeException("Seed data file [$path] does not hold a list or object.");
        }

        return $data;
    }

    protected function say(string $message): void
    {
        $this->output()?->info($message);
    }

    protected function warn(string $message): void
    {
        $this->output()?->warn($message);
    }

    private function output(): ?Command
    {
        /** @var Command|null $command */
        $command = $this->command ?? null;

        return $command;
    }
}
