<?php

namespace App\Services\Config;

use App\Enums\ConfigKey;
use Illuminate\Validation\ValidationException;

/**
 * The payload rules of one config key (App\Services\Config\Schemas). normalize() validates a draft and returns it in canonical form
 * (known keys only, typed values); it runs again at publish, so a world that changed in between (a build went private) is caught.
 */
interface ConfigSchema
{
    public function key(): ConfigKey;

    /**
     * @param  array<array-key, mixed>  $payload
     * @return array<string, mixed>
     *
     * @throws ValidationException
     */
    public function normalize(array $payload): array;

    /**
     * What the first draft of a key starts from when nothing is published yet.
     *
     * @return array<string, mixed>
     */
    public function initial(): array;

    /**
     * The four-eyes action a change from $live to $next needs (e.g. maintenance.enable), or null.
     *
     * @param  array<array-key, mixed>  $live
     * @param  array<array-key, mixed>  $next
     */
    public function approvalFor(array $live, array $next): ?string;

    /**
     * Inside the publishing transaction, after the new version is live (sync a projection, write a cache after commit).
     *
     * @param  array<array-key, mixed>  $payload
     */
    public function published(array $payload): void;
}
