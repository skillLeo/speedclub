<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * The one place for text input (SEC-104): invalid UTF-8 and NUL bytes get a 422 before validation, on every field of
 * every API and admin route. Past this point the database would refuse them or the JSON response could not encode them,
 * and the member would see a 500. Uploaded files are not text and are not looked at.
 *
 * A browser GET on an admin page has no form to go back to: the usual redirect to the previous URL would lead straight
 * back here, so it gets the 422 directly.
 */
class RejectInvalidText
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->isJson() && $request->getContent() !== '' && ! json_validate($request->getContent())) {
            throw ValidationException::withMessages(['body' => [(string) __('errors.invalid_json')]]);
        }

        /** @var array<array-key, mixed> $input */
        $input = $request->input();
        $field = $this->firstInvalid($input);

        if ($field !== null) {
            if ($request->isMethodSafe() && ! $request->expectsJson() && ! $request->is('api', 'api/*')) {
                throw new HttpException(422, (string) __('errors.invalid_text'));
            }

            throw ValidationException::withMessages([$field => [(string) __('errors.invalid_text')]]);
        }

        return $next($request);
    }

    /**
     * @param  array<array-key, mixed>  $values
     * @return string|null the dotted name of the first bad field
     */
    private function firstInvalid(array $values, string $prefix = ''): ?string
    {
        foreach ($values as $key => $value) {
            $name = $prefix.mb_scrub((string) $key, 'UTF-8');

            if (! $this->isValid((string) $key) || (is_string($value) && ! $this->isValid($value))) {
                return $name;
            }

            if (is_array($value)) {
                $invalid = $this->firstInvalid($value, $name.'.');

                if ($invalid !== null) {
                    return $invalid;
                }
            }
        }

        return null;
    }

    private function isValid(string $text): bool
    {
        return mb_check_encoding($text, 'UTF-8') && ! str_contains($text, "\0");
    }
}
