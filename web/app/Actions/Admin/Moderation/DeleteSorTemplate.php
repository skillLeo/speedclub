<?php

namespace App\Actions\Admin\Moderation;

use App\Models\SorTemplate;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-24 (`moderation.templates`): removes a template. Decisions keep the text they were sent with. Audited `moderation.template_deleted`.
 *
 * @throws AuthorizationException
 */
class DeleteSorTemplate
{
    public function handle(Staff $staff, SorTemplate $template): void
    {
        StaffAtoms::ensure($staff, 'moderation.templates');

        DB::transaction(function () use ($staff, $template): void {
            Audit::record('moderation.template_deleted', $template, ['key' => $template->key, 'locale' => $template->locale, 'label' => $template->label], null, actor: $staff);
            $template->delete();
        });
    }
}
