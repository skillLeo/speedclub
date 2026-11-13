<?php

namespace App\Models;

use App\Enums\BuildUpdateAudience;
use App\Enums\QrStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Support\Slug;
use Database\Factories\VehicleFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * owner_id, public_id, slug, status, is_main, wizard_step, cover_media_id and the lifecycle dates are not fillable:
 * only Actions set them, through forceFill.
 *
 * @property string $id
 * @property string $owner_id
 * @property string $public_id
 * @property string $slug
 * @property VehicleStatus $status
 * @property Visibility $visibility
 * @property bool $is_main
 * @property int|null $wizard_step
 * @property int|null $model_year
 */
#[Fillable([
    'visibility', 'sort', 'nickname', 'description', 'color', 'make_id', 'model_id', 'generation_id',
    'make_text', 'model_text', 'model_year', 'hu_au_due',
])]
class Vehicle extends Model
{
    /** @use HasFactory<VehicleFactory> */
    use HasFactory, HasUlids, SoftDeletes;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => VehicleStatus::class,
            'visibility' => Visibility::class,
            'is_main' => 'boolean',
            'is_sample' => 'boolean',
            'comments_enabled' => 'boolean',
            'wizard_step' => 'integer',
            'sort' => 'integer',
            'model_year' => 'integer',
            'hu_au_due' => 'date',
            'qr_milestone' => 'integer',
            'hu_au_reminded_for' => 'date',
            'odometer_km' => 'integer',
            'odometer_at' => 'datetime',
            'published_at' => 'datetime',
            'archived_at' => 'datetime',
        ];
    }

    /**
     * Canonical resolution: only the public_id counts, whatever the text part of the slug says.
     */
    public static function findBySlug(string $slug): ?self
    {
        $publicId = Slug::publicId($slug);

        return $publicId === null ? null : self::query()->where('public_id', $publicId)->first();
    }

    /**
     * The slug for the current catalogue names; free-text make and model count when no entry is linked.
     */
    public function canonicalSlug(): string
    {
        return Slug::forVehicle(
            $this->make->name ?? $this->make_text,
            $this->vehicleModel->name ?? $this->model_text,
            $this->generation?->name,
            $this->public_id,
        );
    }

    /**
     * What publishing asks of the vehicle itself and a published one must keep (02_PRODUCT_SPEC §3.2).
     *
     * @return list<string> out of make, model, model_year
     */
    public function missingBasics(): array
    {
        return array_keys(array_filter([
            'make' => $this->getAttribute('make_id') === null && $this->getAttribute('make_text') === null,
            'model' => $this->getAttribute('model_id') === null && $this->getAttribute('model_text') === null,
            'model_year' => $this->model_year === null,
        ]));
    }

    public function isDraft(): bool
    {
        return $this->status === VehicleStatus::Draft;
    }

    public function isOwnedBy(?User $user): bool
    {
        return $user !== null && $user->id === $this->owner_id;
    }

    /**
     * Reachable by others at all: public through every surface, unlisted through link and QR only.
     * Owner state and blocks are VehiclePolicy's part.
     */
    public function isReachable(): bool
    {
        return ! $this->trashed()
            && $this->status === VehicleStatus::Published
            && $this->visibility !== Visibility::Private;
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id')->withTrashed();
    }

    /**
     * @return BelongsTo<Make, $this>
     */
    public function make(): BelongsTo
    {
        return $this->belongsTo(Make::class);
    }

    /**
     * @return BelongsTo<VehicleModel, $this>
     */
    public function vehicleModel(): BelongsTo
    {
        return $this->belongsTo(VehicleModel::class, 'model_id');
    }

    /**
     * @return BelongsTo<Generation, $this>
     */
    public function generation(): BelongsTo
    {
        return $this->belongsTo(Generation::class);
    }

    /**
     * @return BelongsTo<Media, $this>
     */
    public function cover(): BelongsTo
    {
        return $this->belongsTo(Media::class, 'cover_media_id');
    }

    /**
     * @return HasOne<VehicleSpec, $this>
     */
    public function specs(): HasOne
    {
        return $this->hasOne(VehicleSpec::class);
    }

    /**
     * @return HasMany<Modification, $this>
     */
    public function modifications(): HasMany
    {
        return $this->hasMany(Modification::class);
    }

    /**
     * M4.13 (09 §8.8): owner-only.
     *
     * @return HasMany<MaintenanceItem, $this>
     */
    public function maintenanceItems(): HasMany
    {
        return $this->hasMany(MaintenanceItem::class);
    }

    /**
     * M4.13 (09 §8.8): owner-only, costs included.
     *
     * @return HasMany<MaintenanceLog, $this>
     */
    public function maintenanceLogs(): HasMany
    {
        return $this->hasMany(MaintenanceLog::class);
    }

    /**
     * @return MorphMany<Media, $this>
     */
    public function media(): MorphMany
    {
        return $this->morphMany(Media::class, 'mediable');
    }

    /**
     * @return HasMany<BuildUpdate, $this>
     */
    public function buildUpdates(): HasMany
    {
        // M4.11: each update knows its vehicle without a query of its own (BuildUpdateResource asks who owns it).
        return $this->hasMany(BuildUpdate::class)->chaperone('vehicle');
    }

    /**
     * The newest entry of Verlauf that everybody sees, for the "latest change" of a card (02_PRODUCT_SPEC §1.2).
     *
     * @return HasOne<BuildUpdate, $this>
     */
    public function latestVisibleUpdate(): HasOne
    {
        // M4.11: a followers-only update is not on a card anybody may see.
        return $this->hasOne(BuildUpdate::class)->ofMany(['created_at' => 'max', 'id' => 'max'], fn ($query) => $query->where('hidden', false)->where('audience', BuildUpdateAudience::Vehicle->value));
    }

    /**
     * @return HasMany<QrCode, $this>
     */
    public function qrCodes(): HasMany
    {
        return $this->hasMany(QrCode::class);
    }

    /**
     * @return HasOne<QrCode, $this>
     */
    public function activeQrCode(): HasOne
    {
        return $this->hasOne(QrCode::class)->where('status', QrStatus::Active);
    }

    /**
     * @return HasMany<Save, $this>
     */
    public function saves(): HasMany
    {
        return $this->hasMany(Save::class);
    }

    /**
     * M4.11 (09 §8.6): members following this build.
     *
     * @return HasMany<VehicleFollow, $this>
     */
    public function follows(): HasMany
    {
        return $this->hasMany(VehicleFollow::class);
    }

    /**
     * M4.11 (09 §8.5): the owner's Highlights rail, in order.
     *
     * @return HasMany<VehicleHighlight, $this>
     */
    public function highlights(): HasMany
    {
        return $this->hasMany(VehicleHighlight::class)->orderBy('position')->orderBy('id');
    }

    /**
     * @return HasOne<VehicleSearch, $this>
     */
    public function searchProjection(): HasOne
    {
        return $this->hasOne(VehicleSearch::class);
    }
}
