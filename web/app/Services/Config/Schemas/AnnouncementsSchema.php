<?php

namespace App\Services\Config\Schemas;

use App\Enums\AnnouncementAudience;
use App\Enums\ConfigKey;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * `announcements` (ADM-30): {items: [{id, title, body: {de, en}, cta: {label: {de, en}, url: an internal path "/…" or an https URL}|null,
 * audience: all|new|with_vehicles, starts_at, ends_at (ISO, optional), dismissible, severity: info|warning}]}, at most
 * speedclub.content.announcements_max. A new item gets a ULID; the app stores dismissals per id on the device.
 */
final class AnnouncementsSchema extends Schema
{
    public function key(): ConfigKey
    {
        return ConfigKey::Announcements;
    }

    public function normalize(array $payload): array
    {
        $data = Validator::make($payload, [
            'items' => ['present', 'array', 'list', 'max:'.config()->integer('speedclub.content.announcements_max')],
            'items.*' => ['array'],
            'items.*.id' => ['nullable', 'string', 'ulid', 'distinct'],
            ...$this->localizedRules('items.*.title', true, 80),
            ...$this->localizedRules('items.*.body', true, 280),
            'items.*.cta' => ['nullable', 'array'],
            ...$this->localizedRules('items.*.cta.label', false, 30),
            'items.*.cta.url' => ['required_with:items.*.cta', 'string', 'max:500', 'regex:#\A(/(?!/)[A-Za-z0-9/_\-?=&.%~]*|https://[^\s<>"]+)\z#'],
            'items.*.audience' => ['required', Rule::enum(AnnouncementAudience::class)],
            'items.*.starts_at' => ['nullable', 'date'],
            'items.*.ends_at' => ['nullable', 'date'],
            'items.*.dismissible' => ['nullable', 'boolean'],
            'items.*.severity' => ['nullable', Rule::in(['info', 'warning'])],
        ])->validate();

        $items = [];
        $errors = [];

        foreach ($data['items'] as $index => $item) {
            $starts = $this->date($item['starts_at'] ?? null);
            $ends = $this->date($item['ends_at'] ?? null);

            if ($starts !== null && $ends !== null && $ends <= $starts) {
                $errors["items.$index.ends_at"] = (string) __('content.announcements.ends_before_start');
            }

            $cta = is_array($item['cta'] ?? null) ? ['label' => $this->localized($item['cta']['label'] ?? null), 'url' => (string) $item['cta']['url']] : null;

            if ($cta !== null && $cta['label'] === null) {
                $errors["items.$index.cta.label.de"] = (string) __('content.announcements.cta_label');
            }

            $items[] = [
                'id' => is_string($item['id'] ?? null) ? strtolower($item['id']) : strtolower((string) Str::ulid()),
                'title' => $this->localized($item['title']),
                'body' => $this->localized($item['body']),
                'cta' => $cta,
                'audience' => (string) $item['audience'],
                'starts_at' => $starts,
                'ends_at' => $ends,
                'dismissible' => (bool) ($item['dismissible'] ?? true),
                'severity' => (string) ($item['severity'] ?? 'info'),
            ];
        }

        if ($errors !== []) {
            $this->refuse($errors);
        }

        return ['items' => $items];
    }

    public function initial(): array
    {
        return ['items' => []];
    }
}
