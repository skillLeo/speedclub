<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * How often a keyword rule matched per day and field (ADM-23 "Treffer 30 Tage"). Counts only: no member, no text.
 *
 * @property int $keyword_rule_id
 * @property string $day
 * @property string $field
 * @property int $hits
 */
class KeywordRuleHit extends Model
{
    public $timestamps = false;

    public $incrementing = false;

    protected $primaryKey = 'keyword_rule_id';
}
