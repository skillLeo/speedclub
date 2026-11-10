<?php

namespace App\Actions\Admin\Overview;

use App\Models\Staff;
use App\Services\Audit\Audit;
use Illuminate\Support\Facades\DB;

/**
 * Deletes one of the staff member's own DataTable views. Audited.
 */
final class DeleteTableView
{
    /**
     * @return bool false when the view is not this staff member's (the controller answers 404, as for a missing one)
     */
    public function __invoke(Staff $staff, string $id): bool
    {
        return DB::transaction(function () use ($staff, $id): bool {
            $row = DB::table('admin_saved_views')->where(['id' => $id, 'staff_id' => $staff->id])->lockForUpdate()->first(['table_key', 'name']);

            if ($row === null) {
                return false;
            }

            DB::table('admin_saved_views')->where('id', $id)->delete();
            Audit::record('admin.saved_view.deleted', before: ['id' => $id, 'table' => $row->table_key, 'name' => $row->name], actor: $staff);

            return true;
        });
    }
}
