<?php

namespace App\Actions\Admin\Content;

use App\Enums\ContentEvent;
use App\Models\MessageTemplate;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Config\ConfigRefused;
use App\Services\Content\MessageTemplates;
use App\Services\Content\TemplateRegistry;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-33 (`content.edit`): the edited text of a template's fields for one locale. Only editable templates and fields (template_fixed);
 * an override may use only the placeholders of the default line, a choice line must keep its number of forms, an empty field falls
 * back to the lang file. Takes effect at the next send (MessageTemplates). Audited as `template.saved` with the changed fields.
 */
final class SaveMessageTemplate
{
    public function __construct(private readonly TemplateRegistry $registry, private readonly MessageTemplates $templates) {}

    /**
     * @param  array<string, mixed>  $fields
     *
     * @throws AuthorizationException|ValidationException|ConfigRefused
     */
    public function handle(Staff $staff, string $key, string $locale, array $fields): ?MessageTemplate
    {
        StaffAtoms::ensure($staff, 'content.edit');
        $clean = $this->validated($key, $locale, $fields);

        return DB::transaction(function () use ($staff, $key, $locale, $clean): ?MessageTemplate {
            $row = MessageTemplate::query()->where('key', $key)->where('locale', $locale)->lockForUpdate()->first();
            $before = $row === null ? [] : $row->fields;
            $after = array_filter([...$before, ...$clean], fn (?string $text): bool => $text !== null && $text !== '');

            if ($after === []) {
                $row?->delete();
            } else {
                $row ??= new MessageTemplate(['key' => $key, 'locale' => $locale]);
                $row->fill(['fields' => $after, 'updated_by' => $staff->getKey()])->save();
            }

            DB::afterCommit(fn () => $this->templates->flush());

            Audit::record(ContentEvent::TemplateSaved->value, $row,
                before: ['key' => $key, 'locale' => $locale, 'fields' => array_intersect_key($before, $clean)],
                after: ['key' => $key, 'locale' => $locale, 'fields' => array_intersect_key($after, $clean)],
                actor: $staff);

            return $after === [] ? null : $row;
        });
    }

    /**
     * @param  array<string, mixed>  $fields
     * @return array<string, string|null>
     *
     * @throws ValidationException|ConfigRefused
     */
    public function validated(string $key, string $locale, array $fields): array
    {
        if ($this->registry->get($key) === null) {
            throw new ConfigRefused('template_unknown');
        }

        if (! in_array($locale, config()->array('speedclub.locales'), true)) {
            throw ValidationException::withMessages(['locale' => [(string) __('validation.in', ['attribute' => 'locale'])]]);
        }

        $defaults = $this->registry->defaults($key, $locale);
        $clean = [];
        $errors = [];

        foreach ($fields as $field => $text) {
            $field = (string) $field;

            if (! isset($defaults[$field]) || ! $this->registry->editable($key, $field)) {
                throw new ConfigRefused('template_fixed', ['field' => $field]);
            }

            if ($text !== null && ! is_string($text)) {
                $errors["fields.$field"] = (string) __('validation.string', ['attribute' => $field]);

                continue;
            }

            $text = $text === null ? null : trim($text);
            $max = $field === 'subject' ? 200 : 2000;

            if ($text !== null && mb_strlen($text) > $max) {
                $errors["fields.$field"] = (string) __('validation.max.string', ['attribute' => $field, 'max' => $max]);
            }

            $unknown = $text === null ? [] : array_diff(TemplateRegistry::variables($text), TemplateRegistry::variables($defaults[$field]));

            if ($unknown !== []) {
                $errors["fields.$field"] = (string) __('content.templates.unknown_variables', ['names' => ':'.implode(', :', $unknown)]);
            }

            if ($text !== null && $text !== '' && substr_count($text, '|') !== substr_count($defaults[$field], '|')) {
                $errors["fields.$field"] = (string) __('content.templates.plural_forms');
            }

            $clean[$field] = $text === '' ? null : $text;
        }

        if ($errors !== []) {
            throw ValidationException::withMessages(array_map(fn (string $message): array => [$message], $errors));
        }

        return $clean;
    }
}
