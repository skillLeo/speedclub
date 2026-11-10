<?php

namespace App\Http\Requests\Web;

use App\Enums\SupportCategory;
use App\Http\Requests\Api\V1\Auth\Concerns\NormalizesEmail;
use App\Http\Requests\Web\Concerns\RefusesCrossSitePosts;
use App\Services\Support\Turnstile;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Validation\Rule;

/**
 * WEB-10 /kontakt. Sessionless like WEB-05: errors render the page again with what was typed.
 */
class ContactFormRequest extends FormRequest
{
    use NormalizesEmail, RefusesCrossSitePosts;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:80'],
            'email' => ['bail', 'required', 'string', 'max:255', 'email:rfc'],
            'category' => ['required', Rule::enum(SupportCategory::class)],
            'message' => ['required', 'string', 'min:10', 'max:'.config()->integer('speedclub.support.message_max_length')],
            'cf-turnstile-response' => ['nullable', 'string', 'max:2048'],
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

                if ($validator->errors()->isEmpty() && ! app(Turnstile::class)->passes($this->string('cf-turnstile-response')->toString(), Turnstile::ACTION_CONTACT)) {
                    $validator->errors()->add('form', (string) __('public.forms.turnstile_failed'));
                }
            },
        ];
    }

    protected function failedValidation(Validator $validator): void
    {
        throw new HttpResponseException(response()->view('public.contact', [
            'state' => 'form',
            'errors' => $validator->errors(),
            'old' => $this->only(['name', 'email', 'category', 'message']),
        ], 422));
    }
}
