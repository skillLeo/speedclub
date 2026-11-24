<?php

namespace App\Http\Controllers\Admin\CarOfTheDay;

use App\Actions\Admin\CarOfTheDay\OverrideCarOfTheDay;
use App\Actions\Admin\CarOfTheDay\SkipCarOfTheDay;
use App\Http\Controllers\Admin\CarOfTheDay\Requests\OverrideCarOfTheDayRequest;
use App\Http\Controllers\Admin\CarOfTheDay\Requests\SkipCarOfTheDayRequest;
use App\Http\Controllers\Controller;
use Illuminate\Http\RedirectResponse;

/**
 * ADM-64 writes (m5.9d contract §3): "Anderes Auto festlegen" (OverrideCarOfTheDay: the day Home shows or later, a public build a guest may see in a
 * list, never a sample in production; its refusals come back as field errors on `day` and `vehicle_id`) and "Tag aussetzen"
 * (SkipCarOfTheDay). content.edit, a reason (10–1000), ⚿; audited by the actions (`car_of_the_day.overridden|skipped`).
 */
class CarOfTheDayActionsController extends Controller
{
    public function override(OverrideCarOfTheDayRequest $request, string $day, OverrideCarOfTheDay $override): RedirectResponse
    {
        $override->handle($request->staff(), $day, $request->string('vehicle_id')->value(), $request->reason());

        return back(303)->with('success', 'gift.cotd.flash.overridden');
    }

    public function skip(SkipCarOfTheDayRequest $request, string $day, SkipCarOfTheDay $skip): RedirectResponse
    {
        $skip->handle($request->staff(), $day, $request->reason());

        return back(303)->with('success', 'gift.cotd.flash.skipped');
    }
}
