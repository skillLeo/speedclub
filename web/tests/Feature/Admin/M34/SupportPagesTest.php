<?php

use App\Actions\Admin\Support\RevealTicketContact;
use App\Actions\Support\CreateSupportTicket;
use App\Enums\ApprovalStatus;
use App\Enums\SupportCategory;
use App\Enums\SupportTicketStatus;
use App\Mail\SupportReplyMail;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\SupportMacro;
use App\Models\SupportTicket;
use App\Models\TicketMessage;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Support\SendSupportReplyMail;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/Helpers.php';

/**
 * M3.4 support admin (ADM-25…27, m3.4-contract §1/§3), lane b: the matrix by the 06 §2 role table, replies reaching the member's SET-15
 * thread (never the internal notes) and the web contact's mailbox, status, assignment, bulk with its four-eyes threshold, macros.
 */
const ADM34_SUPPORT_VIEW = ['owner', 'admin', 'moderator', 'support'];
const ADM34_SUPPORT_REPLY = ['owner', 'admin', 'support'];

beforeEach(fn () => Mail::fake());

function adm34MemberTicket(?User $member = null): SupportTicket
{
    return app(CreateSupportTicket::class)->forMember($member ?? User::factory()->create(), SupportCategory::Qr, 'Sticker zeigt falsches Auto', 'Mein QR-Code öffnet das alte Fahrzeug. Was tun?');
}

function adm34GuestTicket(): SupportTicket
{
    return app(CreateSupportTicket::class)->forGuest('Thomas Berger', 'thomas.berger@beispiel.test', SupportCategory::Account, 'Ich bekomme noch E-Mails nach der Löschung.', 'de');
}

describe('authorisation matrix', function () {
    it('guards the pages by support.view', function (string $uri, string $component) {
        $ticket = adm34MemberTicket();
        assertAdminMatrix('GET', str_replace('{ticket}', $ticket->id, $uri), ADM34_SUPPORT_VIEW, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->component($component)));
    })->with([
        'ADM-25' => ['/admin/support/tickets', 'Support/Tickets'],
        'ADM-26' => ['/admin/support/tickets/{ticket}', 'Support/Ticket'],
        'ADM-27' => ['/admin/support/macros', 'Support/Macros'],
    ]);

    it('guards every write by support.reply or support.macros', function (string $method, string $uri, array $allowed, array $data) {
        $ticket = adm34MemberTicket();
        $macro = SupportMacro::query()->orderBy('key')->firstOrFail();
        adm32WriteMatrix($method, strtr($uri, ['{ticket}' => $ticket->id, '{macro}' => $macro->id]), $allowed, $data);
    })->with([
        'reply' => ['POST', '/admin/support/tickets/{ticket}/reply', ADM34_SUPPORT_REPLY, ['body' => 'Hallo, das klären wir gleich.']],
        'note' => ['POST', '/admin/support/tickets/{ticket}/notes', ADM34_SUPPORT_REPLY, ['body' => 'Intern: Sticker prüfen.']],
        'status' => ['PATCH', '/admin/support/tickets/{ticket}', ADM34_SUPPORT_REPLY, ['status' => 'closed']],
        'bulk' => ['POST', '/admin/support/tickets/bulk', ADM34_SUPPORT_REPLY, ['action' => 'status', 'status' => 'closed', 'ids' => ['01m6xrkefah44swwdp1s6776yw'], 'reason' => adm32Reason()]],
        'macro add' => ['POST', '/admin/support/macros', ADM34_SUPPORT_REPLY, ['key' => 'danke', 'locale' => 'de', 'title' => 'Danke', 'body' => 'Hallo {name}, danke für deine Nachricht.']],
        'macro edit' => ['PATCH', '/admin/support/macros/{macro}', ADM34_SUPPORT_REPLY, ['key' => 'need_details', 'locale' => 'de', 'title' => 'Mehr Details', 'body' => 'Hallo {name}, wir brauchen mehr Angaben.']],
        'macro delete' => ['DELETE', '/admin/support/macros/{macro}', ADM34_SUPPORT_REPLY, []],
    ]);
});

describe('replies', function () {
    it('puts a reply into the member SET-15 thread and keeps the internal note out of it', function () {
        $member = User::factory()->create();
        $ticket = adm34MemberTicket($member);
        $staff = adm34As('support');

        $this->post("/admin/support/tickets/{$ticket->id}/notes", ['body' => 'Intern: Sticker am alten Auto prüfen.'])->assertSessionHas('success', 'support.flash.noted');
        $this->post("/admin/support/tickets/{$ticket->id}/reply", ['body' => 'Gib in der App einen neuen Code aus.'])->assertSessionHas('success', 'support.flash.replied');

        expect($ticket->refresh()->status)->toBe(SupportTicketStatus::Pending)
            ->and($ticket->assigned_staff_id)->toBe($staff->id)
            ->and(AuditEvent::query()->whereIn('action', ['support.note_added', 'support.replied'])->count())->toBe(2);
        Mail::assertNotQueued(SupportReplyMail::class);
        Mail::assertNotSent(SupportReplyMail::class);

        Sanctum::actingAs($member);
        $thread = $this->getJson("/api/v1/support/tickets/{$ticket->id}")->assertOk()->json('data');
        expect(array_column($thread['messages'], 'body'))->toBe(['Mein QR-Code öffnet das alte Fahrzeug. Was tun?', 'Gib in der App einen neuen Code aus.'])
            ->and(array_column($thread['messages'], 'author'))->toBe(['member', 'team'])
            ->and(json_encode($thread))->not->toContain('Intern:')->not->toContain($staff->name);
        $this->getJson('/api/v1/support/tickets')->assertOk()->assertJsonPath('data.0.id', $ticket->id);

        Sanctum::actingAs(User::factory()->create());
        $this->getJson("/api/v1/support/tickets/{$ticket->id}")->assertNotFound();
    });

    it('mails a reply to the web contact, once, and never a note', function () {
        Queue::fake();
        $ticket = adm34GuestTicket();
        adm34As('support');

        $this->post("/admin/support/tickets/{$ticket->id}/notes", ['body' => 'Intern: Konto ist gelöscht.']);
        $this->post("/admin/support/tickets/{$ticket->id}/reply", ['body' => 'Wir haben die E-Mails gestoppt.', 'status' => 'closed'])->assertSessionHas('success');
        Queue::assertPushed(SendSupportReplyMail::class, 1);

        $message = TicketMessage::query()->where('ticket_id', $ticket->id)->where('author_type', 'staff')->where('internal', false)->sole();
        app()->call([new SendSupportReplyMail($message->id), 'handle']);
        app()->call([new SendSupportReplyMail($message->id), 'handle']);
        Mail::assertSent(SupportReplyMail::class, fn (SupportReplyMail $mail) => $mail->hasTo('thomas.berger@beispiel.test') && $mail->body === 'Wir haben die E-Mails gestoppt.');
        Mail::assertSent(SupportReplyMail::class, 1);
        expect($message->refresh()->mailed_at)->not->toBeNull()->and($ticket->refresh()->status)->toBe(SupportTicketStatus::Closed);
    });

    it('masks the web contact address without members.view_pii and links the member record with members.view', function () {
        $guest = adm34GuestTicket();
        adm34As('moderator');
        $this->get("/admin/support/tickets/{$guest->id}")->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->where('ticket.from.email', fn (string $email) => ! str_contains($email, 'thomas.berger')));
        $member = adm34MemberTicket();
        $this->get("/admin/support/tickets/{$member->id}")->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->where('ticket.member_link', true)->has('thread', 1));
    });
});

describe('revealing a web contact address (code review M3.3-app MF-B)', function () {
    it('needs members.view_pii as well as support.view, and audits every reveal', function () {
        $guest = adm34GuestTicket();

        // Moderator: support.view without any PII atom → refused, nothing audited.
        adm34As('moderator');
        $this->postJson("/admin/support/tickets/{$guest->id}/contact")->assertForbidden();
        expect(AuditEvent::query()->where('action', 'support.contact_viewed')->count())->toBe(0);

        // Content editor: neither atom.
        adm34As('content_editor');
        $this->postJson("/admin/support/tickets/{$guest->id}/contact")->assertForbidden();

        // Support: support.view + members.view_pii → the address, audited once.
        adm34As('support');
        $this->postJson("/admin/support/tickets/{$guest->id}/contact")->assertOk()->assertJsonPath('email', 'thomas.berger@beispiel.test');
        expect(AuditEvent::query()->where('action', 'support.contact_viewed')->count())->toBe(1);
    });

    it('refuses the Action itself for a staff member without members.view_pii', function () {
        $guest = adm34GuestTicket();
        $moderator = adm34As('moderator');
        expect(fn () => app(RevealTicketContact::class)->handle($moderator, $guest))->toThrow(AuthorizationException::class);
    });
});

describe('status, assignment and bulk', function () {
    it('assigns to a colleague who may reply, and refuses one who may not', function () {
        $ticket = adm34MemberTicket();
        adm34As('support');
        $colleague = staffWithRole('admin');
        $this->patch("/admin/support/tickets/{$ticket->id}", ['staff_id' => $colleague->id])->assertSessionHas('success');
        expect($ticket->refresh()->assigned_staff_id)->toBe($colleague->id);
        $this->patch("/admin/support/tickets/{$ticket->id}", ['staff_id' => staffWithRole('moderator')->id])->assertSessionHasErrors('staff_id');
        $this->patch("/admin/support/tickets/{$ticket->id}", ['staff_id' => null])->assertSessionHas('success');
        expect($ticket->refresh()->assigned_staff_id)->toBeNull();
    });

    it('changes the status of several tickets and asks for an approval above 100 in 24 hours', function () {
        $tickets = [adm34MemberTicket(), adm34GuestTicket()];
        $staff = adm34As('support');
        $this->post('/admin/support/tickets/bulk', ['action' => 'status', 'status' => 'closed', 'ids' => array_map(fn ($t) => $t->id, $tickets), 'reason' => adm32Reason()])->assertSessionHas('support_bulk');
        expect(SupportTicket::query()->where('status', 'closed')->count())->toBe(2);

        DB::transaction(fn () => Audit::record('support.bulk_status', null, after: ['records' => 99, 'done' => 99, 'failed' => 0, 'approved_by' => null], reason: adm32Reason(), actor: $staff));
        $this->post('/admin/support/tickets/bulk', ['action' => 'status', 'status' => 'open', 'ids' => array_map(fn ($t) => $t->id, $tickets), 'reason' => adm32Reason()])->assertSessionHas('approval');
        expect(ApprovalRequest::query()->sole())->action->toBe('support.bulk_status')->status->toBe(ApprovalStatus::Pending)
            ->and(SupportTicket::query()->where('status', 'open')->count())->toBe(0);
    });
});

describe('macros', function () {
    it('ships the default macros in both languages and fills their variables for a ticket', function () {
        $ticket = adm34MemberTicket(User::factory()->create(['display_name' => 'Aylin']));
        $staff = adm34As('support');
        $this->get("/admin/support/tickets/{$ticket->id}")->assertOk()->assertInertia(fn (AssertableInertia $p) => $p
            ->where('variables.name', 'Aylin')
            ->where('variables.reference', CreateSupportTicket::reference($ticket))
            // DQ-572, ADR-240 (f): members never read a staff name; replies sign as the team.
            ->missing('variables.staff')
            ->where('macros', fn ($macros) => collect($macros)->every(fn ($m) => ! str_contains($m['body'], '{staff}') && ! str_contains($m['body'], $staff->name)))
            ->has('macros', SupportMacro::query()->count()));
        expect(SupportMacro::query()->where('locale', 'de')->count())->toBe(SupportMacro::query()->where('locale', 'en')->count());
    });

    it('refuses a second macro of the same key and language', function () {
        adm34As('support');
        $data = ['key' => 'received', 'locale' => 'de', 'title' => 'Doppelt', 'body' => 'Hallo {name}, doppelt.'];
        $this->post('/admin/support/macros', $data)->assertSessionHasErrors('key');
    });
});
