<?php

namespace App\Http\Requests\Api\V1\Me;

use App\Services\Notifications\WebPush;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * M4.15 (ADR-452): the member web's Web Push subscription of this browser, as PushSubscription.toJSON() gives it.
 */
class StorePushSubscriptionRequest extends FormRequest
{
    /** base64url (padding allowed), as browsers encode the keys. */
    private const BASE64URL = '/\A[A-Za-z0-9_-]+={0,2}\z/';

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** The push service URL of this browser: HTTPS, at a browser vendor's push service. */
            'endpoint' => ['required', 'string', 'max:'.config()->integer('speedclub.web_push.endpoint_max_length'), 'url:https'],
            'keys' => ['required', 'array:p256dh,auth'],
            /** The browser's P-256 public key (65 bytes), base64url. */
            'keys.p256dh' => ['required', 'string', 'max:100', 'regex:'.self::BASE64URL],
            /** The browser's auth secret (16 bytes), base64url. */
            'keys.auth' => ['required', 'string', 'max:40', 'regex:'.self::BASE64URL],
            /** navigator.userAgent, shortened to 255 characters. Only the browser and system names are kept ("Chrome, macOS"). */
            'user_agent' => ['sometimes', 'nullable', 'string', 'max:255'],
        ];
    }

    /**
     * The server posts to the endpoint, so only a push service's address passes (no SSRF), and the keys must decode to what
     * the payload encryption needs.
     *
     * @return list<callable(Validator): void>
     */
    public function after(): array
    {
        return [function (Validator $validator): void {
            $errors = $validator->errors();
            $endpoint = $this->input('endpoint');

            if (! $errors->has('endpoint') && is_string($endpoint) && ! WebPush::allowedEndpoint($endpoint)) {
                $errors->add('endpoint', (string) __('validation.push_endpoint'));
            }

            foreach (['keys.p256dh' => 65, 'keys.auth' => 16] as $field => $bytes) {
                $value = $this->input($field);

                if (! $errors->has($field) && is_string($value) && ! self::decodesTo($value, $bytes, $field === 'keys.p256dh')) {
                    $errors->add($field, (string) __('validation.push_key'));
                }
            }
        }];
    }

    private static function decodesTo(string $base64url, int $bytes, bool $point): bool
    {
        $raw = base64_decode(strtr(rtrim($base64url, '='), '-_', '+/'), true);

        return is_string($raw) && strlen($raw) === $bytes && (! $point || $raw[0] === "\x04");
    }
}
