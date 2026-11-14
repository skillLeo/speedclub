<?php

namespace App\Console\Commands;

use App\Enums\MediaStatus;
use App\Models\Media;
use App\Services\Media\MediaService;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Number;
use Throwable;

/**
 * M4.18: brings photos processed before the variant byte budget (speedclub.media.variant_budget_kb) under it. Run by hand once per
 * environment after a deploy that changes the budget; idempotent, so a second run or an interrupted one is safe to repeat. Not
 * scheduled: --limit keeps one run short where a cron window applies.
 */
#[Signature('media:recompress {--dry-run : Only count the variants above the budget} {--limit=0 : Stop after this many photos with a variant above the budget (0 = all)}')]
#[Description('Encode again every stored photo variant above its byte budget, at a lower quality and the same dimensions')]
class RecompressMediaCommand extends Command
{
    private const CHUNK = 100;

    public function handle(MediaService $service): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $limit = max(0, (int) $this->option('limit'));
        $totals = ['photos' => 0, 'over' => 0, 'replaced' => 0, 'saved_bytes' => 0, 'failed' => 0];

        Media::query()
            ->where('status', MediaStatus::Ready)
            ->whereNotNull('variants')
            ->whereNotNull('original_path')
            ->chunkById(self::CHUNK, function ($chunk) use ($service, $dryRun, $limit, &$totals): bool {
                foreach ($chunk as $media) {
                    try {
                        $result = $service->recompressVariants($media, $dryRun);
                    } catch (Throwable $exception) {
                        report($exception);
                        $totals['failed']++;

                        continue;
                    }

                    if ($result['over'] === 0) {
                        continue;
                    }

                    $totals['photos']++;
                    $totals['over'] += $result['over'];
                    $totals['replaced'] += $result['replaced'];
                    $totals['saved_bytes'] += $result['saved_bytes'];

                    if ($limit > 0 && $totals['photos'] >= $limit) {
                        return false;
                    }
                }

                return true;
            });

        $this->info(sprintf(
            '%s%d variants of %d photos above the budget, %d encoded again, %s saved, %d failed.',
            $dryRun ? '[dry run] ' : '',
            $totals['over'],
            $totals['photos'],
            $totals['replaced'],
            Number::fileSize($totals['saved_bytes'], 1),
            $totals['failed'],
        ));

        return $totals['failed'] > 0 ? self::FAILURE : self::SUCCESS;
    }
}
