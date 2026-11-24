<?php

namespace App\Services\Setup;

use Dotenv\Dotenv;
use Throwable;

/**
 * ADR-539: the token of /internal/setup and /internal/maintenance. Read from the .env file on every request, not from the
 * (possibly cached) config, so the owner can switch the installer on again over FTP alone: put a new SETUP_TOKEN into .env.
 * After a successful setup the token is spent: its hash is kept in storage/app/private/setup/spent-tokens and it answers 404
 * from then on, like a missing one. Only hashes are stored, never a token.
 */
class SetupToken
{
    public const SPENT_FILE = 'app/private/setup/spent-tokens';

    /**
     * The configured token, or '' when there is none, it is too short or it is spent. The .env file decides when it exists; the
     * config (real environment variables of the host) only when there is no readable .env file.
     */
    public function current(): string
    {
        $token = $this->fromEnvFile() ?? config()->string('speedclub.setup.token');

        if (strlen($token) < config()->integer('speedclub.setup.min_token_length') || $this->isSpent($token)) {
            return '';
        }

        return $token;
    }

    public function matches(string $given): bool
    {
        $current = $this->current();

        return $current !== '' && hash_equals($current, $given);
    }

    public function spend(string $token): void
    {
        $file = storage_path(self::SPENT_FILE);
        if (! is_dir(dirname($file))) {
            mkdir(dirname($file), 0775, true);
        }
        file_put_contents($file, $this->hash($token)."\n", FILE_APPEND | LOCK_EX);
    }

    public function isSpent(string $token): bool
    {
        $file = storage_path(self::SPENT_FILE);
        if (! is_file($file)) {
            return false;
        }
        $hash = $this->hash($token);

        foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            if (hash_equals(trim($line), $hash)) {
                return true;
            }
        }

        return false;
    }

    private function hash(string $token): string
    {
        return hash('sha256', 'speedclub-setup|'.$token);
    }

    private function fromEnvFile(): ?string
    {
        $file = app()->environmentFilePath();
        if (! is_file($file) || ! is_readable($file)) {
            return null;
        }

        try {
            $values = Dotenv::parse((string) file_get_contents($file));
        } catch (Throwable) {
            return null;
        }

        // A readable .env decides alone: a removed line means no installer, even if the cached config still holds an old token.
        return trim((string) ($values['SETUP_TOKEN'] ?? ''));
    }
}
