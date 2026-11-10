<?php

use App\Http\Requests\Api\V1\Garage\ReorderModificationsRequest;
use App\Http\Requests\Api\V1\Garage\ReorderVehiclesRequest;
use App\Http\Requests\Api\V1\Media\ReorderMediaRequest;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The wildcard rules stay out of a list that is too long already (ValidatesBoundedIdList). Leaving them in gives the same answer and
 * only costs time, so this reads the rules: a wall-clock limit cannot tell the two apart.
 */
dataset('reorder requests', [
    'garage' => [ReorderVehiclesRequest::class, 'speedclub.garage.max_vehicles_per_member'],
    'mods' => [ReorderModificationsRequest::class, 'speedclub.garage.max_modifications_per_vehicle'],
    'photos' => [ReorderMediaRequest::class, 'speedclub.garage.max_photos_per_vehicle'],
]);

/**
 * @param  class-string<FormRequest>  $request
 * @return array<string, mixed>
 */
function boundedIdRulesFor(string $request, mixed $ids): array
{
    return $request::create('/x', 'PUT', ['ids' => $ids])->rules();
}

it('leaves the wildcard rules out of a list over the limit', function (string $request, string $limit) {
    $max = config()->integer($limit);

    expect(boundedIdRulesFor($request, array_fill(0, $max + 1, 'x')))
        ->toBe(['ids' => ['required', 'array', 'min:1', 'max:'.$max]]);
})->with('reorder requests');

it('keeps them for a list at the limit and for a shorter one', function (string $request, string $limit) {
    $max = config()->integer($limit);

    foreach ([$max, 1] as $count) {
        expect(boundedIdRulesFor($request, array_fill(0, $count, 'x')))
            ->toHaveKey('ids.*', ['required', 'string', 'ulid', 'distinct']);
    }
})->with('reorder requests');

it('keeps them when there is no list to count', function (string $request) {
    expect(boundedIdRulesFor($request, 'x'))->toHaveKey('ids.*');
})->with('reorder requests');
