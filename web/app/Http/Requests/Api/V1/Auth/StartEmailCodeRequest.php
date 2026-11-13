<?php

namespace App\Http\Requests\Api\V1\Auth;

use App\Enums\DevicePlatform;
use App\Http\Requests\Api\V1\Auth\Concerns\NormalizesEmail;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * AUTH-12 (09 §8.1). attempt_id is made by the client (a UUID or 22 to 64 random URL-safe characters) and kept on the device: it binds
 * the code and the magic link to this device, so it is never sent anywhere else and never part of a link.
 */
class StartEmailCodeRequest extends FormRequest
{
    use NormalizesEmail;

    public const ATTEMPT_PATTERN = '/\A[A-Za-z0-9_-]{22,64}\z/';

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'email' => ['bail', 'required', 'string', 'max:255', 'email:rfc'],
            'attempt_id' => ['required', 'string', 'regex:'.self::ATTEMPT_PATTERN],
            'locale' => ['nullable', 'string', Rule::in(config()->array('speedclub.locales'))],
            'platform' => ['nullable', Rule::enum(DevicePlatform::class)],
        ];
    }

    public function attemptId(): string
    {
        return $this->string('attempt_id')->toString();
    }

    public function optionalString(string $key): ?string
    {
        $value = $this->validated($key);

        return is_string($value) && $value !== '' ? $value : null;
    }
}
