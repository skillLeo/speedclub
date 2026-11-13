<?php

namespace App\Http\Controllers\Admin\Businesses;

use App\Http\Controllers\Admin\Support\ActivityFeed;
use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\Staff;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-56 Betrieb-Detail and the SplitQueue's right pane (JSON preview of the same record). The right column is the business's audit
 * trail (ActivityFeed: reasons only for audit.view holders).
 */
class BusinessShowController extends Controller
{
    public function show(Request $request, string $business): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $model = self::find($business);

        return Inertia::render('Businesses/Show', [
            'business' => BusinessAdminRecord::detail($model, $staff),
            'activity' => fn (): array => ActivityFeed::for([$model->getMorphClass() => [$model->id]], $staff),
        ]);
    }

    public function preview(Request $request, string $business): JsonResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return response()->json(['business' => BusinessAdminRecord::detail(self::find($business), $staff)]);
    }

    public static function find(string $id): Business
    {
        $business = Business::query()->with('owner')->find(strtolower($id));
        abort_if($business === null, 404);

        return $business;
    }
}
