<?php

namespace App\Http\Requests\Api\V1\Dex;

use App\Rules\ValidCursor;
use App\Services\Dex\DexFilter;
use Illuminate\Foundation\Http\FormRequest;

/**
 * GET me/dex (m5.9b contract §3): `filter` = all, rarity:{street|tuned|rare|legend|ghost}, make:{make slug} or set:{set key}.
 */
class DexListRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'filter' => ['nullable', 'string', 'max:90', 'regex:'.DexFilter::PATTERN],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'cursor' => ['nullable', 'string', 'max:1000', new ValidCursor(['spot_id'])],
        ];
    }

    public function dexFilter(): DexFilter
    {
        return DexFilter::parse($this->string('filter')->toString());
    }

    public function pageSize(): int
    {
        return $this->filled('per_page') ? $this->integer('per_page') : config()->integer('speedclub.dex.per_page');
    }
}
