<?php

namespace App\Services\Admin\Members;

use App\Models\ApprovalRequest;

/**
 * What a bulk action of ADM-09/ADM-11 answers (m3.1-contract §0): either it ran, with one row per record for the result panel
 * ({id, ok, code}: code null when ok, else not_found, forbidden, not_possible, invalid or failed), or it waits for a second staff member
 * (more than 100 records, or an action that is always four-eyes).
 */
final readonly class BulkOutcome
{
    /**
     * @param  list<array{id: string, ok: bool, code: string|null}>  $rows
     */
    public function __construct(
        public array $rows = [],
        public ?ApprovalRequest $approval = null,
    ) {}

    public function waitsForApproval(): bool
    {
        return $this->approval !== null;
    }

    /**
     * @return array{done: int, failed: int}
     */
    public function counts(): array
    {
        $done = count(array_filter($this->rows, fn (array $row): bool => $row['ok']));

        return ['done' => $done, 'failed' => count($this->rows) - $done];
    }
}
