<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Accepts only cursors a query with these order columns can have produced. The framework trusts the decoded value and
 * fails with a 500 on anything else, and a forged cursor must not be a way to write stack traces into the log. That includes
 * null: none of the order columns is nullable, and the framework's "greater than null" throws.
 *
 * $expected pins columns to one value: the list signature of App\Services\Discover\SearchCursor, so a cursor of another text, filter set
 * or sort is refused too (m2.3 contract §1).
 */
final class ValidCursor implements ValidationRule
{
    /**
     * @param  list<string>  $columns  the columns of the query's orderBy
     * @param  array<string, string>  $expected  columns whose value is fixed for this list
     */
    public function __construct(
        private readonly array $columns,
        private readonly array $expected = [],
    ) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! $this->passes($value)) {
            $fail((string) __('errors.cursor_invalid'));
        }
    }

    public function passes(mixed $value): bool
    {
        return is_string($value) && $this->isValid($value);
    }

    private function isValid(string $value): bool
    {
        $parameters = json_decode((string) base64_decode(strtr($value, '-_', '+/')), true);

        if (! is_array($parameters) || ! is_bool($parameters['_pointsToNextItems'] ?? null)) {
            return false;
        }

        unset($parameters['_pointsToNextItems']);

        $expected = $this->columns;
        $given = array_keys($parameters);
        sort($expected);
        sort($given);

        foreach ($this->expected as $column => $fixed) {
            if (($parameters[$column] ?? null) !== $fixed) {
                return false;
            }
        }

        return $given === $expected
            && array_filter($parameters, fn (mixed $column): bool => ! is_scalar($column)) === [];
    }
}
