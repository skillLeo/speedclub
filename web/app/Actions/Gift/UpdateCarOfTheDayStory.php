<?php

namespace App\Actions\Gift;

use App\Enums\ErrorCode;
use App\Enums\KeywordField;
use App\Exceptions\ApiException;
use App\Models\CarOfTheDay;
use App\Models\Vehicle;
use App\Services\CarOfTheDay\CarOfTheDays;
use App\Services\Rules\ContentScreen;

/**
 * The owner's story line of their Car of the Day (m5.9d contract §3, §10.3): only while the car is the pick on Home, at most 140
 * characters, screened by the keyword rules like the car's description (block → 422 content_blocked on story_line; flag → an automated
 * report about the car). An empty line removes it.
 */
final class UpdateCarOfTheDayStory
{
    public function __construct(
        private readonly CarOfTheDays $days,
        private readonly ContentScreen $screen,
    ) {}

    /**
     * @throws ApiException 409 not_car_of_the_day, 422 content_blocked
     */
    public function handle(Vehicle $vehicle, ?string $storyLine): ?string
    {
        $pick = $this->days->current();

        if (! $pick instanceof CarOfTheDay || $pick->vehicle_id !== $vehicle->id) {
            throw new ApiException(ErrorCode::NotCarOfTheDay);
        }

        $text = $storyLine === null ? null : trim(preg_replace('/\s+/u', ' ', $storyLine) ?? '');
        $text = $text === '' ? null : $text;
        $flags = $text === null ? [] : $this->screen->screen(['story_line' => [KeywordField::VehicleDescription, $text]]);

        $pick->forceFill(['story_line' => $text])->save();
        $this->screen->flagAfterCommit($flags, $vehicle);

        return $text;
    }
}
