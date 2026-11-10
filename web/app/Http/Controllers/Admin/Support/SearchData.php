<?php

namespace App\Http\Controllers\Admin\Support;

use App\Models\Staff;
use App\Services\Admin\Search;
use Illuminate\Support\Facades\Route;

/**
 * Global search for ADM-07 and the ⌘K palette (contract §1.7). The service decides groups and atoms; this adds the record URL,
 * once the module that owns the record page has registered its route (conventional names below).
 */
class SearchData
{
    public const MAX_QUERY = Search::MAX_QUERY;

    /** Record page route and its parameter per group (ADM-10, ADM-12, ADM-19, ADM-21). */
    private const RECORD_ROUTES = [
        'members' => ['admin.members.show', 'member'],
        'vehicles' => ['admin.vehicles.show', 'vehicle'],
        'qr' => ['admin.qr.show', 'qr'],
        'cases' => ['admin.moderation.cases.show', 'case'],
    ];

    public function __construct(private readonly Search $search) {}

    /**
     * @return list<array{group: 'members'|'vehicles'|'qr'|'cases', items: list<array{id: string, title: string, subtitle: string|null, url: string|null}>}>
     */
    public function search(Staff $staff, string $query): array
    {
        return array_map(function (array $group): array {
            [$name, $parameter] = self::RECORD_ROUTES[$group['group']];
            $exists = Route::has($name);

            return [
                'group' => $group['group'],
                'items' => array_map(fn (array $item): array => [
                    ...$item,
                    'url' => $item['url'] ?? ($exists ? route($name, [$parameter => $item['id']], false) : null),
                ], $group['items']),
            ];
        }, $this->search->search($staff, $query));
    }
}
