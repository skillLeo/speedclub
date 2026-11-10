<?php

namespace App\Models;

use App\Enums\DecisionAction;
use App\Enums\GroundDocument;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;

/**
 * A statement-of-reasons template of ADM-24 (Art. 17(3) DSA, m3.4-contract §1): per key and locale, the action it is meant for, the facts
 * with placeholders ({target}, {date}, {member}), the ground and where it is written. The redress text is fixed by law and is not part of
 * a template. The decision composer starts from a template and stays editable. Audited under the morph name `sor_template` (AdminServiceProvider).
 *
 * @property string $id
 * @property string $key
 * @property string $locale
 * @property DecisionAction $action
 * @property string $label
 * @property string $facts
 * @property string $ground
 * @property GroundDocument $ground_document
 * @property string|null $ground_section
 * @property int $sort
 * @property int|null $updated_by
 */
class SorTemplate extends Model
{
    use HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['action' => DecisionAction::class, 'ground_document' => GroundDocument::class, 'sort' => 'integer'];
    }
}
