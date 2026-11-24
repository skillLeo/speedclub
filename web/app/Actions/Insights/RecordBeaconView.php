<?php

namespace App\Actions\Insights;

use App\Enums\ViewSource;
use App\Enums\ViewSubject;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Garage\PublicMembers;
use App\Services\Insights\ViewRecorder;
use Illuminate\Http\Request;

/**
 * POST views (m5.7-contract §3.1): the subject the app opened, counted by ViewRecorder after the answer. Whatever the outcome (counted,
 * already counted today, not counted, unknown, hidden or blocked) the caller answers the same 204, so the beacon tells nobody anything.
 */
class RecordBeaconView
{
    public function __construct(
        private readonly ViewRecorder $recorder,
        private readonly PublicMembers $members,
    ) {}

    /**
     * @param  array{subject: string, source: string, id?: string, username?: string}  $input  validated
     */
    public function handle(?User $viewer, Request $request, array $input): void
    {
        $source = ViewSource::from($input['source']);

        if (ViewSubject::from($input['subject']) === ViewSubject::Vehicle) {
            $vehicle = Vehicle::query()->find($input['id'] ?? '');

            if ($vehicle instanceof Vehicle) {
                $this->recorder->storeLater($this->recorder->captureVehicle($vehicle, $source, $viewer, $request, page: false));
            }

            return;
        }

        $member = $this->members->find($input['username'] ?? '');

        if ($member !== null) {
            $this->recorder->storeLater($this->recorder->captureProfile($member, $source, $viewer, $request, page: false));
        }
    }
}
