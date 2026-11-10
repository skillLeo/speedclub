<?php

namespace App\Http\Controllers\Admin\Catalog;

use App\Actions\Admin\Catalog\AcceptCatalogRequest;
use App\Actions\Admin\Catalog\RejectCatalogRequest;
use App\Http\Controllers\Admin\Catalog\Requests\AcceptRequest;
use App\Http\Controllers\Admin\Catalog\Requests\RejectRequest;
use App\Http\Controllers\Admin\Catalog\Support\Refusals;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\CatalogRequest;
use App\Models\Generation;
use App\Models\Make;
use App\Models\Staff;
use App\Models\VehicleModel;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-14 tab "Anfragen" (m3.3-contract §2): the members' "Nicht gefunden?" entries (catalog.view), "Übernehmen" (pick or create the
 * entry per level, relink the requester's vehicle, the member is told in-app) and "Ablehnen" (reason, shown to the member), both
 * `catalog.manage`. `options` is the picker of the accept drawer: active entries that are not merged.
 */
class CatalogRequestsController extends Controller
{
    public function index(Request $request): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return Inertia::render('Catalog/Requests', [
            ...TableProps::make(CatalogListQuery::requests($request), $request, CatalogListQuery::REQUESTS, $staff, fn (array $rows): array => CatalogListQuery::requestRows($rows), CatalogListQuery::REQUESTS_SORT),
            'counts' => fn (): array => MakesController::tabCounts(),
        ]);
    }

    public function options(): JsonResponse
    {
        return response()->json([
            'makes' => Make::query()->whereNull('merged_into_id')->where('active', true)->orderBy('name')->orderBy('id')->get(['id', 'name', 'slug'])
                ->map(fn (Make $make): array => ['id' => (int) $make->getKey(), 'name' => (string) $make->getAttribute('name'), 'slug' => (string) $make->getAttribute('slug')])->values(),
            'models' => VehicleModel::query()->whereNull('merged_into_id')->where('active', true)->orderBy('name')->orderBy('id')->get(['id', 'make_id', 'name', 'slug'])
                ->map(fn (VehicleModel $model): array => ['id' => (int) $model->getKey(), 'make_id' => (int) $model->getAttribute('make_id'), 'name' => (string) $model->getAttribute('name'), 'slug' => (string) $model->getAttribute('slug')])->values(),
            'generations' => Generation::query()->whereNull('merged_into_id')->where('active', true)->orderByRaw('year_from IS NULL')->orderBy('year_from')->orderBy('name')->orderBy('id')->get(['id', 'model_id', 'name', 'year_from', 'year_to'])
                ->map(fn (Generation $generation): array => [
                    'id' => (int) $generation->getKey(),
                    'model_id' => (int) $generation->getAttribute('model_id'),
                    'name' => (string) $generation->getAttribute('name'),
                    'year_from' => $generation->getAttribute('year_from'),
                    'year_to' => $generation->getAttribute('year_to'),
                ])->values(),
        ]);
    }

    public function accept(AcceptRequest $request, CatalogRequest $catalogRequest, AcceptCatalogRequest $accept): RedirectResponse
    {
        return Refusals::answer(function () use ($request, $catalogRequest, $accept): RedirectResponse {
            $accept->handle($request->staff(), $catalogRequest, $request->choice(), $request->reason());

            return back(303)->with('success', 'catalog.flash.request_accepted');
        });
    }

    public function reject(RejectRequest $request, CatalogRequest $catalogRequest, RejectCatalogRequest $reject): RedirectResponse
    {
        return Refusals::answer(function () use ($request, $catalogRequest, $reject): RedirectResponse {
            $reject->handle($request->staff(), $catalogRequest, (string) $request->reason());

            return back(303)->with('success', 'catalog.flash.request_rejected');
        });
    }
}
