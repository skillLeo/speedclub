<?php

namespace App\Actions\Admin\Moderation;

use App\Enums\DecisionAction;
use App\Enums\GroundDocument;
use App\Models\SorTemplate;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-24 (`moderation.templates`): creates or edits a statement-of-reasons template (key + locale unique). The redress text is fixed by
 * law and not part of it. Audited `moderation.template_saved` with the changed fields.
 *
 * @throws AuthorizationException|ValidationException
 */
class SaveSorTemplate
{
    /**
     * @param  array{key: string, locale: string, action: DecisionAction, label: string, facts: string, ground: string, ground_document: GroundDocument, ground_section: string|null, sort: int}  $data
     */
    public function handle(Staff $staff, ?SorTemplate $template, array $data): SorTemplate
    {
        StaffAtoms::ensure($staff, 'moderation.templates');

        $clash = SorTemplate::query()->where('key', $data['key'])->where('locale', $data['locale'])
            ->when($template !== null, fn ($q) => $q->whereKeyNot($template?->id))->exists();

        if ($clash) {
            throw ValidationException::withMessages(['key' => [(string) __('validation.unique', ['attribute' => 'key'])]]);
        }

        return DB::transaction(function () use ($staff, $template, $data): SorTemplate {
            $row = $template ?? new SorTemplate;
            $before = $template === null ? null : self::snapshot($template);
            $row->forceFill([...$data, 'updated_by' => $staff->id])->save();

            Audit::record('moderation.template_saved', $row, $before, self::snapshot($row), actor: $staff);

            return $row;
        });
    }

    /**
     * @return array<string, mixed>
     */
    private static function snapshot(SorTemplate $template): array
    {
        return [
            'key' => $template->key,
            'locale' => $template->locale,
            'action' => $template->action->value,
            'label' => $template->label,
            'facts' => $template->facts,
            'ground' => $template->ground,
            'ground_document' => $template->ground_document->value,
            'ground_section' => $template->ground_section,
            'sort' => $template->sort,
        ];
    }
}
