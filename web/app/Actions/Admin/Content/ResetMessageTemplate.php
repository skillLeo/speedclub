<?php

namespace App\Actions\Admin\Content;

use App\Enums\ContentEvent;
use App\Models\MessageTemplate;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Content\MessageTemplates;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-33 "Auf Standard zurücksetzen" (`content.edit`): removes every override of a template and locale. Audited as `template.reset`.
 */
final class ResetMessageTemplate
{
    public function __construct(private readonly MessageTemplates $templates) {}

    /**
     * @throws AuthorizationException
     */
    public function handle(Staff $staff, string $key, string $locale): void
    {
        StaffAtoms::ensure($staff, 'content.edit');

        DB::transaction(function () use ($staff, $key, $locale): void {
            $row = MessageTemplate::query()->where('key', $key)->where('locale', $locale)->lockForUpdate()->first();

            if ($row === null) {
                return;
            }

            $row->delete();
            DB::afterCommit(fn () => $this->templates->flush());

            Audit::record(ContentEvent::TemplateReset->value, $row, before: ['key' => $key, 'locale' => $locale, 'fields' => $row->fields], actor: $staff);
        });
    }
}
