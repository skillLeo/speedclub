<?php

namespace App\Models;

use App\Enums\AiFeature;
use App\Enums\AiOutcome;
use Database\Factories\AiCallFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * One provider call of an [AI] feature (m3.7 contract §1). Never a prompt, an output or any content; written only by AiGateway.
 *
 * @property string $id
 * @property AiFeature $feature
 * @property string $provider
 * @property string $model
 * @property int $latency_ms
 * @property int $input_tokens
 * @property int $output_tokens
 * @property AiOutcome $outcome
 * @property string|null $member_id
 * @property int|null $staff_id
 * @property Carbon $created_at
 */
class AiCall extends Model
{
    /** @use HasFactory<AiCallFactory> */
    use HasFactory, HasUlids;

    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'feature' => AiFeature::class,
            'outcome' => AiOutcome::class,
            'latency_ms' => 'integer',
            'input_tokens' => 'integer',
            'output_tokens' => 'integer',
            'staff_id' => 'integer',
            'created_at' => 'datetime',
        ];
    }
}
