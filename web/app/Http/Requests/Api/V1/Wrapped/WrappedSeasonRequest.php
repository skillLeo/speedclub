<?php

namespace App\Http\Requests\Api\V1\Wrapped;

use App\Services\Wrapped\Season;
use Illuminate\Foundation\Http\FormRequest;

/**
 * GET me/wrapped/{season_key} and POST …/shared (m5.9e contract §5): the season key from the path, `YYYY-saison` or `YYYY-jahr`;
 * anything else is 422 on `season_key`.
 */
class WrappedSeasonRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /**
             * The path's season key, validated here (validationData() reads the route); not a query or body field.
             *
             * @ignoreParam
             */
            'season_key' => ['required', 'string', 'regex:/\A'.Season::PATTERN.'\z/'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function validationData(): array
    {
        return [...$this->all(), 'season_key' => $this->route('season_key')];
    }

    public function seasonKey(): string
    {
        return (string) $this->validated('season_key');
    }
}
