<?php

namespace App\Services\Signature;

use App\Enums\PowerDisplay;
use App\Models\Modification;
use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;
use Illuminate\Support\Collection;

/**
 * VEH-06 [SIG sig.compare] (02_PRODUCT_SPEC §5): two builds side by side. The spec tables of the Technik tab merged by group and row in the
 * order of the first build, then the second's new ones; a row is there when either build has a value. The mods by category in the
 * catalogue's order, each side with its own rows in the owner's order. Values are rendered for the viewer (language, power unit), so a
 * difference is a different string; the app emphasises it by weight.
 *
 * @phpstan-type CompareRow array{key: string, label: string, a: string|null, b: string|null, differs: bool}
 * @phpstan-type CompareGroup array{key: string, label: string, rows: list<CompareRow>}
 * @phpstan-type CompareMods array{key: string, label: string, icon: string|null, a: list<Modification>, b: list<Modification>}
 */
final class CompareBuilds
{
    /** What the comparison reads of each vehicle. */
    public const RELATIONS = ['make', 'vehicleModel', 'generation', 'specs', 'cover', 'media', 'activeQrCode', 'modifications.category.fields', 'modifications.brand', 'modifications.media', 'modifications.vehicle'];

    public function __construct(private readonly VehiclePresenter $presenter) {}

    /**
     * @return list<CompareGroup>
     */
    public function specs(Vehicle $a, Vehicle $b, PowerDisplay $display, string $locale): array
    {
        $left = $this->presenter->specGroups($a, $display, $locale);
        $right = $this->presenter->specGroups($b, $display, $locale);
        $groups = [];

        foreach ($this->keys($left, $right) as $groupKey) {
            $leftGroup = $this->find($left, $groupKey);
            $rightGroup = $this->find($right, $groupKey);
            $leftRows = $leftGroup['rows'] ?? [];
            $rightRows = $rightGroup['rows'] ?? [];
            $rows = [];

            foreach ($this->keys($leftRows, $rightRows) as $rowKey) {
                $leftRow = $this->find($leftRows, $rowKey);
                $rightRow = $this->find($rightRows, $rowKey);
                $valueA = $this->present($leftRow['value'] ?? null);
                $valueB = $this->present($rightRow['value'] ?? null);

                if ($valueA !== null || $valueB !== null) {
                    $rows[] = [
                        'key' => $rowKey,
                        'label' => (string) ($leftRow['label'] ?? $rightRow['label'] ?? $rowKey),
                        'a' => $valueA,
                        'b' => $valueB,
                        'differs' => ! $this->same($valueA, $valueB),
                    ];
                }
            }

            if ($rows !== []) {
                $groups[] = ['key' => $groupKey, 'label' => (string) ($leftGroup['label'] ?? $rightGroup['label'] ?? $groupKey), 'rows' => $rows];
            }
        }

        return $groups;
    }

    /**
     * @return list<CompareMods>
     */
    public function mods(Vehicle $a, Vehicle $b, string $locale): array
    {
        $sorted = fn (Vehicle $vehicle): Collection => $vehicle->modifications->sortBy([['sort', 'asc'], ['id', 'asc']])->values();
        $all = $sorted($a)->concat($sorted($b));
        $categories = $all->map(fn (Modification $mod) => $mod->category)->unique('id')->sortBy([['sort', 'asc'], ['id', 'asc']]);
        $result = [];

        foreach ($categories as $category) {
            $of = fn (Vehicle $vehicle): array => array_values($sorted($vehicle)->filter(fn (Modification $mod): bool => $mod->getAttribute('category_id') === $category->getKey())->all());

            $result[] = [
                'key' => $category->key,
                'label' => (string) $category->getTranslation('name', $locale),
                'icon' => $category->getAttribute('icon'),
                'a' => $of($a),
                'b' => $of($b),
            ];
        }

        return $result;
    }

    /**
     * @param  list<array{key: string}>  $left
     * @param  list<array{key: string}>  $right
     * @return list<string>
     */
    private function keys(array $left, array $right): array
    {
        return array_values(array_unique([...array_column($left, 'key'), ...array_column($right, 'key')]));
    }

    /**
     * @template T of array{key: string}
     *
     * @param  list<T>  $items
     * @return T|null
     */
    private function find(array $items, string $key): ?array
    {
        foreach ($items as $item) {
            if ($item['key'] === $key) {
                return $item;
            }
        }

        return null;
    }

    private function present(mixed $value): ?string
    {
        $text = is_string($value) ? trim($value) : '';

        return $text === '' ? null : $text;
    }

    /**
     * The same value in other spacing or case is the same value ("AWD" and "awd"), as the app reads it.
     */
    private function same(?string $a, ?string $b): bool
    {
        $key = fn (?string $value): ?string => $value === null ? null : mb_strtolower((string) preg_replace('/\s+/u', ' ', $value));

        return $key($a) === $key($b);
    }
}
