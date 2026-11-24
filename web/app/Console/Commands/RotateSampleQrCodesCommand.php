<?php

namespace App\Console\Commands;

use App\Enums\GiftEvent;
use App\Enums\QrRevocationReason;
use App\Enums\QrStatus;
use App\Models\Vehicle;
use App\Services\Audit\Audit;
use App\Services\PublicPages\OgImages;
use App\Services\Qr\QrCodes;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * ADR-514 (SEC-P5G-01): until the deploy, OG images and share cards carried the sticker code in their QR, and staging's sample cars had
 * such images drawn and fetched. After the deploy this gives every sample car (is_sample, or a sample owner's car) a new sticker code
 * and takes its OG image and share cards down (they are drawn again with the page address on the next request), so no code read off an
 * old picture still counts as a spot. Real members' cars are never touched. Local, staging and testing only: production has no
 * published images of sample cars, and rotating real stickers would void what members have printed.
 */
#[Signature('speedclub:qr:rotate-samples {--dry-run : Print how many sample cars would get a new code, change nothing}')]
#[Description('Give every sample car a new sticker code (staging/local only, after the ADR-514 deploy)')]
class RotateSampleQrCodesCommand extends Command
{
    private const ENVIRONMENTS = ['local', 'staging', 'testing'];

    public function handle(QrCodes $codes, OgImages $og): int
    {
        $environment = (string) app()->environment();

        if (! in_array($environment, self::ENVIRONMENTS, true) || config('app.env') === 'production') {
            $this->error("speedclub:qr:rotate-samples refuses to run: APP_ENV is $environment. It is meant for local and staging hosts only.");

            return self::FAILURE;
        }

        $query = Vehicle::withTrashed()
            ->where(fn (Builder $sample) => $sample->where('is_sample', true)->orWhereHas('owner', fn (Builder $owner) => $owner->where('is_sample', true)))
            ->whereHas('qrCodes', fn (Builder $qr) => $qr->where('status', QrStatus::Active));

        if ($this->option('dry-run')) {
            $this->info($query->count().' sample car(s) would get a new sticker code. Dry run: nothing changed.');

            return self::SUCCESS;
        }

        $rotated = 0;

        $query->chunkById(100, function ($vehicles) use ($codes, $og, &$rotated): void {
            foreach ($vehicles as $vehicle) {
                /** @var Vehicle $vehicle */
                DB::transaction(function () use ($vehicle, $codes): void {
                    Vehicle::withTrashed()->whereKey($vehicle->getKey())->lockForUpdate()->firstOrFail();
                    $previous = $vehicle->qrCodes()->where('status', QrStatus::Active)->value('code');
                    $codes->revoke($vehicle, QrRevocationReason::Reissued);
                    $new = $codes->ensureActive($vehicle);

                    // The codes themselves stay out of the log: the old one was public, the new one must not become so.
                    Audit::record(GiftEvent::SampleQrRotated->value, $vehicle, ['had_code' => $previous !== null], ['code_id' => $new->getKey()], 'ADR-514: sample sticker codes after the server-drawn QR change');
                }, attempts: 3);

                $og->purge($vehicle);
                $rotated++;
            }
        });

        $this->info("$rotated sample car(s) got a new sticker code; their OG images and share cards are drawn again on the next request.");

        return self::SUCCESS;
    }
}
