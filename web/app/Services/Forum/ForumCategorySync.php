<?php

namespace App\Services\Forum;

use App\Enums\Bundesland;
use App\Enums\ForumCategoryKind;
use App\Models\ForumCategory;
use App\Models\Make;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The category structure of 10 §7.1, kept by slug: what is missing is created, what staff changed (names, order, active) is never
 * touched. "Marken & Modelle" gets one sub-category per active catalogue make, "Treffen & Regionen" one per Bundesland. Runs from
 * ForumCategorySeeder (every environment) and from ADM Forum › Kategorien "Marken abgleichen".
 */
final class ForumCategorySync
{
    public const MAKES = 'marken-modelle';

    public const REGIONS = 'treffen-regionen';

    /**
     * slug => [de, en, icon, description de, description en, children: slug => [de, en]]
     *
     * @var array<string, array{0: string, 1: string, 2: string, 3: string, 4: string, 5: array<string, array{0: string, 1: string}>}>
     */
    private const TREE = [
        'technik-tuning' => ['Technik & Tuning', 'Tech & tuning', 'Wrench', 'Fragen und Erfahrungen rund um Umbauten und Wartung.', 'Questions and experience around builds and maintenance.', [
            'motor' => ['Motor', 'Engine'],
            'fahrwerk' => ['Fahrwerk', 'Suspension'],
            'bremsen' => ['Bremsen', 'Brakes'],
            'raeder-reifen' => ['Räder & Reifen', 'Wheels & tyres'],
            'abgasanlage' => ['Abgasanlage', 'Exhaust'],
            'elektronik' => ['Elektronik', 'Electronics'],
        ]],
        self::MAKES => ['Marken & Modelle', 'Makes & models', 'Car', 'Ein Bereich pro Marke.', 'One section per make.', []],
        'kaufberatung' => ['Kaufberatung', 'Buying advice', 'Handshake', 'Worauf achten beim Kauf von Auto und Teilen?', 'What to look for when buying a car or parts.', []],
        'werkstaetten-teile' => ['Werkstätten & Teile', 'Workshops & parts', 'Storefront', 'Empfehlungen und Erfahrungen mit Werkstätten und Händlern.', 'Recommendations and experience with workshops and dealers.', []],
        self::REGIONS => ['Treffen & Regionen', 'Meets & regions', 'MapPin', 'Leute aus deiner Gegend finden und Treffen absprechen.', 'Find people near you and plan meets.', []],
        'pflege-detailing' => ['Pflege & Detailing', 'Care & detailing', 'Sparkle', 'Waschen, polieren, versiegeln.', 'Washing, polishing, sealing.', []],
        'off-topic' => ['Off-Topic', 'Off-topic', 'ChatsCircle', 'Alles andere, freundlich und ohne Werbung.', 'Everything else, friendly and without ads.', []],
    ];

    /**
     * @return array{created: int}
     */
    public function run(): array
    {
        return DB::transaction(function (): array {
            $created = 0;
            $sort = 0;

            foreach (self::TREE as $slug => [$de, $en, $icon, $aboutDe, $aboutEn, $children]) {
                $parent = $this->ensure($slug, null, ForumCategoryKind::Standard, $de, $en, $icon, $aboutDe, $aboutEn, $sort++, $created);
                $childSort = 0;

                foreach ($children as $childSlug => [$childDe, $childEn]) {
                    $this->ensure($childSlug, $parent->id, ForumCategoryKind::Standard, $childDe, $childEn, null, null, null, $childSort++, $created);
                }
            }

            $created += $this->makes();
            $created += $this->regions();

            return ['created' => $created];
        });
    }

    /**
     * One sub-category per active make that has none yet, ordered by the make's name.
     */
    public function makes(): int
    {
        $parent = ForumCategory::query()->where('slug', self::MAKES)->first();

        if (! $parent instanceof ForumCategory) {
            return 0;
        }

        $created = 0;
        $sort = (int) ForumCategory::query()->where('parent_id', $parent->id)->max('sort');

        foreach (Make::query()->where('active', true)->whereNull('merged_into_id')->orderBy('name')->get() as $make) {
            if (ForumCategory::query()->where('make_id', $make->id)->exists()) {
                continue;
            }

            $slug = $this->freeSlug('marke-'.Str::slug((string) $make->slug));
            $category = new ForumCategory;
            $category->forceFill([
                'parent_id' => $parent->id, 'slug' => $slug, 'kind' => ForumCategoryKind::Make, 'make_id' => $make->id,
                'name_de' => (string) $make->name, 'name_en' => (string) $make->name, 'sort' => ++$sort, 'is_active' => true,
            ])->save();
            $created++;
        }

        return $created;
    }

    private function regions(): int
    {
        $parent = ForumCategory::query()->where('slug', self::REGIONS)->first();

        if (! $parent instanceof ForumCategory) {
            return 0;
        }

        $created = 0;
        $states = Bundesland::cases();
        usort($states, fn (Bundesland $a, Bundesland $b): int => strcmp($a->label('de'), $b->label('de')));

        foreach ($states as $index => $state) {
            if (ForumCategory::query()->where('bundesland', $state->value)->exists()) {
                continue;
            }

            $category = new ForumCategory;
            $category->forceFill([
                'parent_id' => $parent->id, 'slug' => $this->freeSlug('region-'.strtolower($state->value)), 'kind' => ForumCategoryKind::Region,
                'bundesland' => $state->value, 'name_de' => $state->label('de'), 'name_en' => $state->label('en'), 'sort' => $index, 'is_active' => true,
            ])->save();
            $created++;
        }

        return $created;
    }

    private function ensure(string $slug, ?int $parentId, ForumCategoryKind $kind, string $de, string $en, ?string $icon, ?string $aboutDe, ?string $aboutEn, int $sort, int &$created): ForumCategory
    {
        $category = ForumCategory::query()->where('slug', $slug)->first();

        if ($category instanceof ForumCategory) {
            return $category;
        }

        $category = new ForumCategory;
        $category->forceFill([
            'parent_id' => $parentId, 'slug' => $slug, 'kind' => $kind, 'name_de' => $de, 'name_en' => $en, 'icon' => $icon,
            'description_de' => $aboutDe, 'description_en' => $aboutEn, 'sort' => $sort, 'is_active' => true,
        ])->save();
        $created++;

        return $category;
    }

    private function freeSlug(string $base): string
    {
        $base = substr($base, 0, 76);
        $slug = $base;
        $i = 2;

        while (ForumCategory::query()->where('slug', $slug)->exists()) {
            $slug = $base.'-'.$i++;
        }

        return $slug;
    }
}
