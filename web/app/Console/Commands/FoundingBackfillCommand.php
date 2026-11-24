<?php

namespace App\Console\Commands;

use App\Enums\GiftEvent;
use App\Enums\UserStatus;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Members\FoundingNumbers;
use App\Services\Members\MemberActivation;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

/**
 * CR-P5G-09 (ADR-513 "a backfill of already-active members"): the M5.9d migration set activated_at for members who were active before
 * it, and MemberActivation never runs for them again, so they got no Founding Member number. This gives them one, in activated_at
 * order (then id), through FoundingNumbers::assign: the same counter, row locks and rules (production only, never sample, editorial,
 * demo/test domains or a deleted account), plus: active status, verified address and current terms (MemberActivation::ready).
 *
 * The rule, kept simple on purpose: the backfill takes the next free numbers from the counter onward. Run right after the deploy, before
 * anybody new activates, the earliest members get #0001 onward. Members who activated after the deploy keep the numbers they already
 * have; older members then follow them (numbers are never moved or re-used). Idempotent: a member with a number is skipped, a second
 * run assigns nothing. Chunked by a keyset on (activated_at, id); stops when the numbers run out. One audit entry per number.
 */
#[Signature('speedclub:founding:backfill {--dry-run : List how many members would get a number, change nothing} {--chunk=200 : Members per query}')]
#[Description('Give Founding Member numbers to members who were active before the M5.9d deploy (production only)')]
class FoundingBackfillCommand extends Command
{
    public function handle(FoundingNumbers $founding): int
    {
        if (! app()->isProduction()) {
            $this->error('speedclub:founding:backfill refuses to run: Founding Member numbers exist only in production (founding.environments).');

            return self::FAILURE;
        }

        $chunk = max(1, (int) $this->option('chunk'));
        $afterAt = null;
        $afterId = '';
        $assigned = 0;
        $skipped = 0;
        $founding->prepare();

        while (true) {
            $members = User::query()
                ->whereNull('founding_number')
                ->whereNotNull('activated_at')
                ->where('status', UserStatus::Active->value)
                ->when($afterAt !== null, fn ($query) => $query->where(fn ($next) => $next
                    ->where('activated_at', '>', $afterAt)
                    ->orWhere(fn ($same) => $same->where('activated_at', $afterAt)->where('id', '>', $afterId))))
                ->orderBy('activated_at')
                ->orderBy('id')
                ->limit($chunk)
                ->get();

            if ($members->isEmpty()) {
                break;
            }

            foreach ($members as $member) {
                $afterAt = $member->getRawOriginal('activated_at');
                $afterId = (string) $member->id;

                if (! FoundingNumbers::eligible($member) || ! MemberActivation::ready($member)) {
                    $skipped++;

                    continue;
                }

                if ($this->option('dry-run')) {
                    $assigned++;

                    continue;
                }

                $number = $founding->assign($member);

                if ($number === null) {
                    $this->warn('All Founding Member numbers are taken: '.$assigned.' assigned, the rest stay without one.');

                    return self::SUCCESS;
                }

                Audit::record(GiftEvent::FoundingNumberAssigned->value, $member, after: ['founding_number' => $number, 'backfill' => true], reason: 'CR-P5G-09 backfill of members active before M5.9d');
                $assigned++;
            }
        }

        $this->info(($this->option('dry-run') ? 'Dry run: ' : '').$assigned.' member(s) '.($this->option('dry-run') ? 'would get' : 'got').' a Founding Member number; '.$skipped.' not eligible.');

        return self::SUCCESS;
    }
}
