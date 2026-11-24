<?php

namespace App\Console\Commands;

use App\Enums\TranslationSource;
use App\Models\AiCall;
use App\Models\AiSpecSuggestion;
use App\Models\AiTextNormalisation;
use App\Models\AiTranslation;
use App\Services\Ai\ForumSummaries;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Database\Query\Builder;

/**
 * M3.7 [AI]: ai_calls rows after speedclub.ai.calls_retention_days (90), and cached translations after their 30 days or as soon as their
 * message is gone (a deleted message's translation must not outlive it). Batches of 5,000 per table and run.
 */
#[Signature('ai:prune')]
#[Description('Delete AI call log rows after 90 days, expired or orphaned cached translations, expired AI caches and stale forum summaries')]
class PruneAiDataCommand extends Command
{
    private const BATCH = 5000;

    public function handle(): int
    {
        $calls = AiCall::query()->where('created_at', '<', now()->subDays(config()->integer('speedclub.ai.calls_retention_days')))
            ->orderBy('created_at')->limit(self::BATCH)->pluck('id');
        $deletedCalls = $calls->isEmpty() ? 0 : AiCall::query()->whereKey($calls->all())->delete();

        $expired = AiTranslation::query()->where('expires_at', '<=', now())->limit(self::BATCH)->pluck('id');
        $orphans = AiTranslation::query()->where('source_type', TranslationSource::Message->value)
            ->whereNotExists(fn (Builder $query) => $query->from('messages')->whereColumn('messages.id', 'ai_translations.source_id')->whereNull('messages.deleted_at'))
            ->limit(self::BATCH)->pluck('id');
        $ids = $expired->merge($orphans)->unique()->values()->all();
        $deletedTranslations = $ids === [] ? 0 : AiTranslation::query()->whereKey($ids)->delete();

        // M5.9 (m5.9-contract §7): expired shared caches (no member data), and forum summaries that must not be shown any more.
        $specs = AiSpecSuggestion::query()->where('expires_at', '<=', now())->limit(self::BATCH)->delete();
        $normalisations = AiTextNormalisation::query()->where('expires_at', '<=', now())->limit(self::BATCH)->delete();
        $summaries = app(ForumSummaries::class)->sweep();

        $this->info("Deleted {$deletedCalls} AI call rows, {$deletedTranslations} cached translations, {$specs} spec suggestions, {$normalisations} part normalisations and {$summaries} forum summaries.");

        return self::SUCCESS;
    }
}
