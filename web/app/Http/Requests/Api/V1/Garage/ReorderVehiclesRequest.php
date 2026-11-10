<?php

namespace App\Http\Requests\Api\V1\Garage;

use App\Http\Requests\Concerns\ValidatesBoundedIdList;
use Illuminate\Foundation\Http\FormRequest;

class ReorderVehiclesRequest extends FormRequest
{
    use ValidatesBoundedIdList;

    // The size comes first and stops the rest: `distinct` grows with the square of the list, and validation runs ahead of the
    // policy, so an unbounded list would hold a PHP worker for a minute.
    protected $stopOnFirstFailure = true;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return $this->boundedIdRules(config()->integer('speedclub.garage.max_vehicles_per_member'));
    }
}
