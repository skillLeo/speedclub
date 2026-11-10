<?php

namespace App\Actions\Garage;

use App\Models\BuildUpdate;

/**
 * A hidden entry stays for the owner and never shows publicly. It also closes: later changes start a new entry.
 */
class SetBuildUpdateHidden
{
    public function handle(BuildUpdate $update, bool $hidden): BuildUpdate
    {
        $update->forceFill(['hidden' => $hidden, 'open_until' => $hidden ? null : $update->getAttribute('open_until')])->save();

        return $update;
    }
}
