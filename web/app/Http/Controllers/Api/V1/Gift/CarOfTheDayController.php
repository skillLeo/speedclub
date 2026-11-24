<?php

namespace App\Http\Controllers\Api\V1\Gift;

use App\Actions\Gift\UpdateCarOfTheDayStory;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Gift\CarOfTheDayStoryRequest;
use App\Http\Resources\V1\CarOfTheDayStoryResource;
use App\Models\Vehicle;
use Illuminate\Support\Facades\Gate;

class CarOfTheDayController extends Controller
{
    /**
     * Edit my Car of the Day story line.
     *
     * M5.9d (m5.9d contract §3, §10.3): owner only, while the car is the Car of the Day on Home (18:00 to 18:00), else 409
     * `not_car_of_the_day`. `story_line` ≤ 140 characters, whitespace collapsed; null or empty removes it. Keyword rules as for the
     * description: a blocked term answers 422 `content_blocked` on `story_line`.
     */
    public function update(CarOfTheDayStoryRequest $request, Vehicle $vehicle, UpdateCarOfTheDayStory $action): CarOfTheDayStoryResource
    {
        Gate::authorize('update', $vehicle);

        return new CarOfTheDayStoryResource(['story_line' => $action->handle($vehicle, $request->storyLine())]);
    }
}
