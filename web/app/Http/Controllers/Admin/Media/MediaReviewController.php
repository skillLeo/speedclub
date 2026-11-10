<?php

namespace App\Http\Controllers\Admin\Media;

use App\Enums\CaseStatus;
use App\Enums\DecisionAction;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\ReportTargetType;
use App\Http\Controllers\Admin\Support\MediaUrls;
use App\Http\Controllers\Controller;
use App\Models\Decision;
use App\Models\Media;
use App\Models\ModerationCase;
use App\Models\Modification;
use App\Models\Vehicle;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Garage\VehiclePresenter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as BaseBuilder;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-13 media review queue (m3.2-contract §2): tabs Neu (unreviewed uploads, newest first), Gemeldet (an open case on the photo),
 * Ausgeblendet (removed by a decision). Vehicle, mod and build-update photos and profile pictures; never a chat photo (message
 * content). The [AI] risk score slot stays empty until `ai.moderation_triage` is on (M3.7).
 */
class MediaReviewController extends Controller
{
    public const TABS = ['new', 'reported', 'hidden'];

    public const PER_PAGE = 24;

    /** Morph types of chat media: never in this queue. */
    public const PRIVATE_TYPES = ['message', 'conversation'];

    public function __invoke(Request $request, VehiclePresenter $presenter, FeatureFlags $flags): Response
    {
        $tab = $request->query('tab');
        $tab = is_string($tab) && in_array($tab, self::TABS, true) ? $tab : 'new';

        $page = self::query($tab)->paginate(self::PER_PAGE)->withQueryString();
        /** @var list<Media> $items */
        $items = array_values($page->items());

        $canReveal = $tab === 'hidden' && $request->user('staff')?->can('media.review') === true;
        // M3.7 [AI]: the triage's score and reason ("KI-Vorschlag") only while ai.moderation_triage is on; a suggestion, never a decision.
        $aiTriage = $flags->enabled('ai.moderation_triage');

        return Inertia::render('Media/Review', [
            'tab' => $tab,
            'items' => [
                'data' => self::rows($items, $presenter, $canReveal, $aiTriage),
                'meta' => [
                    'current_page' => $page->currentPage(),
                    'last_page' => $page->lastPage(),
                    'per_page' => $page->perPage(),
                    'total' => $page->total(),
                    'from' => $page->firstItem(),
                    'to' => $page->lastItem(),
                ],
            ],
            'counts' => fn (): array => array_combine(self::TABS, array_map(fn (string $t): int => self::query($t)->count(), self::TABS)),
            'aiTriage' => $aiTriage,
        ]);
    }

    /**
     * @return Builder<Media>
     */
    public static function base(): Builder
    {
        // The owner is eager-loaded for the whole page (SF-2: no query per photo).
        return Media::query()
            ->with('owner:id,username')
            ->where('status', MediaStatus::Ready)
            ->where(fn (Builder $q) => $q->whereNull('mediable_type')->orWhereNotIn('mediable_type', self::PRIVATE_TYPES));
    }

    /**
     * @return Builder<Media>
     */
    private static function query(string $tab): Builder
    {
        $open = fn (BaseBuilder $q) => $q->selectRaw('1')->from('moderation_cases')
            ->where('moderation_cases.target_type', ReportTargetType::Photo->value)
            ->whereColumn('moderation_cases.target_id', 'media.id')
            ->whereIn('moderation_cases.status', [CaseStatus::New->value, CaseStatus::InReview->value]);

        return match ($tab) {
            'reported' => self::base()->whereExists($open)->orderByDesc('media.created_at')->orderByDesc('media.id'),
            'hidden' => self::base()->where('moderation_status', ModerationStatus::Rejected)->orderByDesc('media.updated_at')->orderByDesc('media.id'),
            default => self::base()->whereNull('reviewed_at')->where('moderation_status', '!=', ModerationStatus::Rejected)->orderByDesc('media.created_at')->orderByDesc('media.id'),
        };
    }

    /**
     * @param  list<Media>  $items
     * @return list<array<string, mixed>>
     */
    private static function rows(array $items, VehiclePresenter $presenter, bool $canReveal, bool $aiTriage): array
    {
        $ids = array_map(fn (Media $m): string => $m->id, $items);
        $cases = ModerationCase::query()->where('target_type', ReportTargetType::Photo->value)->whereIn('target_id', $ids === [] ? ['-'] : $ids)
            ->whereIn('status', [CaseStatus::New->value, CaseStatus::InReview->value])->get(['id', 'target_id', 'report_count'])->keyBy('target_id');

        $vehicleIds = [];
        $modIds = [];
        foreach ($items as $media) {
            if ($media->getAttribute('mediable_type') === 'vehicle') {
                $vehicleIds[] = (string) $media->getAttribute('mediable_id');
            } elseif ($media->getAttribute('mediable_type') === 'modification') {
                $modIds[] = (string) $media->getAttribute('mediable_id');
            }
        }
        $mods = Modification::withTrashed()->whereIn('id', $modIds)->get(['id', 'vehicle_id', 'title'])->keyBy('id');
        $vehicles = Vehicle::withTrashed()->with(['make', 'vehicleModel', 'generation'])->whereIn('id', [...$vehicleIds, ...$mods->pluck('vehicle_id')->all()])->get()->keyBy('id');
        $removals = self::removals(array_values(array_map(fn (Media $m): string => $m->id, array_filter($items, fn (Media $m): bool => $m->moderation_status === ModerationStatus::Rejected))));

        return array_map(function (Media $media) use ($cases, $mods, $vehicles, $presenter, $removals, $canReveal, $aiTriage): array {
            $type = $media->getAttribute('mediable_type');
            $mod = $type === 'modification' ? $mods->get($media->getAttribute('mediable_id')) : null;
            $vehicleId = $type === 'vehicle' ? $media->getAttribute('mediable_id') : $mod?->getAttribute('vehicle_id');
            $vehicle = is_string($vehicleId) ? $vehicles->get($vehicleId) : null;
            $case = $cases->get($media->id);

            return [
                'id' => $media->id,
                'url' => MediaUrls::at($media, 640),
                'alt' => $media->getAttribute('alt'),
                'width' => $media->getAttribute('width'),
                'height' => $media->getAttribute('height'),
                'kind' => is_string($type) ? $type : 'profile',
                'category' => $media->getAttribute('category')?->value,
                'owner' => $media->owner === null ? null : ['id' => $media->owner->id, 'username' => $media->owner->username],
                'vehicle' => $vehicle instanceof Vehicle ? ['id' => $vehicle->id, 'title' => $presenter->fullTitle($vehicle)] : null,
                'mod' => $mod?->getAttribute('title'),
                'moderation_status' => $media->moderation_status->value,
                'reviewed_at' => $media->reviewed_at?->toIso8601String(),
                'created_at' => $media->created_at?->toIso8601String(),
                'case' => $case === null ? null : ['id' => $case->id, 'report_count' => $case->report_count],
                'ai_score' => $aiTriage && $media->ai_score !== null ? round((float) $media->ai_score, 2) : null,
                'ai_summary' => $aiTriage ? $media->getAttribute('ai_summary') : null,
                // DQ-532: a removed photo has no public file; the blurhash stands in until an audited "Anzeigen" (MediaOriginalController).
                'placeholder' => MediaUrls::placeholder($media, 16, 12),
                'hidden' => $removals[$media->id] ?? null,
                'can_reveal' => $canReveal && $media->moderation_status === ModerationStatus::Rejected && is_string($media->getAttribute('original_path')),
            ];
        }, $items);
    }

    /**
     * When and on which ground the standing decision removed each photo ("Ausgeblendet am … · Grund"), for the whole page in one query
     * (the rule of ModerationHolds::activeRemoval: the newest remove_content decision on the photo's cases that no decision reversed).
     *
     * @param  list<string>  $ids
     * @return array<string, array{at: string, ground: string|null}>
     */
    private static function removals(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $decisions = Decision::query()
            ->select(['decisions.*', 'moderation_cases.target_id as removal_target'])
            ->join('moderation_cases', 'moderation_cases.id', '=', 'decisions.case_id')
            ->where('moderation_cases.target_type', ReportTargetType::Photo->value)
            ->whereIn('moderation_cases.target_id', $ids)
            ->where('decisions.action', DecisionAction::RemoveContent->value)
            ->whereNotExists(fn (BaseBuilder $query) => $query->selectRaw('1')->from('decisions as reversals')
                ->whereColumn('reversals.reverses_decision_id', 'decisions.id'))
            ->orderByDesc('decisions.decided_at')
            ->orderByDesc('decisions.id')
            ->get();

        $out = [];
        foreach ($decisions as $decision) {
            $target = (string) $decision->getAttribute('removal_target');
            if (isset($out[$target])) {
                continue;
            }
            $ground = $decision->statement_of_reasons['ground'] ?? null;
            $out[$target] = ['at' => $decision->decided_at->toIso8601String(), 'ground' => is_string($ground) ? $ground : null];
        }

        return $out;
    }
}
