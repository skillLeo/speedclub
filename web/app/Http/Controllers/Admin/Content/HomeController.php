<?php

namespace App\Http\Controllers\Admin\Content;

use App\Enums\ConfigKey;
use App\Enums\SearchSort;
use App\Http\Controllers\Admin\Config\Support\ConfigEditor;
use App\Http\Controllers\Admin\Content\Support\VehicleChoices;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-29 Startseite kuratieren (06 §3, m3.5 §2): featured builds with a date range (at most speedclub.content.featured_live_max live at
 * any moment) and the Discover collections (filter or hand-picked builds), as the home_curation draft. Saving and publishing go through
 * ConfigDraftController; the picker searches published builds (JSON).
 */
class HomeController extends Controller
{
    public function index(Request $request, ConfigEditor $editor, VehicleChoices $choices): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $props = $editor->props(ConfigKey::HomeCuration, $staff);
        $payload = $props['payload'];

        $ids = [];
        foreach (is_array($payload['featured'] ?? null) ? $payload['featured'] : [] as $entry) {
            $ids[] = is_array($entry) && is_string($entry['vehicle_id'] ?? null) ? $entry['vehicle_id'] : '';
        }
        foreach (is_array($payload['collections'] ?? null) ? $payload['collections'] : [] as $collection) {
            if (is_array($collection)) {
                foreach (is_array($collection['vehicle_ids'] ?? null) ? $collection['vehicle_ids'] : [] as $id) {
                    $ids[] = is_string($id) ? $id : '';
                }
                $ids[] = is_string($collection['cover_vehicle_id'] ?? null) ? $collection['cover_vehicle_id'] : '';
            }
        }

        return Inertia::render('Content/Home', [
            'editor' => $props,
            'vehicles' => (object) $choices->summaries($ids),
            'limits' => [
                'live' => config()->integer('speedclub.content.featured_live_max'),
                'featured' => config()->integer('speedclub.content.featured_max'),
                'collections' => config()->integer('speedclub.content.collections_max'),
                'collection_vehicles' => config()->integer('speedclub.content.collection_vehicles_max'),
            ],
            'sorts' => array_map(fn (SearchSort $sort): string => $sort->value, SearchSort::cases()),
        ]);
    }

    public function vehicles(Request $request, VehicleChoices $choices): JsonResponse
    {
        $term = $request->query('q');

        return response()->json(['data' => $choices->search(is_string($term) ? mb_substr($term, 0, 80) : '')]);
    }
}
