<?php

namespace App\Exceptions;

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Masking the bindings is not enough: the database's own message can quote a value ("Duplicate entry 'name@example.de'").
 * Where a connection masks its bindings, the log gets the SQL with placeholders and the error code, nothing the member
 * typed (SEC-106). Message bodies and personal data must never reach a log.
 *
 * Also for an exception caused by a query error (BL-2, M2.8): the log formatter writes every previous exception's message, so a job that
 * wraps a QueryException would log the quoted value. Such a report gets the outer class instead of its message.
 */
final class QueryExceptionReporter
{
    /** How deep the chain of previous exceptions is searched, as in ScrubbedException. */
    private const MAX_DEPTH = 5;

    /**
     * @return bool|null false stops the default report, null lets it run
     */
    public function report(Throwable $exception): ?bool
    {
        $query = self::queryExceptionIn($exception);

        if ($query === null || config("database.connections.{$query->connectionName}.mask_bindings_in_exception_messages") !== true) {
            return null;
        }

        $context = [
            'connection' => $query->connectionName,
            'sqlstate' => $query->getCode(),
            'sql' => $query->getSql(),
        ];

        if ($query !== $exception) {
            $context = ['exception_class' => $exception::class, ...$context];
        }

        Log::error('Database query failed.', $context);

        return false;
    }

    private static function queryExceptionIn(Throwable $exception): ?QueryException
    {
        for ($current = $exception, $depth = 0; $current !== null && $depth < self::MAX_DEPTH; $current = $current->getPrevious(), $depth++) {
            if ($current instanceof QueryException) {
                return $current;
            }
        }

        return null;
    }
}
