<?php

namespace App\Http\Requests\Api\V1\Wrapped;

/**
 * GET me/wrapped/{season_key}/cards/{n}.png (m5.9e contract §5): `n` is the card's 1-based position in the payload's `cards`.
 */
class WrappedCardRequest extends WrappedSeasonRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /**
             * The path's season key (see WrappedSeasonRequest).
             *
             * @ignoreParam
             */
            'season_key' => parent::rules()['season_key'],
            /**
             * The path's card position, validated here (validationData() reads the route); not a query field.
             *
             * @ignoreParam
             */
            'n' => ['required', 'integer', 'min:1', 'max:20'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function validationData(): array
    {
        return [...parent::validationData(), 'n' => $this->route('n')];
    }

    public function position(): int
    {
        return (int) $this->validated('n');
    }
}
