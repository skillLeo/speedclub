<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;

/**
 * A reply macro of ADM-27 (m3.4-contract §1), per key and locale, with variables ({name}, {reference}, {staff}) that SupportMacros
 * fills when the macro picker inserts it into a reply; the reply stays editable. Audited under the morph name `support_macro` (AdminServiceProvider).
 *
 * @property string $id
 * @property string $key
 * @property string $locale
 * @property string $title
 * @property string $body
 * @property int $sort
 * @property int|null $updated_by
 */
class SupportMacro extends Model
{
    use HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['sort' => 'integer'];
    }
}
