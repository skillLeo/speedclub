<?php

namespace App\Models;

use App\Enums\MediaCategory;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use Database\Factories\MediaFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;

/**
 * Only what the owner edits is fillable; the pipeline fields are set by App\Services\Media through forceFill.
 *
 * @property string $owner_id
 * @property MediaStatus $status
 * @property ModerationStatus $moderation_status
 * @property Carbon|null $reviewed_at ADM-13 "Freigeben" (M3.2)
 * @property int|null $reviewed_by the staff member who reviewed it
 * @property string|null $ai_score M3.7 ai.moderation_triage: risk 0–1 (risk_score / 100), a "KI-Vorschlag" for ADM-13/20, never a decision
 * @property string|null $ai_summary M3.7: the triage's German reason, at most 140 characters
 * @property Carbon|null $ai_scored_at
 */
#[Fillable(['alt', 'focal_x', 'focal_y', 'category', 'sort'])]
#[Hidden(['original_path'])]
class Media extends Model
{
    /** @use HasFactory<MediaFactory> */
    use HasFactory, HasUlids, SoftDeletes;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'variants' => 'array',
            'width' => 'integer',
            'height' => 'integer',
            'focal_x' => 'float',
            'focal_y' => 'float',
            'category' => MediaCategory::class,
            'sort' => 'integer',
            'original_bytes' => 'integer',
            'variant_bytes' => 'integer',
            'status' => MediaStatus::class,
            'moderation_status' => ModerationStatus::class,
            'ai_tags' => 'array',
            'blur_regions' => 'array',
            'blurred_at' => 'datetime',
            'reviewed_at' => 'datetime',
            'ai_scored_at' => 'datetime',
            'reviewed_by' => 'integer',
        ];
    }

    /**
     * Finished and not rejected: what can count as a vehicle's photo and be its cover.
     *
     * @param  Builder<Media>  $query
     */
    public function scopeUsablePhoto(Builder $query): void
    {
        $query->where('status', MediaStatus::Ready)->where('moderation_status', '!=', ModerationStatus::Rejected);
    }

    public function isUsablePhoto(): bool
    {
        return $this->status === MediaStatus::Ready && $this->moderation_status !== ModerationStatus::Rejected;
    }

    /**
     * @return BelongsTo<Staff, $this>
     */
    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(Staff::class, 'reviewed_by');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id')->withTrashed();
    }

    /**
     * @return MorphTo<Model, $this>
     */
    public function mediable(): MorphTo
    {
        return $this->morphTo();
    }
}
