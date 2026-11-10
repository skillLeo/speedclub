<?php

namespace App\Services\Config\Schemas;

use App\Services\Config\ConfigSchema;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;

/**
 * Shared helpers of the config schemas: DE/EN texts (German required where the text is required, English optional with German as the
 * app's fallback), ISO dates, and the default no-op hooks.
 */
abstract class Schema implements ConfigSchema
{
    public function approvalFor(array $live, array $next): ?string
    {
        return null;
    }

    public function published(array $payload): void {}

    /**
     * @return array<string, list<mixed>>
     */
    protected function localizedRules(string $field, bool $required, int $max): array
    {
        return [
            $field => [$required ? 'required' : 'nullable', 'array'],
            "$field.de" => [$required ? "required_with:$field" : 'nullable', 'nullable', 'string', "max:$max"],
            "$field.en" => ['nullable', 'string', "max:$max"],
        ];
    }

    /**
     * @return array{de: string, en: string|null}|null
     */
    protected function localized(mixed $value): ?array
    {
        if (! is_array($value) || ! is_string($value['de'] ?? null) || trim($value['de']) === '') {
            return null;
        }

        $en = is_string($value['en'] ?? null) && trim($value['en']) !== '' ? trim($value['en']) : null;

        return ['de' => trim($value['de']), 'en' => $en];
    }

    protected function date(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? Carbon::parse($value)->utc()->toIso8601ZuluString() : null;
    }

    /**
     * @param  array<string, string>  $messages
     */
    protected function refuse(array $messages): never
    {
        throw ValidationException::withMessages(array_map(fn (string $message): array => [$message], $messages));
    }
}
