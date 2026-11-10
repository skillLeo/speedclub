<?php

namespace App\Support\Queue;

use Illuminate\Database\QueryException;
use RuntimeException;
use Throwable;

/**
 * What failed_jobs.exception keeps of a failure (BL-2, ADR-125): the class, the error code, for a database error the SQL with its
 * placeholders, and the frames as file:line and function, for every exception of the chain. Never a message: a database message quotes
 * values ("Duplicate entry 'Wie fährt sich …'"), and any other message may carry what a member wrote.
 */
final class ScrubbedException extends RuntimeException
{
    private const MAX_FRAMES = 30;

    private readonly string $summary;

    public function __construct(Throwable $exception)
    {
        parent::__construct('', 0);
        $this->summary = self::describe($exception);
    }

    public function __toString(): string
    {
        return $this->summary;
    }

    public static function describe(Throwable $exception): string
    {
        $parts = [];
        $depth = 0;

        for ($current = $exception; $current !== null && $depth < 5; $current = $current->getPrevious(), $depth++) {
            $line = ($depth === 0 ? '' : 'Caused by: ').$current::class.' (code '.$current->getCode().')';

            if ($current instanceof QueryException) {
                $line .= "\nSQL: ".$current->getSql();
            }

            $line .= "\nat ".self::relative($current->getFile()).':'.$current->getLine();

            foreach (array_slice($current->getTrace(), 0, self::MAX_FRAMES) as $index => $frame) {
                $where = isset($frame['file']) ? self::relative($frame['file']).':'.($frame['line'] ?? 0) : '[internal]';
                $function = ($frame['class'] ?? '').($frame['type'] ?? '').$frame['function'];
                $line .= "\n#$index $where $function()";
            }

            $parts[] = $line;
        }

        return implode("\n\n", $parts);
    }

    private static function relative(string $file): string
    {
        $base = base_path().DIRECTORY_SEPARATOR;

        return str_starts_with($file, $base) ? substr($file, strlen($base)) : basename($file);
    }
}
