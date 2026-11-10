<?php

namespace App\Models;

use App\Enums\DataExportStatus;
use Database\Factories\DataExportFactory;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * SET-12: one ZIP of a member's data on the private disk. Only App\Actions\Me\RequestDataExport and the export jobs write it.
 *
 * @property string $id
 * @property string $user_id
 * @property int|null $requested_by_staff_id set for an export built for staff (four-eyes members.export, M3.2): never listed or mailed to the member
 * @property DataExportStatus $status
 * @property Carbon|null $requested_at
 * @property Carbon|null $ready_at
 * @property Carbon|null $expires_at
 * @property int $bytes
 * @property array{stage?: string, offset?: int, entries?: int, after_media_id?: string|null, after?: string|null, part?: int, photos?: int}|null $progress
 */
#[Hidden(['path', 'progress'])]
class DataExport extends Model
{
    /** @use HasFactory<DataExportFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => DataExportStatus::class,
            'requested_at' => 'datetime',
            'started_at' => 'datetime',
            'ready_at' => 'datetime',
            'expires_at' => 'datetime',
            'failed_at' => 'datetime',
            'bytes' => 'integer',
            'progress' => 'array',
            'requested_by_staff_id' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function isForStaff(): bool
    {
        return $this->requested_by_staff_id !== null;
    }

    /**
     * Ready and inside its 7 days: the link works.
     */
    public function isDownloadable(): bool
    {
        return $this->status === DataExportStatus::Ready
            && $this->expires_at !== null
            && $this->expires_at->isFuture()
            && is_string($this->getAttribute('path'));
    }
}
