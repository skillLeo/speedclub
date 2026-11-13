<?php

namespace App\Http\Controllers\Admin\Events;

use App\Http\Controllers\Admin\Support\ActivityFeed;
use App\Http\Controllers\Controller;
use App\Models\Event;
use App\Models\Staff;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-54 Treffen-Detail and the SplitQueue's right pane (JSON preview of the same record). The right column is the event's audit trail
 * (ActivityFeed: reasons only for audit.view holders).
 */
class EventShowController extends Controller
{
    public function show(Request $request, string $event): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        $model = self::find($event);

        return Inertia::render('Events/Show', [
            'event' => EventAdminRecord::detail($model, $staff),
            'activity' => fn (): array => ActivityFeed::for([$model->getMorphClass() => [$model->id]], $staff),
        ]);
    }

    public function preview(Request $request, string $event): JsonResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return response()->json(['event' => EventAdminRecord::detail(self::find($event), $staff)]);
    }

    public static function find(string $id): Event
    {
        $event = Event::query()->with('organiser')->find(strtolower($id));
        abort_if($event === null, 404);

        return $event;
    }
}
