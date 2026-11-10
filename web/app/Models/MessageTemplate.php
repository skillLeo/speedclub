<?php

namespace App\Models;

use Database\Factories\MessageTemplateFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * An override of an editable e-mail or push text (ADM-33): `fields` maps the template's field names to the text that replaces the
 * lang line (App\Services\Content\TemplateRegistry). A template without a row uses lang/{de,en}.
 *
 * @property int $id
 * @property string $key
 * @property string $locale
 * @property array<string, string> $fields
 * @property int|null $updated_by
 */
#[Fillable(['key', 'locale', 'fields', 'updated_by'])]
class MessageTemplate extends Model
{
    /** @use HasFactory<MessageTemplateFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['fields' => 'array'];
    }
}
