<?php

namespace App\Http\Controllers\Admin\Editorial\Requests;

use App\Enums\SampleItemType;
use App\Http\Controllers\Admin\Support\ReasonRequest;
use Illuminate\Validation\Rule;

/** ADM-58 hide or show one sample item ⚿ (`content.edit`, reason 10–1000). */
class SampleItemRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'content.edit';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return ['type' => ['required', Rule::enum(SampleItemType::class)]];
    }

    public function type(): SampleItemType
    {
        return SampleItemType::from($this->string('type')->value());
    }
}
