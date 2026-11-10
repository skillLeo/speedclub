<?php

namespace App\Actions\Admin\Support;

use App\Models\Staff;
use App\Models\SupportMacro;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-27 (`support.macros`): creates or edits a reply macro (key + locale unique). Audited `support.macro_saved`.
 *
 * @throws AuthorizationException|ValidationException
 */
class SaveSupportMacro
{
    /**
     * @param  array{key: string, locale: string, title: string, body: string, sort: int}  $data
     */
    public function handle(Staff $staff, ?SupportMacro $macro, array $data): SupportMacro
    {
        StaffAtoms::ensure($staff, 'support.macros');

        $clash = SupportMacro::query()->where('key', $data['key'])->where('locale', $data['locale'])
            ->when($macro !== null, fn ($q) => $q->whereKeyNot($macro?->id))->exists();

        if ($clash) {
            throw ValidationException::withMessages(['key' => [(string) __('validation.unique', ['attribute' => 'key'])]]);
        }

        return DB::transaction(function () use ($staff, $macro, $data): SupportMacro {
            $row = $macro ?? new SupportMacro;
            $before = $macro === null ? null : $macro->only(['key', 'locale', 'title', 'body', 'sort']);
            $row->forceFill([...$data, 'updated_by' => $staff->id])->save();

            Audit::record('support.macro_saved', $row, $before, $row->only(['key', 'locale', 'title', 'body', 'sort']), actor: $staff);

            return $row;
        });
    }
}
