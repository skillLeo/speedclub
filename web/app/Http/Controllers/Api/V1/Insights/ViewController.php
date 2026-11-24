<?php

namespace App\Http\Controllers\Api\V1\Insights;

use App\Actions\Insights\RecordBeaconView;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Insights\RecordViewRequest;
use App\Support\Viewer;
use Illuminate\Http\Response;

/**
 * @tags Insights
 */
class ViewController extends Controller
{
    /**
     * Count a view (beacon).
     *
     * M5.7 (10 §6.1): the app sends this once per screen focus of a vehicle page (VEH-01) or a profile (PROF-02) that is not the
     * viewer's own; never from prefetches, lists or cards. One view per person, page and Europe/Berlin day; the person is stored only as
     * a hash with a key that is deleted when the day ends. Guests too. Always 204 for a well-formed body, whether the view counted or not
     * (own page, already counted today, unknown, hidden, blocked, staff view-as, flag `insights` off): the answer reveals nothing.
     *
     * @unauthenticated
     */
    public function store(RecordViewRequest $request, RecordBeaconView $action): Response
    {
        /** @var array{subject: string, source: string, id?: string, username?: string} $input */
        $input = $request->validated();
        $action->handle(Viewer::from($request), $request, $input);

        return response()->noContent();
    }
}
