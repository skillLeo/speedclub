<?php

namespace App\Health\Checks;

use Spatie\Health\Checks\Check;
use Spatie\Health\Checks\Result;

/**
 * PHP ≥ 8.3 and the extensions the app needs (05_ARCHITECTURE §11): failed when one is missing.
 */
class PhpEnvironmentCheck extends Check
{
    public const MINIMUM = '8.3.0';

    public const EXTENSIONS = ['bcmath', 'ctype', 'curl', 'dom', 'fileinfo', 'gd', 'intl', 'json', 'mbstring', 'openssl', 'pdo_mysql', 'tokenizer', 'xml', 'zip'];

    public function run(): Result
    {
        $missing = array_values(array_filter(self::EXTENSIONS, fn (string $extension): bool => ! extension_loaded($extension)));
        $result = Result::make(PHP_VERSION)->meta(['version' => PHP_VERSION, 'missing_extensions' => $missing]);

        if (version_compare(PHP_VERSION, self::MINIMUM, '<')) {
            return $result->failed('PHP '.PHP_VERSION.' is older than '.self::MINIMUM.'.');
        }

        return $missing === [] ? $result->ok() : $result->failed('Missing PHP extensions: '.implode(', ', $missing).'.');
    }
}
