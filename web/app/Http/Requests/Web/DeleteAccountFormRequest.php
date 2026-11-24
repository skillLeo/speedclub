<?php

namespace App\Http\Requests\Web;

use App\Http\Requests\Api\V1\Auth\Concerns\NormalizesEmail;
use App\Http\Requests\Web\Concerns\RefusesCrossSitePosts;
use App\Services\Support\Turnstile;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;

/**
 * WEB-05 /konto-loeschen. Sessionless: a failed check renders the page again with the messages, it never redirects to a session.
 *
 * Two proofs, one form: the password, or (client round 6, L3) the e-mail code of /konto-loeschen/code with the attempt id the page
 * carries in a hidden field. The attempt decides which one is asked for.
 */
class DeleteAccountFormRequest extends FormRequest
{
    use NormalizesEmail {
        prepareForValidation as normalizeEmail;
    }
    use RefusesCrossSitePosts;

    public const ATTEMPT_PATTERN = '/\A[A-Za-z0-9_-]{22,64}\z/';

    protected function prepareForValidation(): void
    {
        $this->normalizeEmail();
        $code = $this->input('email_code');

        // "123 456" from a mail client reads as the code it is.
        if (is_string($code)) {
            $this->merge(['email_code' => preg_replace('/\s+/u', '', $code) ?? $code]);
        }
    }

    public function usesEmailCode(): bool
    {
        return $this->filled('attempt');
    }

    /**
     * The attempt id of the code step, or '' when the form is not in it (a malformed one never reaches the page again).
     */
    public function attempt(): string
    {
        $attempt = $this->input('attempt');

        return is_string($attempt) && preg_match(self::ATTEMPT_PATTERN, $attempt) === 1 ? $attempt : '';
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $proof = $this->usesEmailCode()
            ? [
                'attempt' => ['required', 'string', 'regex:'.self::ATTEMPT_PATTERN],
                'email_code' => ['bail', 'required', 'string', 'regex:/\A\d{6}\z/'],
            ]
            : ['password' => ['required', 'string', 'max:'.config()->integer('speedclub.passwords.max_length')]];

        return [
            'email' => ['bail', 'required', 'string', 'max:255', 'email:rfc'],
            ...$proof,
            'code' => ['nullable', 'string', 'max:32'],
            'confirm' => ['accepted'],
            'cf-turnstile-response' => ['nullable', 'string', 'max:2048'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'confirm.accepted' => (string) __('public.account_deletion.confirm_required'),
            'email_code.required' => (string) __('public.account_deletion.email_code_required'),
            'email_code.regex' => (string) __('public.account_deletion.email_code_format'),
        ];
    }

    /**
     * @return list<callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                if ($this->isCrossSite()) {
                    $validator->errors()->add('form', (string) __('public.forms.cross_site'));

                    return;
                }

                if ($validator->errors()->isEmpty() && ! app(Turnstile::class)->passes($this->string('cf-turnstile-response')->toString(), Turnstile::ACTION_ACCOUNT_DELETION)) {
                    $validator->errors()->add('form', (string) __('public.forms.turnstile_failed'));
                }
            },
        ];
    }

    protected function failedValidation(Validator $validator): void
    {
        $attempt = $this->attempt();

        throw new HttpResponseException(response()->view('public.account-deletion', [
            'state' => 'form',
            'mode' => $attempt !== '' ? 'code' : 'password',
            'attempt' => $attempt,
            'errors' => $validator->errors(),
            'old' => ['email' => $this->email()],
            'needsCode' => $this->filled('code'),
        ], 422));
    }
}
