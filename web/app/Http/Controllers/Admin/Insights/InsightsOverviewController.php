<?php

namespace App\Http\Controllers\Admin\Insights;

use App\Http\Controllers\Controller;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Insights\PlatformInsights;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-70 Insights overview (10 §11, m5.7-contract §9) under Plattform → Übersicht: views per day by source and sticker scans over 7, 30
 * or 90 Berlin days, the weekly recaps (sent, skipped, unreachable), plan prompts and pushes the weekly cap dropped in the last 7 days.
 * Platform totals only (no member, no car, no name). Atom content.view on the route; read only, so no FormRequest, no audit. An unknown
 * `?days=` falls back to 30 instead of answering 422 (a link someone typed).
 */
class InsightsOverviewController extends Controller
{
    public function __invoke(Request $request, PlatformInsights $insights, FeatureFlags $flags): Response
    {
        $wanted = (int) $request->query('days', (string) PlatformInsights::DEFAULT_DAYS);
        $days = in_array($wanted, PlatformInsights::PERIODS, true) ? $wanted : PlatformInsights::DEFAULT_DAYS;

        return Inertia::render('Insights/Overview', [
            'period' => $days,
            'periods' => PlatformInsights::PERIODS,
            'overview' => $insights->overview($days),
            'countingSince' => $insights->countingSince(),
            'flags' => [
                'insights' => $flags->enabled('insights'),
                'weekly_recap' => $flags->enabled('weekly_recap'),
                'build_prompts' => $flags->enabled('build_prompts'),
            ],
            'capPerWeek' => max(0, min(3, config()->integer('speedclub.notifications.engagement_weekly_max', 3))),
        ]);
    }
}
