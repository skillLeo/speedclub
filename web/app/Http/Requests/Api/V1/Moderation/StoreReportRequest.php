<?php

namespace App\Http\Requests\Api\V1\Moderation;

use App\Enums\IllegalSubReason;
use App\Enums\ReportReason;
use App\Enums\ReportSource;
use App\Enums\ReportTargetType;
use App\Models\User;
use App\Services\Moderation\ReportDraft;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * POST reports (m2.6-contract §2 and Addendum). `target_id` is the username for a member and the ULID otherwise. `sub_reason` is
 * required for `illegal` and refused for every other reason; `illegal` also needs `good_faith: true` (Art. 16(2)(d) DSA), which the app
 * sends with the statement on the details step. `message_context: true` only for a message: the server then keeps the reported message
 * with up to 5 before and after it.
 */
class StoreReportRequest extends FormRequest
{
    public const MIN_ILLEGAL_DETAILS = 10;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        // Static rule lists, so the export types every field (Scramble reads them): conditions through *_if / *_unless.
        return [
            'target_type' => ['required', 'string', Rule::enum(ReportTargetType::class)],
            'target_id' => ['required', 'string', 'max:64'],
            'reason' => ['required', 'string', Rule::enum(ReportReason::class)],
            'sub_reason' => ['required_if:reason,illegal', 'prohibited_unless:reason,illegal', 'string', Rule::enum(IllegalSubReason::class)],
            // Art. 16(2)(a) DSA: required for illegal, then at least 10 characters: a notice of illegal content explains why.
            'details' => ['required_if:reason,illegal', 'nullable', 'string', 'max:'.config()->integer('speedclub.moderation.details_max_length')],
            'good_faith' => ['required_if:reason,illegal', 'boolean:strict', 'accepted_if:reason,illegal'],
            'message_context' => ['prohibited_unless:target_type,message', 'boolean:strict'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'sub_reason.required_if' => (string) __('safety.validation.sub_reason_required'),
            'sub_reason.prohibited_unless' => (string) __('safety.validation.sub_reason_prohibited'),
            'good_faith.required_if' => (string) __('safety.validation.good_faith_required'),
            'good_faith.accepted_if' => (string) __('safety.validation.good_faith_required'),
            'message_context.prohibited_unless' => (string) __('safety.validation.message_context_prohibited'),
            'details.max' => (string) __('safety.validation.details_max'),
            'details.required_if' => (string) __('safety.validation.details_required'),
        ];
    }

    /**
     * @return list<callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $details = $this->input('details');

                if ($this->input('reason') === ReportReason::Illegal->value && is_string($details) && trim($details) !== '' && mb_strlen(trim($details)) < self::MIN_ILLEGAL_DETAILS && ! $validator->errors()->has('details')) {
                    $validator->errors()->add('details', (string) __('safety.validation.details_min', ['min' => self::MIN_ILLEGAL_DETAILS]));
                }
            },
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

    public function targetType(): ReportTargetType
    {
        return ReportTargetType::from($this->string('target_type')->toString());
    }

    public function targetId(): string
    {
        return trim($this->string('target_id')->toString());
    }

    public function draft(): ReportDraft
    {
        /** @var User $user */
        $user = $this->user();
        $reason = ReportReason::from($this->string('reason')->toString());
        $details = $this->validated('details');

        return new ReportDraft(
            source: ReportSource::App,
            reporter: $user,
            reason: $reason,
            subReason: $reason === ReportReason::Illegal ? IllegalSubReason::from($this->string('sub_reason')->toString()) : null,
            details: is_string($details) ? $details : null,
            goodFaith: $this->validated('good_faith') === true,
            messageContext: $this->validated('message_context') === true,
        );
    }
}
