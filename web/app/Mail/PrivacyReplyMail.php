<?php

namespace App\Mail;

use App\Enums\PrivacyReplyTemplate;
use App\Enums\PrivacyRequestType;
use App\Support\DisplayDate;
use Carbon\CarbonInterface;

/**
 * ADM-46 template replies to a GDPR request (DE/EN, lang privacy.reply.*): receipt with the due date, identity or details needed,
 * the Art. 12(3) extension with its reason, completion, refusal with the redress Art. 12(4) names. The request's own text is never
 * quoted back; the reference is the first characters of the request id.
 */
class PrivacyReplyMail extends AuthMail
{
    public function __construct(
        public readonly PrivacyReplyTemplate $template,
        public readonly PrivacyRequestType $type,
        public readonly string $reference,
        public readonly CarbonInterface $dueAt,
        public readonly ?string $detail = null,
    ) {}

    protected function subjectLine(): string
    {
        return (string) __("privacy.reply.{$this->template->value}.subject", $this->replace());
    }

    protected function heading(): string
    {
        return (string) __("privacy.reply.{$this->template->value}.heading", $this->replace());
    }

    protected function lines(): array
    {
        $lines = [(string) __("privacy.reply.{$this->template->value}.body", $this->replace())];

        if ($this->detail !== null && trim($this->detail) !== '') {
            $lines[] = trim($this->detail);
        }

        return $lines;
    }

    protected function note(): string
    {
        return (string) __('privacy.reply.note', ['reference' => $this->reference, 'support' => SupportAddress::get()]);
    }

    /**
     * @return array<string, string>
     */
    private function replace(): array
    {
        return [
            'reference' => $this->reference,
            'type' => (string) __("privacy.types.{$this->type->value}"),
            'article' => (string) $this->type->article(),
            'date' => DisplayDate::format($this->dueAt),
        ];
    }
}
