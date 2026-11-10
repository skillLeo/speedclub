<?php

namespace App\Actions\Garage;

use App\Enums\KeywordField;
use App\Enums\VehicleStatus;
use App\Models\BuildUpdate;
use App\Models\Vehicle;
use App\Services\Garage\BuildUpdates;
use App\Services\Notifications\PublicationFanout;
use App\Services\Rules\ContentScreen;

class AddBuildNote
{
    public function __construct(
        private readonly BuildUpdates $updates,
        private readonly PublicationFanout $fanout,
        private readonly ContentScreen $screen,
    ) {}

    public function handle(Vehicle $vehicle, string $note): BuildUpdate
    {
        // M3.4 (ADM-23): keyword rules on the note (block refuses with 422 content_blocked, flag files an automated report).
        $flags = $this->screen->screen(['note' => [KeywordField::BuildNote, $note]]);
        $update = $this->updates->note($vehicle, $note);
        $this->screen->flagAfterCommit($flags, $update);

        if ($vehicle->status === VehicleStatus::Published) {
            $this->fanout->updateCreated($update);
        }

        return $update;
    }
}
