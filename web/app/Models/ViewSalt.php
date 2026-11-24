<?php

namespace App\Models;

use Database\Factories\ViewSaltFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * M5.7 (m5.7-contract §1.1): the secret key of the viewer hash for one Europe/Berlin day. Written and read only by
 * App\Services\Insights\ViewSalts; deleted as soon as the day is over, so no stored hash can be tied to anybody afterwards. Hidden on the
 * model, never logged or exported.
 *
 * @property string $day
 * @property string $salt
 */
#[Fillable(['day', 'salt', 'created_at'])]
class ViewSalt extends Model
{
    /** @use HasFactory<ViewSaltFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    protected $primaryKey = 'day';

    public $incrementing = false;

    protected $keyType = 'string';

    /** @var list<string> */
    protected $hidden = ['salt'];
}
