<?php

namespace App\Http\Controllers\Admin\Moderation;

use App\Actions\Admin\Moderation\AddKeywordRule;
use App\Actions\Admin\Moderation\PublishRateLimits;
use App\Actions\Admin\Moderation\RemoveKeywordRule;
use App\Enums\ConfigVersionStatus;
use App\Enums\KeywordList;
use App\Http\Controllers\Admin\Moderation\Requests\KeywordRuleRequest;
use App\Http\Controllers\Admin\Moderation\Requests\RulesReasonRequest;
use App\Http\Controllers\Admin\Support\QaClock;
use App\Http\Controllers\Controller;
use App\Models\ConfigVersion;
use App\Models\KeywordRule;
use App\Models\Staff;
use App\Services\Rules\KeywordRules;
use App\Services\Rules\RateLimitOverrides;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-23 rules (m3.4-contract §1/§2): the keyword lists (term, list, created by/at, matches in 30 days) and the rate-limit overrides
 * (default, bounds, override, last published version). Writes need moderation.rules, a recent password and a reason.
 */
class RulesController extends Controller
{
    public function index(Request $request, KeywordRules $keywordRules): Response
    {
        $today = QaClock::today($request);
        $since = $today->subDays(29)->toDateString();
        $hits = $keywordRules->hitsSince($since);
        $published = ConfigVersion::query()->with('publisher:id,name')->where('key', RateLimitOverrides::CONFIG_KEY)->where('status', ConfigVersionStatus::Published)->orderByDesc('version')->first();
        $overrides = RateLimitOverrides::published();

        return Inertia::render('Moderation/Rules', [
            'rules' => array_values(KeywordRule::query()->with('creator:id,name')->orderBy('list')->orderBy('normalized')->orderBy('id')->get()->map(fn (KeywordRule $rule): array => [
                'id' => $rule->id,
                'term' => $rule->term,
                'list' => $rule->list->value,
                'created_by' => $rule->creator?->name,
                'created_at' => $rule->created_at?->toIso8601String(),
                'hits' => $hits[$rule->id] ?? 0,
            ])->all()),
            'limits' => array_map(fn (string $name, array $limit): array => [
                'name' => $name,
                'default' => $limit['max'],
                'minutes' => $limit['minutes'],
                'lower' => RateLimitOverrides::bounds($limit['max'])['min'],
                'upper' => RateLimitOverrides::bounds($limit['max'])['max'],
                'override' => $overrides[$name] ?? null,
            ], array_keys(RateLimitOverrides::defaults()), RateLimitOverrides::defaults()),
            'published' => $published === null ? null : [
                'version' => $published->version,
                'published_at' => $published->published_at?->toIso8601String(),
                'published_by' => $published->publisher?->name,
                'reason' => $request->user('staff') instanceof Staff && $request->user('staff')->can('audit.view') ? $published->reason : null,
            ],
        ]);
    }

    public function store(KeywordRuleRequest $request, AddKeywordRule $add): RedirectResponse
    {
        $add->handle($request->staff(), $request->string('term')->value(), KeywordList::from($request->string('list')->value()), $request->reason());

        return back(303)->with('success', 'moderation.flash.keyword_added');
    }

    public function destroy(RulesReasonRequest $request, int $rule, RemoveKeywordRule $remove): RedirectResponse
    {
        $row = KeywordRule::query()->find($rule);
        abort_if($row === null, 404);
        $remove->handle($request->staff(), $row, $request->reason());

        return back(303)->with('success', 'moderation.flash.keyword_removed');
    }

    public function limits(RulesReasonRequest $request, PublishRateLimits $publish): RedirectResponse
    {
        $publish->handle($request->staff(), (array) $request->input('overrides', []), $request->reason());

        return back(303)->with('success', 'moderation.flash.limits_published');
    }
}
