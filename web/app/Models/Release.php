<?php

namespace App\Models;

use App\Enums\ReleaseChannel;
use App\Enums\ReleasePlatform;
use App\Enums\ReleaseSource;
use Database\Factories\ReleaseFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * A row of the release register (ADM-38). Unique by version name, version code, channel and platform; `speedclub:releases-sync` upserts
 * by that key.
 *
 * @property int $id
 * @property string $version_name
 * @property int $version_code
 * @property ReleasePlatform $platform
 * @property ReleaseChannel $channel
 * @property string|null $apk_sha256
 * @property string|null $notes
 * @property Carbon|null $released_at
 * @property ReleaseSource $source
 * @property int|null $created_by
 */
#[Fillable(['version_name', 'version_code', 'platform', 'channel', 'apk_sha256', 'notes', 'released_at', 'source', 'created_by'])]
class Release extends Model
{
    /** @use HasFactory<ReleaseFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'version_code' => 'integer',
            'platform' => ReleasePlatform::class,
            'channel' => ReleaseChannel::class,
            'source' => ReleaseSource::class,
            'released_at' => 'datetime',
        ];
    }
}
