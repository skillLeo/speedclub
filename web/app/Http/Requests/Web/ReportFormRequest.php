<?php

namespace App\Http\Requests\Web;

use App\Enums\IllegalSubReason;
use App\Enums\ReportReason;
use App\Enums\ReportSource;
use App\Http\Requests\Web\Concerns\RefusesCrossSitePosts;
use App\Services\Moderation\ReportDraft;
use App\Services\Moderation\ReportTargets;
use App\Services\Moderation\ResolvedTarget;
use App\Services\Support\Turnstile;
use App\Support\EmailAddress;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Validation\Rule;

/**
 * WEB-09 /melden (Art. 16(2) DSA): the explanation, the exact location (a URL of a SPEED CLUB public page: /v/, /u/, /c/), the reason,
 * optional name and e-mail, and the good-faith statement. Sessionless like the page (ADR-115), so no CSRF token: a cross-site POST is
 * refused by Sec-Fetch-Site or Origin instead, Turnstile checks the visitor when configured, and throttle:reports bounds an address.
 * Errors render the form again with what was typed (422).
 */
class ReportFormRequest extends FormRequest
{
    use RefusesCrossSitePosts;

    private ?ResolvedTarget $target = null;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'url' => ['required', 'string', 'max:2048'],
            'reason' => ['required', 'string', Rule::enum(ReportReason::class)],
            'sub_reason' => $this->input('reason') === ReportReason::Illegal->value
                ? ['required', 'string', Rule::enum(IllegalSubReason::class)]
                : ['nullable'],
            'details' => ['required', 'string', 'min:10', 'max:'.config()->integer('speedclub.moderation.details_max_length')],
            'name' => ['nullable', 'string', 'max:100'],
            'email' => ['bail', 'nullable', 'string', 'max:254', 'email:rfc'],
            'good_faith' => ['required', 'accepted'],
            'cf-turnstile-response' => ['nullable', 'string', 'max:2048'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'sub_reason.required' => (string) __('safety.validation.sub_reason_required'),
            'good_faith.required' => (string) __('safety.validation.good_faith_required'),
            'good_faith.accepted' => (string) __('safety.validation.good_faith_required'),
            'details.max' => (string) __('safety.validation.details_max'),
            'details.required' => (string) __('safety.validation.details_required'),
            'details.min' => (string) __('safety.validation.details_min'),
        ];
    }

    /**
     * @return array<string, string>
     */
    public function attributes(): array
    {
        /** @var array<string, string> $attributes */
        $attributes = __('safety.attributes');

        return $attributes;
    }

    /**
     * @return list<callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                if ($this->isCrossSite()) {
                    $validator->errors()->add('form', (string) __('safety.form.cross_site'));

                    return;
                }

                if (! $validator->errors()->has('url')) {
                    $url = $this->string('url')->toString();
                    $targets = app(ReportTargets::class);
                    $this->target = $targets->forPublicUrl($url);

                    if ($this->target === null) {
                        $validator->errors()->add('url', (string) __($targets->publicPage($url) === null ? 'safety.form.url_invalid' : 'safety.form.url_unknown'));
                    }
                }

                if ($validator->errors()->isEmpty() && ! app(Turnstile::class)->passes($this->string('cf-turnstile-response')->toString(), Turnstile::ACTION_REPORT)) {
                    $validator->errors()->add('form', (string) __('safety.form.turnstile_failed'));
                }
            },
        ];
    }

    protected function failedValidation(Validator $validator): void
    {
        throw new HttpResponseException(response()->view('public.report', [
            'state' => 'form',
            'errors' => $validator->errors(),
            'old' => $this->only(['url', 'reason', 'sub_reason', 'details', 'name', 'email', 'good_faith']),
        ], 422));
    }

    public function target(): ResolvedTarget
    {
        return $this->target ?? throw new \LogicException('The report form was not validated.');
    }

    public function draft(): ReportDraft
    {
        $reason = ReportReason::from($this->string('reason')->toString());
        $name = trim($this->string('name')->toString());
        $email = trim($this->string('email')->toString());

        return new ReportDraft(
            source: ReportSource::WebForm,
            reporter: null,
            reason: $reason,
            subReason: $reason === ReportReason::Illegal ? IllegalSubReason::from($this->string('sub_reason')->toString()) : null,
            details: $this->string('details')->toString(),
            goodFaith: true,
            contactName: $name === '' ? null : $name,
            contactEmail: $email === '' ? null : EmailAddress::normalize($email),
            contactLocale: app()->getLocale(),
        );
    }
}
