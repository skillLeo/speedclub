<?php

namespace App\Http\Controllers\Admin\Content;

use App\Actions\Admin\Config\IssuePreviewToken;
use App\Enums\ConfigKey;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Models\Vehicle;
use App\Services\Config\ConfigVersions;
use App\Services\Garage\VehiclePresenter;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-34 Entwurfsvorschau (06 §3, m3.5 §2): a fresh signed preview token (15 min, bound to this staff member, read-only) on every
 * visit, and the three pages it opens in frames — /app Start, a vehicle in /app and the public vehicle page — as mobile (390) and
 * desktop (1280) × Carbon / Schwarz / Hell. The token selects only this staff member's own drafts; without one the frames show what
 * is live.
 */
class PreviewController extends Controller
{
    public function __invoke(Request $request, IssuePreviewToken $issue, ConfigVersions $versions, VehiclePresenter $presenter): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $token = $issue->handle($staff);

        $vehicle = $this->vehicle($versions);
        $drafts = [];
        foreach ([ConfigKey::Branding, ConfigKey::HomeCuration, ConfigKey::Announcements, ConfigKey::RemoteConfig] as $key) {
            $draft = $versions->draft($key);
            if ($draft !== null) {
                $drafts[] = ['key' => $key->value, 'version' => $draft->version, 'mine' => $draft->created_by === $staff->getKey()];
            }
        }

        return Inertia::render('Content/Preview', [
            'preview' => [
                'token' => $token['token'],
                'expires_at' => $token['expires_at'],
                'keys' => $token['keys'],
            ],
            'drafts' => $drafts,
            'vehicle' => $vehicle === null ? null : ['slug' => $vehicle->slug, 'title' => $presenter->fullTitle($vehicle)],
        ]);
    }

    /** The build the vehicle frames show: the first reachable featured build of the curation, else the newest published one. */
    private function vehicle(ConfigVersions $versions): ?Vehicle
    {
        $payload = $versions->startingPayload(ConfigKey::HomeCuration);
        $ids = [];
        foreach (is_array($payload['featured'] ?? null) ? $payload['featured'] : [] as $entry) {
            if (is_array($entry) && is_string($entry['vehicle_id'] ?? null)) {
                $ids[] = $entry['vehicle_id'];
            }
        }

        $relations = ['make', 'vehicleModel', 'generation'];
        $featured = $ids === [] ? null : Vehicle::query()->with($relations)->whereKey($ids)->get()
            ->filter(fn (Vehicle $vehicle): bool => $vehicle->isReachable())
            ->sortBy(fn (Vehicle $vehicle): int => (int) array_search($vehicle->id, $ids, true))->first();

        return $featured ?? Vehicle::query()->with($relations)->where('status', VehicleStatus::Published)
            ->where('visibility', Visibility::Public)->orderByDesc('published_at')->orderBy('id')->first();
    }
}
