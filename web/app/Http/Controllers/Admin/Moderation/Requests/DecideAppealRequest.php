<?php

namespace App\Http\Controllers\Admin\Moderation\Requests;

use App\Enums\AppealStatus;
use App\Enums\DecisionAction;
use App\Enums\GroundDocument;
use App\Enums\RestrictionType;
use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Services\Moderation\Statement;
use Carbon\CarbonImmutable;
use Illuminate\Validation\Rule;

/**
 * ADM-21 appeal decision (`moderation.appeals`, recent password, reason): upheld or reversed, the explanation the appellant reads, and
 * for an overturned reporter appeal the measure now taken (remove content or restrict, with its statement of reasons).
 */
class DecideAppealRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'moderation.appeals';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return [
            'outcome' => ['required', Rule::in([AppealStatus::Upheld->value, AppealStatus::Reversed->value])],
            'explanation' => ['required', 'string', 'min:10', 'max:5000'],
            'action' => ['nullable', Rule::in([DecisionAction::RemoveContent->value, DecisionAction::Restrict->value])],
            'restriction' => ['required_if:action,restrict', 'nullable', Rule::enum(RestrictionType::class)],
            'until' => ['nullable', 'date', 'after:now'],
            'facts' => ['required_with:action', 'nullable', 'string', 'min:10', 'max:5000'],
            'ground' => ['required_with:action', 'nullable', 'string', 'min:3', 'max:2000'],
            'ground_document' => ['required_with:action', 'nullable', Rule::enum(GroundDocument::class)],
            'ground_section' => ['nullable', 'string', 'max:100'],
        ];
    }

    public function outcome(): AppealStatus
    {
        return AppealStatus::from($this->string('outcome')->value());
    }

    /**
     * @return array{action: DecisionAction, restriction: ?RestrictionType, until: ?CarbonImmutable, statement: Statement}|null
     */
    public function measure(): ?array
    {
        $action = DecisionAction::tryFrom($this->string('action')->value());

        if ($action === null) {
            return null;
        }

        $until = $this->input('until');

        return [
            'action' => $action,
            'restriction' => RestrictionType::tryFrom($this->string('restriction')->value()),
            'until' => is_string($until) && $until !== '' ? CarbonImmutable::parse($until) : null,
            'statement' => Statement::fromArray($this->validated()),
        ];
    }
}
