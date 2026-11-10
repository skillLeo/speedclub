<?php

namespace App\Models;

use App\Enums\CatalogImportKind;
use App\Enums\CatalogImportStatus;
use Database\Factories\CatalogImportFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * An ADM-17 CSV import (M3.3): the file on the private disk (30 days), its dry run (`rows`: one entry per CSV row
 * {line, status, level, label, changes, error}), the counts per status, and the queued apply's progress and results. Written only by
 * App\Actions\Admin\Catalog\{AnalyseCatalogImport, ApplyCatalogImport} and App\Jobs\Catalog\RunCatalogImport; nothing is fillable.
 *
 * @property string $id
 * @property CatalogImportKind $kind
 * @property CatalogImportStatus $status
 * @property string $original_name
 * @property string $path
 * @property string $file_hash
 * @property int $row_count
 * @property array{new?: int, changed?: int, unchanged?: int, error?: int}|null $counts
 * @property list<array<string, mixed>>|null $rows
 * @property list<array<string, mixed>>|null $results
 * @property int $progress
 * @property string|null $reason
 * @property int|null $created_by
 * @property int|null $applied_by
 * @property int|null $approved_by
 * @property string|null $approval_id
 * @property Carbon|null $queued_at
 * @property Carbon|null $started_at
 * @property Carbon|null $finished_at
 * @property Carbon|null $expires_at
 */
class CatalogImport extends Model
{
    /** @use HasFactory<CatalogImportFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'kind' => CatalogImportKind::class,
            'status' => CatalogImportStatus::class,
            'row_count' => 'integer',
            'counts' => 'array',
            'rows' => 'array',
            'results' => 'array',
            'progress' => 'integer',
            'queued_at' => 'datetime',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
            'expires_at' => 'datetime',
        ];
    }

    /** Rows the apply would create or change. */
    public function changedRows(): int
    {
        return (int) ($this->counts['new'] ?? 0) + (int) ($this->counts['changed'] ?? 0);
    }

    /**
     * @return BelongsTo<Staff, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(Staff::class, 'created_by');
    }

    /**
     * @return BelongsTo<Staff, $this>
     */
    public function applier(): BelongsTo
    {
        return $this->belongsTo(Staff::class, 'applied_by');
    }

    /**
     * @return BelongsTo<ApprovalRequest, $this>
     */
    public function approval(): BelongsTo
    {
        return $this->belongsTo(ApprovalRequest::class, 'approval_id');
    }
}
