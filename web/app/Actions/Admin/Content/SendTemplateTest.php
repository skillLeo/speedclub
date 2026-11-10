<?php

namespace App\Actions\Admin\Content;

use App\Enums\ContentEvent;
use App\Enums\TemplateChannel;
use App\Mail\TemplateTestMail;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Auth\AuthMailer;
use App\Services\Config\ConfigRefused;
use App\Services\Content\MessageTemplates;
use App\Services\Content\TemplateRegistry;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

/**
 * ADM-33 "Test an mich senden" (`content.edit`): the template with the sample values, the saved text or the unsaved $fields, sent to
 * the acting staff member's own address only (never another address). Audited as `template.test_sent` (template and locale; the
 * address is the actor's and not repeated).
 */
final class SendTemplateTest
{
    public function __construct(
        private readonly TemplateRegistry $registry,
        private readonly MessageTemplates $templates,
        private readonly SaveMessageTemplate $save,
        private readonly AuthMailer $mailer,
    ) {}

    /**
     * @param  array<string, mixed>|null  $fields
     *
     * @throws AuthorizationException|ValidationException|ConfigRefused
     */
    public function handle(Staff $staff, string $key, string $locale, ?array $fields = null): void
    {
        StaffAtoms::ensure($staff, 'content.edit');
        $definition = $this->registry->get($key);

        if ($definition === null) {
            throw new ConfigRefused('template_unknown');
        }

        $draft = $fields === null ? null : array_filter($this->save->validated($key, $locale, $fields), is_string(...));
        $rendered = $this->templates->render($key, $locale, $draft);

        $this->mailer->send((string) $staff->getAttribute('email'), $locale, new TemplateTestMail($key, $rendered, $definition['channel'] === TemplateChannel::Push));

        Audit::record(ContentEvent::TemplateTestSent->value, $staff, after: ['key' => $key, 'locale' => $locale, 'unsaved' => $draft !== null], actor: $staff);
    }
}
