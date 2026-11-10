<?php

namespace App\Services\Privacy;

use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;

/**
 * Art. 12(3) GDPR: an answer within one month of receipt; extendable once by two further months where needed, with a reason, told to the
 * requester within the first month (08_LEGAL_COMPLIANCE). Calendar months without overflow (31 Jan → 28/29 Feb).
 */
final class PrivacyDeadlines
{
    public static function dueFor(CarbonInterface $receivedAt): Carbon
    {
        return Carbon::instance($receivedAt)->addMonthsNoOverflow(config()->integer('speedclub.privacy.due_months'));
    }

    public static function extended(CarbonInterface $dueAt): Carbon
    {
        return Carbon::instance($dueAt)->addMonthsNoOverflow(config()->integer('speedclub.privacy.extension_months'));
    }
}
