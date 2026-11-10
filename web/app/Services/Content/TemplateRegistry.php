<?php

namespace App\Services\Content;

use App\Enums\TemplateChannel;
use Illuminate\Support\Arr;

/**
 * The e-mail and push texts of ADM-33 (06 §3 "E-mail & push templates"). A template is a lang array (or one line) of lang/{de,en};
 * its fields are the string leaves under that prefix. Sign-in, code, security, account closing and moderation decision texts are fixed
 * (code, legal or DSA text, ADR-035) and shown read-only; editable templates can still fix single fields (the DSA redress lines).
 * Variables are the `:name` placeholders of the default text; an override may use only those (MessageTemplates).
 *
 * @phpstan-type Definition array{channel: TemplateChannel, prefix: string, editable: bool, fixed: list<string>}
 */
final class TemplateRegistry
{
    /** Values the preview and the test mail put in for the variables. */
    public const SAMPLES = [
        'name' => 'max.mustermann',
        'vehicle' => 'BMW M4 Competition (G82)',
        'count' => '3',
        'reference' => 'SC-2026-4711',
        'url' => 'https://speedclub.de/v/bmw-m4-g82-7k2m9q',
        'minutes' => '15',
        'month' => 'März 2027',
        'date' => '14.06.2026',
        'time' => '18:42',
        'days' => '7',
        'reason' => 'Beleidigung',
        'email' => 'm•••@example.de',
        'username' => 'max.mustermann',
        'code' => 'K7Q2-M9XA',
        'browser' => 'Safari auf iPhone',
        'device' => 'iPhone',
        'until' => '30.06.2026',
        'messages' => '5',
        'conversations' => '2',
        // ADM-33 preview: every placeholder of an editable or fixed template has a sample, so the preview never shows a raw ":name".
        'months' => '6',
        'support' => 'support@speedclub.de',
        'target' => 'Foto von BMW M4 Competition (G82)',
        'category' => 'QR-Sticker',
        'facts' => 'Das Foto zeigt ein lesbares Kennzeichen.',
        'ground' => 'Community-Richtlinien § 4',
        'title' => 'BMW M4 Competition (G82)',
        'label' => 'Inhalt entfernt',
        'text' => 'Neue Felgen montiert.',
        'message' => 'Hast du die Felgen eintragen lassen?',
        'id' => 'SC-2026-4711',
        'max' => '10',
        'action' => 'Ansehen',
    ];

    /**
     * @return array<string, Definition>
     */
    public function all(): array
    {
        $mail = TemplateChannel::Mail;
        $push = TemplateChannel::Push;

        return [
            'mail.report_received' => ['channel' => $mail, 'prefix' => 'moderation.mail.received', 'editable' => true, 'fixed' => []],
            'mail.report_outcome' => ['channel' => $mail, 'prefix' => 'moderation.mail.outcome', 'editable' => true, 'fixed' => ['redress', 'redress_no_date']],
            'mail.support_received' => ['channel' => $mail, 'prefix' => 'mail.support', 'editable' => true, 'fixed' => []],
            'mail.data_export_ready' => ['channel' => $mail, 'prefix' => 'mail.export', 'editable' => true, 'fixed' => []],
            'mail.hu_au_reminder' => ['channel' => $mail, 'prefix' => 'notifications.hu_au_mail', 'editable' => true, 'fixed' => []],
            'mail.message_digest' => ['channel' => $mail, 'prefix' => 'messaging.digest', 'editable' => true, 'fixed' => []],
            'mail.verification' => ['channel' => $mail, 'prefix' => 'mail.verification', 'editable' => false, 'fixed' => []],
            'mail.password_reset' => ['channel' => $mail, 'prefix' => 'mail.reset', 'editable' => false, 'fixed' => []],
            'mail.email_change' => ['channel' => $mail, 'prefix' => 'mail.email_change', 'editable' => false, 'fixed' => []],
            'mail.account_exists' => ['channel' => $mail, 'prefix' => 'mail.exists', 'editable' => false, 'fixed' => []],
            'mail.email_change_attempt' => ['channel' => $mail, 'prefix' => 'mail.email_change_attempt', 'editable' => false, 'fixed' => []],
            'mail.security_notice' => ['channel' => $mail, 'prefix' => 'mail.security', 'editable' => false, 'fixed' => []],
            'mail.account_closing' => ['channel' => $mail, 'prefix' => 'mail.closing', 'editable' => false, 'fixed' => []],
            'mail.moderation_decision' => ['channel' => $mail, 'prefix' => 'moderation.mail.decision', 'editable' => false, 'fixed' => []],
            'mail.decision_reversed' => ['channel' => $mail, 'prefix' => 'moderation.mail.reversed', 'editable' => false, 'fixed' => []],
            'mail.qr_changed_by_staff' => ['channel' => $mail, 'prefix' => 'mail.qr_staff', 'editable' => false, 'fixed' => []],
            'push.title' => ['channel' => $push, 'prefix' => 'notifications.title', 'editable' => true, 'fixed' => []],
            'push.new_follower' => ['channel' => $push, 'prefix' => 'notifications.new_follower', 'editable' => true, 'fixed' => []],
            'push.followed_published' => ['channel' => $push, 'prefix' => 'notifications.followed_published', 'editable' => true, 'fixed' => []],
            'push.build_saved' => ['channel' => $push, 'prefix' => 'notifications.build_saved', 'editable' => true, 'fixed' => []],
            'push.qr_milestone' => ['channel' => $push, 'prefix' => 'notifications.qr_milestone', 'editable' => true, 'fixed' => []],
            'push.hu_au_reminder' => ['channel' => $push, 'prefix' => 'notifications.hu_au_reminder', 'editable' => true, 'fixed' => []],
            'push.moderation_decision' => ['channel' => $push, 'prefix' => 'notifications.moderation_decision', 'editable' => true, 'fixed' => []],
        ];
    }

    /**
     * @return Definition|null
     */
    public function get(string $key): ?array
    {
        return $this->all()[$key] ?? null;
    }

    /**
     * The lang file's own lines of a template, by field ("text" for a template that is one line), never an override.
     *
     * @return array<string, string>
     */
    public function defaults(string $key, string $locale): array
    {
        $definition = $this->get($key);

        if ($definition === null) {
            return [];
        }

        [$group, $path] = explode('.', $definition['prefix'], 2);
        $lines = app('translator')->getLoader()->load($locale, $group, '*');
        $value = Arr::get($lines, $path);

        if (is_string($value)) {
            return ['text' => $value];
        }

        $fields = [];

        foreach (is_array($value) ? Arr::dot($value) : [] as $field => $line) {
            if (is_string($line)) {
                $fields[(string) $field] = $line;
            }
        }

        return $fields;
    }

    /** The full lang key of one field. */
    public function langKey(string $key, string $field): string
    {
        $prefix = $this->get($key)['prefix'] ?? '';

        return $field === 'text' ? $prefix : "$prefix.$field";
    }

    /**
     * @return list<string> the placeholders of a line, without the colon
     */
    public static function variables(string $line): array
    {
        preg_match_all('/:([A-Za-z][A-Za-z_]*)/', $line, $matches);

        return array_values(array_unique(array_map('strtolower', $matches[1])));
    }

    public function editable(string $key, string $field): bool
    {
        $definition = $this->get($key);

        return $definition !== null && $definition['editable'] && ! in_array($field, $definition['fixed'], true);
    }
}
