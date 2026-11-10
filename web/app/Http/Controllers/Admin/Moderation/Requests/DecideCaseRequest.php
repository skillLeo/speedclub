<?php

namespace App\Http\Controllers\Admin\Moderation\Requests;

use App\Enums\DecisionAction;
use App\Enums\RestrictionType;
use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Services\Moderation\Statement;
use Carbon\CarbonImmutable;
use Illuminate\Validation\Rule;

/**
 * ADM-21/22 decision composer (recent password): the action, for restrict the restriction, an end (none = no end date), the statement of
 * reasons (required for every action but no_action) and the audit reason. The case's target decides whether moderation.messages is
 * needed too (DecideCaseAsStaff).
 */
class DecideCaseRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'moderation.decide';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        $statement = Statement::rules();
        $optional = fn (array $rules): array => array_map(fn (mixed $rule): mixed => $rule === 'required' ? 'required_unless:action,no_action' : $rule, $rules);

        return [
            'action' => ['required', Rule::in([DecisionAction::NoAction->value, DecisionAction::RemoveContent->value, DecisionAction::Restrict->value, DecisionAction::Suspend->value])],
            'restriction' => ['required_if:action,restrict', 'nullable', Rule::enum(RestrictionType::class)],
            'until' => ['nullable', 'date', 'after:now'],
            'facts' => ['nullable', ...$optional($statement['facts'])],
            'ground' => ['nullable', ...$optional($statement['ground'])],
            'ground_document' => ['nullable', ...$optional($statement['ground_document'])],
            'ground_section' => $statement['ground_section'],
            'template' => ['nullable', 'string', 'max:60'],
        ];
    }

    public function action(): DecisionAction
    {
        return DecisionAction::from($this->string('action')->value());
    }

    public function restriction(): ?RestrictionType
    {
        return $this->action() === DecisionAction::Restrict ? RestrictionType::tryFrom($this->string('restriction')->value()) : null;
    }

    public function until(): ?CarbonImmutable
    {
        $value = $this->input('until');

        return in_array($this->action(), [DecisionAction::Restrict, DecisionAction::Suspend], true) && is_string($value) && $value !== '' ? CarbonImmutable::parse($value) : null;
    }

    public function statement(): ?Statement
    {
        return trim($this->string('facts')->value()) === '' ? null : Statement::fromArray($this->validated());
    }
}
