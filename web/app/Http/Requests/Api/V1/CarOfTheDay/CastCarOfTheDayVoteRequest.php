<?php

namespace App\Http\Requests\Api\V1\CarOfTheDay;

use Illuminate\Foundation\Http\FormRequest;

/**
 * R4-2.1 (contract-cotd-voting §2.2): the round's day and the chosen candidate.
 */
class CastCarOfTheDayVoteRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** The round's day (round.day of GET car-of-the-day/vote), Y-m-d. */
            'day' => ['required', 'string', 'date_format:Y-m-d'],
            /** A candidate's vehicle id (ULID). */
            'vehicle_id' => ['required', 'string', 'ulid'],
        ];
    }

    public function day(): string
    {
        return (string) $this->validated('day');
    }

    public function vehicleId(): string
    {
        return strtolower((string) $this->validated('vehicle_id'));
    }
}
