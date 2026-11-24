<?php

namespace App\Http\Controllers\Admin\Forum\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Services\Moderation\Statement;
use Carbon\CarbonImmutable;

/** ADM Forum "Forum-Sperre" (members.restrict, recent password): an end date or none, the statement of reasons and a reason. */
class ForumBanRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'members.restrict';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return ['until' => ['nullable', 'date', 'after:now'], ...Statement::rules()];
    }

    public function until(): ?CarbonImmutable
    {
        return $this->filled('until') ? CarbonImmutable::parse($this->string('until')->value()) : null;
    }
}
