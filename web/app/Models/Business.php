<?php

namespace App\Models;

use App\Enums\BusinessKind;
use App\Enums\BusinessLegalForm;
use App\Enums\BusinessRole;
use App\Enums\BusinessStatus;
use Carbon\CarbonImmutable;
use Database\Factories\BusinessFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\MorphMany;

/**
 * A workshop or tuning business (09 §8.10, BIZ-01…04, ADR-414). Applied by a member (the owner), verified by staff (ADM-55/56) before
 * anybody else sees it; suspended or removed by staff. Status, review, verification and removal columns are not fillable: only
 * Actions change them, through forceFill. Routes find a business by its slug.
 *
 * The Impressum fields (§ 5 DDG) are public on a verified business (BusinessImpressum); `document_note` and the staff columns never
 * leave the admin.
 *
 * @property string $id
 * @property string $owner_id
 * @property string $slug
 * @property string $name
 * @property BusinessKind $kind
 * @property string $legal_name
 * @property BusinessLegalForm $legal_form
 * @property string|null $representative
 * @property string $street
 * @property string $postcode
 * @property string $city
 * @property string $country
 * @property float|null $lat
 * @property float|null $lng
 * @property string|null $phone
 * @property string $email
 * @property string|null $website
 * @property string|null $register_court
 * @property string|null $register_number
 * @property string|null $vat_id
 * @property string|null $about
 * @property list<string>|null $services
 * @property array<string, list<array{0: string, 1: string}>>|null $opening_hours
 * @property BusinessStatus $status
 * @property CarbonImmutable|null $submitted_at
 * @property CarbonImmutable|null $verified_at
 * @property CarbonImmutable|null $suspended_at
 * @property CarbonImmutable|null $removed_at
 * @property bool $is_sample
 * @property-read User $owner
 * @property-read Media|null $logo
 * @property-read Media|null $cover
 */
class Business extends Model
{
    /** @use HasFactory<BusinessFactory> */
    use HasFactory, HasUlids;

    /**
     * The fields of the Impressum (§ 5 DDG) and the identity staff checked: locked once the business is verified (UpdateBusiness).
     */
    public const IDENTITY = ['name', 'legal_name', 'legal_form', 'representative', 'street', 'postcode', 'city', 'country', 'register_court', 'register_number', 'vat_id'];

    /**
     * The number of builds in the portfolio, set by BusinessPresenter for a page (never stored).
     */
    public ?int $portfolioCount = null;

    /** @var list<string> */
    protected $fillable = [
        'name', 'kind', 'legal_name', 'legal_form', 'representative', 'street', 'postcode', 'city', 'country', 'lat', 'lng', 'phone', 'email',
        'website', 'register_court', 'register_number', 'vat_id', 'about', 'services', 'opening_hours', 'document_note',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'kind' => BusinessKind::class,
            'legal_form' => BusinessLegalForm::class,
            'status' => BusinessStatus::class,
            'lat' => 'float',
            'lng' => 'float',
            'services' => 'array',
            'opening_hours' => 'array',
            'submitted_at' => 'immutable_datetime',
            'reviewed_at' => 'immutable_datetime',
            'verified_at' => 'immutable_datetime',
            'suspended_at' => 'immutable_datetime',
            'removed_at' => 'immutable_datetime',
            'is_sample' => 'boolean',
        ];
    }

    public function isPublic(): bool
    {
        return $this->status->isPublic() && $this->removed_at === null;
    }

    public function roleOf(?User $user): ?BusinessRole
    {
        if ($user === null) {
            return null;
        }

        if ($this->owner_id === $user->id) {
            return BusinessRole::Owner;
        }

        $member = $this->members()->where('user_id', $user->id)->first();

        return $member instanceof BusinessMember ? $member->role : null;
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    /**
     * @return HasMany<BusinessMember, $this>
     */
    public function members(): HasMany
    {
        return $this->hasMany(BusinessMember::class);
    }

    /**
     * @return HasMany<ModBusinessTag, $this>
     */
    public function tags(): HasMany
    {
        return $this->hasMany(ModBusinessTag::class);
    }

    /**
     * @return BelongsTo<Media, $this>
     */
    public function logo(): BelongsTo
    {
        return $this->belongsTo(Media::class, 'logo_media_id');
    }

    /**
     * @return BelongsTo<Media, $this>
     */
    public function cover(): BelongsTo
    {
        return $this->belongsTo(Media::class, 'cover_media_id');
    }

    /**
     * @return MorphMany<Media, $this>
     */
    public function media(): MorphMany
    {
        return $this->morphMany(Media::class, 'mediable');
    }

    /**
     * @return BelongsTo<Staff, $this>
     */
    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(Staff::class, 'reviewed_by');
    }
}
