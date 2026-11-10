<?php

namespace App\Http\Resources\V1;

use App\Models\BuildUpdate;
use App\Services\Garage\BuildUpdatePresenter;
use App\Support\Viewer;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A row of Verlauf and the detail VEH-05. Rendered per viewer from what is stored, so language and power units follow them.
 *
 * @property BuildUpdate $resource
 */
class BuildUpdateResource extends JsonResource
{
    private bool $complete = false;

    /**
     * For the one entry of VEH-05: every change, with details. Lists stay at speedclub.garage.build_update_max_changes.
     */
    public function complete(): static
    {
        $this->complete = true;

        return $this;
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $update = $this->resource;
        $viewer = Viewer::from($request);
        $locale = app()->getLocale();
        $display = Viewer::powerDisplay($viewer);
        $presenter = app(BuildUpdatePresenter::class);
        $created = $update->getAttribute('created_at');
        $changes = $presenter->changes($update, $display, $locale, $this->complete ? null : config()->integer('speedclub.garage.build_update_max_changes'));

        return [
            /** @var string */
            'id' => $update->getKey(),
            'type' => $update->type,
            /** "Fahrwerk geändert", "Räder hinzugefügt", "Technik aktualisiert", "Fotos hinzugefügt", "Notiz" (DQ-290) */
            'type_label' => $presenter->typeLabel($update, $locale),
            /** @var string|null */
            'note' => $update->getAttribute('note'),
            /**
             * One line for lists: "Fahrwerk: Serie → KW V3 · −35 mm"
             */
            'summary' => $presenter->summary($update, $changes, $locale),
            /**
             * What happened, one entry per change. On lists at most 20, with details empty; the detail route has all of them, and
             * details holds field by field for a changed modification.
             *
             * @var list<array{kind: string, category: string|null, modification_id: string|null, label: string, before: string|null, after: string|null, text: string, details: list<array{label: string, before: string|null, after: string|null}>}>
             */
            'changes' => $this->complete ? $changes : array_map(fn (array $change): array => [...$change, 'details' => []], $changes),
            /**
             * How many changes the entry holds, also when a list shows fewer.
             *
             * @var int
             */
            'changes_count' => $presenter->changesCount($update),
            /** Always false for anybody but the owner, who alone sees hidden entries. */
            'hidden' => $update->hidden,
            /** @var string|null */
            'created_at' => $created instanceof CarbonInterface ? $created->toIso8601String() : null,
            /**
             * The timeline's group: "März 2023"
             *
             * @var string|null
             */
            'month_label' => $created instanceof CarbonInterface
                ? $created->copy()->setTimezone(config()->string('speedclub.display_timezone'))->locale($locale)->translatedFormat('F Y')
                : null,
        ];
    }
}
