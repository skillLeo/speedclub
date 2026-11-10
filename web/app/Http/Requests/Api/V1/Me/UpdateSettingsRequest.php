<?php

namespace App\Http\Requests\Api\V1\Me;

use App\Enums\PowerDisplay;
use App\Enums\ThemePreference;
use App\Enums\WhoCanMessage;
use App\Services\Notifications\NotificationPrefs;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateSettingsRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'theme' => ['sometimes', 'required', Rule::enum(ThemePreference::class)],
            'locale' => ['sometimes', 'required', Rule::in(config()->array('speedclub.locales'))],
            'power_display' => ['sometimes', 'required', Rule::enum(PowerDisplay::class)],
            // Account-wide: off names the owner to nobody but the owner on WEB-01, VEH-01, feed cards and the sticker PDF (ADR-148 a).
            'show_owner_on_qr' => ['sometimes', 'required', 'boolean:strict'],
            // SET-07 privacy (M2.5), each with an effect: messaging starts and requests, member search, search engines, read receipts.
            'who_can_message' => ['sometimes', 'required', Rule::enum(WhoCanMessage::class)],
            'discoverable' => ['sometimes', 'required', 'boolean:strict'],
            'indexable' => ['sometimes', 'required', 'boolean:strict'],
            'read_receipts' => ['sometimes', 'required', 'boolean:strict'],
            // M3.7 SET privacy "KI-Vorschläge": the opt-in of the [AI] suggestion features (02 §6), off by default.
            'ai_suggestions' => ['sometimes', 'required', 'boolean:strict'],
            ...$this->notificationRules(),
        ];
    }

    /**
     * SET-09 (M2.5 screen): any part may be sent, the rest stays. Every level refuses keys it does not know (422), so a typo never
     * silently keeps a push switched on.
     *
     * @return array<string, mixed>
     */
    private function notificationRules(): array
    {
        $types = NotificationPrefs::TYPES;
        $rules = [
            'notification_prefs' => ['sometimes', 'required', 'array:types,quiet_hours,message_previews'],
            'notification_prefs.types' => ['sometimes', 'required', 'array:'.implode(',', array_keys($types))],
            'notification_prefs.quiet_hours' => ['sometimes', 'required', 'array:enabled,from,to'],
            'notification_prefs.quiet_hours.enabled' => ['sometimes', 'required', 'boolean:strict'],
            'notification_prefs.quiet_hours.from' => ['sometimes', 'required', 'string', 'regex:'.NotificationPrefs::TIME_PATTERN],
            'notification_prefs.quiet_hours.to' => ['sometimes', 'required', 'string', 'regex:'.NotificationPrefs::TIME_PATTERN],
            // Push previews of messages (ADR-035), off by default.
            'notification_prefs.message_previews' => ['sometimes', 'required', 'boolean:strict'],
        ];

        foreach ($types as $type => $channels) {
            $rules["notification_prefs.types.$type"] = ['sometimes', 'required', 'array:'.implode(',', array_keys($channels))];

            foreach (array_keys($channels) as $channel) {
                $rules["notification_prefs.types.$type.$channel"] = ['sometimes', 'required', 'boolean:strict'];
            }
        }

        return $rules;
    }
}
