<?php

namespace App\Services\Discover;

use App\Models\Generation;
use App\Models\Make;
use App\Models\User;
use App\Models\VehicleModel;

/**
 * DISC-03 and the DISC-04 header (m2.3 contract §6): the models and generations of a make with the real number of builds the viewer can
 * find (VisibleBuilds, blocks included). Only entries with at least one build are listed; a make or model without any has no page.
 * Models by count, then name; generations oldest first. A build whose model was typed freely ("Nicht gefunden?") counts for its make only.
 */
final class MakePages
{
    public function __construct(private readonly VisibleBuilds $builds) {}

    public function make(?User $viewer, Make $make): ?MakePage
    {
        $counts = $this->counts($viewer, $make, null);

        if ($counts === []) {
            return null;
        }

        return new MakePage($make, array_sum(array_column($counts, 'hits')), $this->models($counts));
    }

    public function model(?User $viewer, VehicleModel $model): ?ModelCount
    {
        $make = $model->make;

        if (! $make instanceof Make) {
            return null;
        }

        $counts = $this->counts($viewer, $make, $model);

        return $this->models($counts)[0] ?? null;
    }

    public function makeCount(?User $viewer, Make $make): int
    {
        return $this->builds->query($viewer)->where('vs.make_id', $make->getKey())->count();
    }

    /**
     * @return list<array{model: int|null, generation: int|null, hits: int}>
     */
    private function counts(?User $viewer, Make $make, ?VehicleModel $model): array
    {
        $rows = $this->builds->query($viewer)
            ->where('vs.make_id', $make->getKey())
            ->when($model !== null, fn ($query) => $query->where('vs.model_id', $model?->getKey()))
            ->groupBy('vs.model_id', 'vs.generation_id')
            ->select('vs.model_id', 'vs.generation_id')
            ->selectRaw('COUNT(*) as hits')
            ->get();

        return array_values($rows->map(fn (object $row): array => [
            'model' => is_numeric($id = VisibleBuilds::column($row, 'model_id')) ? (int) $id : null,
            'generation' => is_numeric($id = VisibleBuilds::column($row, 'generation_id')) ? (int) $id : null,
            'hits' => (int) VisibleBuilds::column($row, 'hits'),
        ])->all());
    }

    /**
     * @param  list<array{model: int|null, generation: int|null, hits: int}>  $counts
     * @return list<ModelCount>
     */
    private function models(array $counts): array
    {
        $models = VehicleModel::query()->whereKey(array_filter(array_column($counts, 'model')))->with('make')->get()->keyBy('id');
        $generations = Generation::query()->whereKey(array_filter(array_column($counts, 'generation')))->get()->keyBy('id');
        $byModel = [];

        foreach ($counts as $count) {
            $model = $count['model'] === null ? null : $models->get($count['model']);

            if (! $model instanceof VehicleModel) {
                continue;
            }

            $byModel[$model->id]['model'] = $model;
            $byModel[$model->id]['hits'] = ($byModel[$model->id]['hits'] ?? 0) + $count['hits'];
            $generation = $count['generation'] === null ? null : $generations->get($count['generation']);

            if ($generation instanceof Generation && $generation->getAttribute('model_id') === $model->id) {
                $byModel[$model->id]['generations'][] = new GenerationCount($generation, $count['hits']);
            }
        }

        $result = [];

        foreach ($byModel as $entry) {
            $generationCounts = $entry['generations'] ?? [];
            usort($generationCounts, fn (GenerationCount $a, GenerationCount $b): int => [$a->generation->getAttribute('year_from') ?? PHP_INT_MAX, $a->generation->getAttribute('name')]
                <=> [$b->generation->getAttribute('year_from') ?? PHP_INT_MAX, $b->generation->getAttribute('name')]);
            $result[] = new ModelCount($entry['model'], $entry['hits'], $generationCounts);
        }

        usort($result, fn (ModelCount $a, ModelCount $b): int => [$b->count, mb_strtolower((string) $a->model->getAttribute('name'))]
            <=> [$a->count, mb_strtolower((string) $b->model->getAttribute('name'))]);

        return $result;
    }
}
