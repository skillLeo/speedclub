<?php

namespace App\Http\Controllers\Admin\Moderation\Requests;

use App\Enums\KeywordList;
use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Services\Rules\KeywordNormaliser;
use Illuminate\Validation\Rule;

/** ADM-23 "Begriff hinzufügen" (`moderation.rules`, recent password, reason). */
class KeywordRuleRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'moderation.rules';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return [
            'term' => ['required', 'string', 'min:2', 'max:'.KeywordNormaliser::TERM_MAX],
            'list' => ['required', Rule::enum(KeywordList::class)],
        ];
    }
}
