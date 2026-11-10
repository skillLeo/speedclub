<?php

namespace App\Actions\Admin\Privacy;

use App\Enums\PrivacyEvent;
use App\Enums\PrivacyReplyTemplate;
use App\Mail\PrivacyReplyMail;
use App\Models\PrivacyRequest;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Auth\AuthMailer;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * ADM-46 "Antwort senden" (`privacy.process`): one of the template replies (DE/EN) to the member's account address or the address the
 * requester gave, with an optional added paragraph (≤ 2000). The extension reply names the extension's reason; the refusal reply needs
 * the request to be rejected. Audited with template and locale, never the address or the text.
 *
 * @throws AuthorizationException|ValidationException|TeamRefused
 */
class SendPrivacyReply
{
    public function __construct(private readonly AuthMailer $mailer) {}

    public function handle(Staff $by, PrivacyRequest $request, PrivacyReplyTemplate $template, ?string $locale = null, ?string $detail = null): void
    {
        StaffAtoms::ensure($by, 'privacy.process');
        $locale ??= $request->locale;
        Validator::make(['locale' => $locale, 'detail' => $detail], [
            'locale' => ['required', Rule::in(config('speedclub.locales'))],
            'detail' => ['nullable', 'string', 'max:2000'],
        ])->validate();

        $address = $request->replyAddress();

        if ($address === null) {
            throw new TeamRefused('no_address');
        }

        if ($template === PrivacyReplyTemplate::Extension && $request->extended_at === null) {
            throw new TeamRefused('not_extended');
        }

        if ($template === PrivacyReplyTemplate::Rejected && $request->status->value !== 'rejected') {
            throw new TeamRefused('wrong_type');
        }

        $detail = $template === PrivacyReplyTemplate::Extension ? ($request->extension_reason ?? $detail) : $detail;

        DB::transaction(function () use ($by, $request, $template, $locale): void {
            $request->forceFill(['last_reply_at' => now()])->save();
            Audit::record(PrivacyEvent::ReplySent->value, $request, after: ['template' => $template->value, 'locale' => $locale], actor: $by);
        });

        $this->mailer->sendLater($address, $locale, new PrivacyReplyMail($template, $request->type, self::reference($request), $request->due_at, $detail));
    }

    public static function reference(PrivacyRequest $request): string
    {
        return 'DS-'.strtoupper(substr((string) $request->getKey(), -8));
    }
}
