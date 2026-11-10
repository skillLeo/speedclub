<?php

namespace App\Console\Commands;

use App\Services\Audit\AuditRetention;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Log;
use RuntimeException;

#[Signature('audit:retention')]
#[Description('Purge staff access data, archive old audit events and delete expired audit files')]
class AuditRetentionCommand extends Command
{
    public function handle(AuditRetention $retention): int
    {
        $access = $retention->purgeAccessData();
        $files = $retention->purgeExports();

        try {
            $archived = $retention->archiveEvents();
        } catch (RuntimeException $exception) {
            // A QueryException is a RuntimeException too, and its message can quote values: the log gets it through report() and
            // QueryExceptionReporter (SQL with placeholders and SQLSTATE only), the console no database text (BL-2, M2.8).
            Log::critical('Audit archive stopped.', ['exception_class' => $exception::class]);
            report($exception);
            $this->error($exception instanceof QueryException ? 'Audit archive stopped on a database error; see the log.' : $exception->getMessage());

            return self::FAILURE;
        }

        $this->info("Purged access data of $access events, archived $archived events, deleted $files files.");

        return self::SUCCESS;
    }
}
