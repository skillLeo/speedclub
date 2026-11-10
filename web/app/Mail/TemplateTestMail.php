<?php

namespace App\Mail;

/**
 * ADM-33 "Test an mich senden": one template rendered with the sample values (MessageTemplates::render()), to the staff member's own
 * address, in the mail layout members get. A push template arrives as a mail showing its title and text. The subject says it is a test.
 */
class TemplateTestMail extends AuthMail
{
    /**
     * @param  array<string, string>  $fields  rendered fields of the template
     */
    public function __construct(public readonly string $templateKey, public readonly array $fields, public readonly bool $push) {}

    protected function subjectLine(): string
    {
        $subject = $this->push ? ($this->fields['text'] ?? $this->templateKey) : ($this->fields['subject'] ?? $this->templateKey);

        return (string) __('content.templates.test_subject', ['subject' => $subject]);
    }

    protected function heading(): string
    {
        return $this->fields['heading'] ?? (string) __('content.templates.test_heading', ['key' => $this->templateKey]);
    }

    protected function lines(): array
    {
        $lines = [];

        foreach ($this->fields as $field => $text) {
            if (! in_array($field, ['subject', 'heading', 'note'], true)) {
                $lines[] = $text;
            }
        }

        return $lines;
    }

    protected function note(): ?string
    {
        return $this->fields['note'] ?? null;
    }
}
