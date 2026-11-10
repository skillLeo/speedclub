<?php

use App\Actions\Admin\Content\DeleteHelpArticle;
use App\Actions\Admin\Content\SaveHelpArticle;
use App\Actions\Admin\Content\SetHelpArticlePublished;
use App\Models\AuditEvent;
use App\Models\HelpArticle;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/../Config/ConfigHelpers.php';

/**
 * ADM-32: help articles DE/EN with category and order; new ones start unpublished, live ones need content.publish to change.
 */
function m35Article(array $overrides = []): array
{
    return ['key' => 'qr-sticker', 'locale' => 'de', 'category' => 'qr', 'title' => 'QR-Sticker anbringen', 'body_md' => 'So klebst du den Sticker.', 'sort' => 3, ...$overrides];
}

it('creates an unpublished article, publishes it and shows it in SET-14', function () {
    $editor = m31Staff('content_editor');
    $article = app(SaveHelpArticle::class)->handle($editor, null, m35Article());

    expect($article->published)->toBeFalse()->and($article->category)->toBe('qr');
    $this->getJson('/api/v1/help')->assertJsonMissing(['key' => 'qr-sticker']);

    app(SetHelpArticlePublished::class)->handle($editor, $article, true);
    $this->getJson('/api/v1/help')->assertJsonFragment(['key' => 'qr-sticker']);

    expect(AuditEvent::query()->whereIn('action', ['help.saved', 'help.published'])->count())->toBe(2);
});

it('needs content.publish to edit a live article, to publish and to delete', function () {
    $live = HelpArticle::factory()->create(m35Article(['published' => true]));
    $writer = m35StaffWith('content.view', 'content.edit');

    expect(fn () => app(SaveHelpArticle::class)->handle($writer, $live, m35Article(['title' => 'Neu'])))->toThrow(AuthorizationException::class);
    expect(fn () => app(SetHelpArticlePublished::class)->handle($writer, $live, false))->toThrow(AuthorizationException::class);
    expect(fn () => app(DeleteHelpArticle::class)->handle($writer, $live, m35Reason()))->toThrow(AuthorizationException::class);

    app(DeleteHelpArticle::class)->handle(m31Staff('content_editor'), $live, m35Reason());
    expect(HelpArticle::query()->count())->toBe(0);
});

it('validates key, locale and uniqueness', function (array $input) {
    HelpArticle::factory()->create(m35Article(['key' => 'taken']));

    expect(fn () => app(SaveHelpArticle::class)->handle(m31Staff('content_editor'), null, m35Article($input)))->toThrow(ValidationException::class);
})->with([
    'bad key' => [['key' => 'Böse Taste']],
    'unknown locale' => [['locale' => 'fr']],
    'taken key' => [['key' => 'taken']],
    'no title' => [['title' => '']],
]);
