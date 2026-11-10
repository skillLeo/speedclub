<?php

namespace App\Services\Content;

use App\Models\MessageTemplate;
use Illuminate\Support\Facades\Cache;
use Illuminate\Translation\MessageSelector;
use Illuminate\Translation\Translator;
use Throwable;

/**
 * The template overrides of ADM-33 at send time. Mails (App\Mail\AuthMail) and push texts (NotificationTexts) call apply() for the
 * recipient's locale before reading their lang lines: the overrides of that locale are put over the lang file's lines in the
 * translator, so every `__()` of a template reads the edited text with the same placeholders. Cached forever, flushed on every save; a
 * process (queue worker) re-applies when the cache changed and restores the file's line for an override that was removed.
 */
final class MessageTemplates
{
    private const CACHE_KEY = 'content:message-templates:v1';

    /** @var array<string, array<string, string>> lang key => text, per locale, as applied in this process */
    private static array $applied = [];

    public function __construct(private readonly TemplateRegistry $registry) {}

    public function apply(string $locale): void
    {
        try {
            $current = $this->overrides()[$locale] ?? [];
        } catch (Throwable) {
            return;
        }

        $previous = self::$applied[$locale] ?? [];

        if ($current === $previous) {
            return;
        }

        /** @var Translator $translator */
        $translator = app('translator');
        $lines = $current;

        foreach (array_diff_key($previous, $current) as $langKey => $_) {
            $lines[$langKey] = $this->fileLine($langKey, $locale);
        }

        foreach (array_unique(array_map(fn (string $langKey): string => explode('.', $langKey, 2)[0], array_keys($lines))) as $group) {
            $translator->load('*', $group, $locale);
        }

        $translator->addLines(array_filter($lines, is_string(...)), $locale);
        self::$applied[$locale] = $current;
    }

    public function flush(): void
    {
        Cache::forget(self::CACHE_KEY);
    }

    /**
     * A template's fields with the samples put in (the ADM-33 preview and the test mail). $fields overrides the saved text (an unsaved
     * edit); a choice line ("{1} …|[2,*] …") is shown for the sample count.
     *
     * @param  array<string, string>|null  $fields
     * @return array<string, string>
     */
    public function render(string $key, string $locale, ?array $fields = null): array
    {
        $texts = [...$this->registry->defaults($key, $locale), ...$this->saved($key, $locale), ...($fields ?? [])];
        $rendered = [];

        foreach ($texts as $field => $text) {
            if (str_contains($text, '|')) {
                $text = (new MessageSelector)->choose($text, (int) TemplateRegistry::SAMPLES['count'], $locale);
            }

            $rendered[$field] = $this->fill($text);
        }

        return $rendered;
    }

    /**
     * @return array<string, string> the saved overrides of one template and locale, by field
     */
    public function saved(string $key, string $locale): array
    {
        $row = MessageTemplate::query()->where('key', $key)->where('locale', $locale)->first();

        return $row === null ? [] : $row->fields;
    }

    /**
     * @return array<string, array<string, string>>
     */
    private function overrides(): array
    {
        /** @var array<string, array<string, string>> */
        return Cache::rememberForever(self::CACHE_KEY, function (): array {
            $map = [];

            foreach (MessageTemplate::query()->orderBy('id')->get() as $row) {
                if ($this->registry->get($row->key) === null) {
                    continue;
                }

                foreach ($row->fields as $field => $text) {
                    if ($this->registry->editable($row->key, (string) $field)) {
                        $map[$row->locale][$this->registry->langKey($row->key, (string) $field)] = $text;
                    }
                }
            }

            return $map;
        });
    }

    private function fileLine(string $langKey, string $locale): ?string
    {
        [$group, $path] = explode('.', $langKey, 2);
        $lines = app('translator')->getLoader()->load($locale, $group, '*');
        $value = data_get($lines, $path);

        return is_string($value) ? $value : null;
    }

    private function fill(string $text): string
    {
        return (string) preg_replace_callback('/:([A-Za-z][A-Za-z_]*)/', function (array $match): string {
            $sample = TemplateRegistry::SAMPLES[strtolower($match[1])] ?? null;

            return $sample ?? $match[0];
        }, $text);
    }
}
