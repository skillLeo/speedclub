<?php

namespace App\Http\Requests\Api\V1\Businesses;

use App\Enums\ModTagStatus;
use Illuminate\Validation\Rule;

/**
 * BIZ-04 Anfragen and the member's confirmations: `status` (default pending), `direction` incoming (the other side asked; the reader
 * decides) or outgoing (the reader asked), default incoming.
 */
class TagListRequest extends BusinessPageRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            ...parent::rules(),
            'status' => ['sometimes', Rule::enum(ModTagStatus::class)],
            'direction' => ['sometimes', Rule::in(['incoming', 'outgoing'])],
        ];
    }

    public function status(): ModTagStatus
    {
        return ModTagStatus::tryFrom((string) $this->validated('status')) ?? ModTagStatus::Pending;
    }

    public function incoming(): bool
    {
        return ($this->validated('direction') ?? 'incoming') === 'incoming';
    }
}
