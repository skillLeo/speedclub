<?php

namespace App\Http\Controllers\Admin\Config;

use App\Actions\Admin\Config\RecordRelease;
use App\Actions\Admin\Config\SyncReleases;
use App\Http\Controllers\Admin\Config\Requests\ReleaseRequest;
use App\Http\Controllers\Admin\Config\Requests\ReleasesSyncRequest;
use App\Http\Controllers\Admin\Config\Support\ConfigAnswers;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\Release;
use App\Models\Staff;
use App\Services\Releases\ReleaseRegister;
use App\Support\SafeMarkdown;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\QueryBuilder;
use Symfony\Component\HttpFoundation\Response as HttpResponse;

/**
 * ADM-38 Release-Register (06 §3): version name and code, platform, channel, APK SHA-256, notes, date, and where the row came from
 * (docs/RELEASES.md or a manual entry). Filters platform, channel and version; "Aus RELEASES.md übernehmen" runs the idempotent sync.
 */
class ReleasesController extends Controller
{
    public const TABLE = 'releases';

    public const DEFAULT_SORT = '-released_at';

    public function index(Request $request): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        $query = QueryBuilder::for(Release::query(), $request)
            ->allowedFilters(
                AllowedFilter::exact('platform'),
                AllowedFilter::exact('channel'),
                AllowedFilter::callback('q', fn (Builder $q, mixed $value) => $q->where('version_name', 'like', addcslashes(is_string($value) ? trim($value) : '', '%_\\').'%'))->delimiter("\u{1}"),
            )
            ->allowedSorts('released_at', 'version_code', 'version_name')
            ->defaultSort(self::DEFAULT_SORT);
        $query->getEloquentBuilder()->orderByDesc('id');

        return Inertia::render('Config/Releases', [
            ...TableProps::make($query, $request, self::TABLE, $staff, function (array $rows): array {
                $names = Staff::query()->whereIn('id', array_filter(array_map(fn (Release $release): ?int => $release->created_by, $rows)))->pluck('name', 'id');

                return array_map(fn (Release $release): array => [
                    'id' => (string) $release->id,
                    ...RecordRelease::describe($release),
                    'released_at' => $release->released_at?->toIso8601String(),
                    'source' => $release->source->value,
                    'created_by' => $release->created_by === null ? null : ($names[$release->created_by] ?? null),
                    // DQ-614: one line in the table, the full note (rendered safely) in the Notizen drawer.
                    'notes_summary' => ReleaseRegister::summary($release->notes),
                    'notes_html' => $release->notes === null ? null : (string) SafeMarkdown::render($release->notes),
                ], $rows);
            }, self::DEFAULT_SORT),
            'registerFile' => is_file(config()->string('speedclub.content.releases_path')),
        ]);
    }

    public function store(ReleaseRequest $request, RecordRelease $record): HttpResponse
    {
        return ConfigAnswers::run($request, function () use ($request, $record) {
            $record->handle($request->staff(), $request->release());

            return back(303)->with('success', 'config.flash.release_recorded');
        });
    }

    public function update(ReleaseRequest $request, RecordRelease $record): HttpResponse
    {
        $release = Release::query()->find((int) $request->route('release'));
        abort_if($release === null, 404);

        return ConfigAnswers::run($request, function () use ($request, $record, $release) {
            $record->revise($request->staff(), $release, $request->release(), $request->reasonOrNull());

            return back(303)->with('success', 'config.flash.release_updated');
        });
    }

    public function sync(ReleasesSyncRequest $request, SyncReleases $sync): HttpResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $result = $sync->handle($staff);

        if ($result === null) {
            return back(303)->with('error', 'config.flash.releases_file_missing');
        }

        return back(303)->with('success', $result['created'] + $result['updated'] > 0 ? 'config.flash.releases_synced' : 'config.flash.releases_unchanged');
    }
}
