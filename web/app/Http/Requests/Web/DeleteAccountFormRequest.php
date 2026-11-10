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
 */
class DeleteAccountFormRequest extends FormRequest
{
    use NormalizesEmail, RefusesCrossSitePosts;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'email' => ['bail', 'required', 'string', 'max:255', 'email:rfc'],
            'password' => ['required', 'string', 'max:'.config()->integer('speedclub.passwords.max_length')],
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
        throw new HttpResponseException(response()->view('public.account-deletion', [
            'state' => 'form',
            'errors' => $validator->errors(),
            'old' => ['email' => $this->email()],
            'needsCode' => $this->filled('code'),
        ], 422));
    }
}
