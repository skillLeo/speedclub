<?php

namespace App\Mail;

use App\Services\Content\MessageTemplates;
use App\Support\Mail\MailTheme;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * Single column, light, HTML and plain text (docs/03_DESIGN_SYSTEM.md). No body contains a secret beyond the code.
 * The texts are read during sending, inside the recipient's locale. The public $code reaches the dev mail preview.
 */
abstract class AuthMail extends Mailable
{
    public ?string $code = null;

    abstract protected function subjectLine(): string;

    abstract protected function heading(): string;

    /**
     * @return list<string> paragraphs above the code or the buttons
     */
    abstract protected function lines(): array;

    /**
     * @return list<array{label: string, url: string}>
     */
    protected function actions(): array
    {
        return [];
    }

    protected function note(): ?string
    {
        return null;
    }

    public function envelope(): Envelope
    {
        $this->applyTemplates();

        return new Envelope(subject: $this->subjectLine());
    }

    public function content(): Content
    {
        $this->applyTemplates();

        return new Content(view: 'emails.auth', text: 'emails.auth-text', with: [
            'heading' => $this->heading(),
            'lines' => $this->lines(),
            'actions' => $this->actions(),
            'note' => $this->note(),
            'colors' => MailTheme::values(),
            'logoUrl' => $this->url('/brand/logo-wide-black-320.png'),
            'homeUrl' => $this->url('/'),
        ]);
    }

    /**
     * ADM-33: the edited texts of this locale over the lang lines (MessageTemplates), before any line is read.
     */
    private function applyTemplates(): void
    {
        app(MessageTemplates::class)->apply(app()->getLocale());
    }

    /**
     * From APP_URL, never from the Host header of a request.
     */
    protected function url(string $path): string
    {
        return rtrim(config()->string('app.url'), '/').$path;
    }
}
