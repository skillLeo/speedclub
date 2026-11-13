<?php

namespace App\Http\Resources\V1;

use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\Modification;
use App\Models\User;
use App\Services\Garage\BuildUpdatePresenter;
use App\Services\Social\Mentions;
use App\Services\Social\Reactions;
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
            /**
             * The owner's text: a note (up to 500 characters) or, since M4.11, a post (type `post`, up to 2,000, with @mentions).
             *
             * @var string|null
             */
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
            ...$this->social($update, $viewer),
        ];
    }

    /**
     * M4.11 (09 §8.5): what a post carries besides its text, and the private reactions. Automatic entries have no photos, mods or
     * mentions of their own; their lists stay empty without a query.
     *
     * @return array<string, mixed>
     */
    private function social(BuildUpdate $update, ?User $viewer): array
    {
        $authored = $update->type->isAuthored();
        $isOwner = $update->vehicle->isOwnedBy($viewer);
        $reactions = app(Reactions::class);
        $edited = $update->edited_at;
        $happened = $update->happened_on;

        return [
            'vehicle_id' => $update->vehicle_id,
            /** Kilometre reading the owner gave (UPD-01), else null. */
            'mileage_km' => $update->mileage_km,
            /**
             * The day it happened (Y-m-d), default the day of posting.
             */
            'happened_on' => $happened?->toDateString(),
            /** vehicle: whoever may see the vehicle; followers: only followers of the owner or the build (and the owner). */
            'audience' => $update->audience,
            /**
             * Set when the owner changed the post after posting: the app shows "bearbeitet".
             */
            'edited_at' => $edited?->toIso8601String(),
            /**
             * Owner only: until when text, photos and the rest can still be changed (24 hours after posting); null afterwards and for
             * automatic entries.
             *
             * @var string|null
             */
            'editable_until' => $this->when($isOwner, fn (): ?string => $update->isEditable() ? $update->created_at?->copy()->addHours(config()->integer('speedclub.social_2.update_edit_hours'))->toIso8601String() : null),
            /**
             * Up to 10 photos in the owner's order. The owner sees unfinished and failed uploads too.
             *
             * @var list<MediaResource>
             */
            'photos' => $authored ? $this->photos($update, $isOwner) : [],
            /**
             * Before/after pairs of the photos above, by media id.
             *
             * @var list<array{before: string, after: string}>
             */
            'photo_pairs' => array_map(fn (array $pair): array => ['before' => (string) $pair[0], 'after' => (string) $pair[1]], $update->photo_pairs ?? []),
            /**
             * Linked mods, in the owner's order (the mod row of VEH-02).
             *
             * @var list<array{id: string, title: string, category: string|null}>
             */
            'modifications' => $authored ? $update->modifications()->with('category')->get()->map(fn (Modification $mod): array => [
                'id' => (string) $mod->getKey(),
                'title' => (string) $mod->getAttribute('title'),
                'category' => $mod->category->getAttribute('key'),
            ])->values()->all() : [],
            /**
             * Members the text mentions whom the viewer may see; the app links "@name" in the text to them.
             *
             * @var list<MemberSummaryResource>
             */
            'mentions' => $authored
                ? array_map(fn (User $member): MemberSummaryResource => new MemberSummaryResource($member), app(Mentions::class)->forItems($update->getMorphClass(), [(string) $update->getKey()], $viewer)[(string) $update->getKey()] ?? [])
                : [],
            /**
             * The viewer's own reaction [build_reactions]; null for guests, the owner, none yet, or the flag off. Never anybody else's.
             *
             * @var 'strong'|'clean'|'low'|'loud'|null
             */
            'my_reaction' => $isOwner ? null : $reactions->mine($viewer, $update)?->value,
            /**
             * Owner only: reactions by kind and in total [build_reactions]. Missing for everybody else (09 §8.5).
             *
             * @var array{strong: int, clean: int, low: int, loud: int, total: int}
             */
            'reaction_summary' => $this->when($isOwner && $reactions->enabled(), fn (): array => $reactions->summary($update)),
        ];
    }

    /**
     * @return list<MediaResource>
     */
    private function photos(BuildUpdate $update, bool $isOwner): array
    {
        return array_values($update->photos()
            ->when(! $isOwner, fn ($query) => $query->usablePhoto())
            ->get()
            ->map(fn (Media $photo): MediaResource => new MediaResource($photo))
            ->all());
    }
}
