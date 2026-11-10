<?php

namespace App\Actions\Admin\Support;

use App\Models\Staff;
use App\Models\SupportMacro;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-27 (`support.macros`): removes a macro; replies already sent keep their text. Audited `support.macro_deleted`.
 *
 * @throws AuthorizationException
 */
class DeleteSupportMacro
{
    public function handle(Staff $staff, SupportMacro $macro): void
    {
        StaffAtoms::ensure($staff, 'support.macros');

        DB::transaction(function () use ($staff, $macro): void {
            Audit::record('support.macro_deleted', $macro, $macro->only(['key', 'locale', 'title']), null, actor: $staff);
            $macro->delete();
        });
    }
}
