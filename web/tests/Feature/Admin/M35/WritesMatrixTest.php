<?php

use App\Enums\ConfigKey;
use App\Models\FeatureFlag;
use App\Models\HelpArticle;
use App\Models\LegalDocument;
use App\Models\Release;
use Illuminate\Support\Facades\Mail;

require_once __DIR__.'/Helpers.php';

/**
 * M3.5 writes (m3.5-contract §2/§6), lane b: the six-role matrix of every admin write (with a fresh password confirmation, so the atom
 * alone decides). The behaviour behind each write is in the other M35 tests.
 */
beforeEach(function () {
    Mail::fake();
    m35FakeDisks();
});

it('guards every write by its atom', function (string $method, string $uri, array $allowed, array $data) {
    $flag = FeatureFlag::factory()->create();
    $help = HelpArticle::factory()->create();
    $legal = LegalDocument::factory()->create();
    $release = Release::factory()->create();
    $uri = strtr($uri, ['{flag}' => (string) $flag->id, '{help}' => (string) $help->id, '{legal}' => (string) $legal->id, '{release}' => (string) $release->id]);

    adm32WriteMatrix($method, $uri, $allowed, $data);
})->with([
    'brand upload' => ['POST', '/admin/brand/assets', ADM35_CONTENT, ['kind' => 'hero']],
    'brand draft' => ['POST', '/admin/brand/draft', ADM35_CONTENT, ['payload' => m35Branding()]],
    'brand discard' => ['DELETE', '/admin/brand/draft', ADM35_CONTENT, []],
    'brand publish' => ['POST', '/admin/brand/publish', ADM35_CONTENT, ['reason' => adm32Reason(), 'revision' => 1]],
    'home draft' => ['POST', '/admin/content/home/draft', ADM35_CONTENT, ['payload' => ['featured' => [], 'collections' => []]]],
    'home discard' => ['DELETE', '/admin/content/home/draft', ADM35_CONTENT, []],
    'home publish' => ['POST', '/admin/content/home/publish', ADM35_CONTENT, ['reason' => adm32Reason(), 'revision' => 1]],
    'announcements draft' => ['POST', '/admin/content/announcements/draft', ADM35_CONTENT, ['payload' => ['items' => []]]],
    'announcements discard' => ['DELETE', '/admin/content/announcements/draft', ADM35_CONTENT, []],
    'announcements publish' => ['POST', '/admin/content/announcements/publish', ADM35_CONTENT, ['reason' => adm32Reason(), 'revision' => 1]],
    'legal preview' => ['POST', '/admin/content/legal/preview', ADM35_CONTENT, ['body_md' => '# Test']],
    'legal draft' => ['POST', '/admin/content/legal/imprint/de/draft', ADM35_CONTENT, ['version' => '9', 'body_md' => 'Neuer Text des Impressums, lang genug.']],
    'legal discard' => ['DELETE', '/admin/content/legal/drafts/{legal}', ADM35_CONTENT, []],
    'legal publish' => ['POST', '/admin/content/legal/drafts/{legal}/publish', ADM35_OWNER_ADMIN, ['reason' => adm32Reason()]],
    'help store' => ['POST', '/admin/content/help', ADM35_CONTENT, ['key' => 'matrix-help', 'locale' => 'de', 'title' => 'Matrix', 'body_md' => 'Text']],
    'help update' => ['PATCH', '/admin/content/help/{help}', ADM35_CONTENT, ['key' => 'matrix-help-2', 'locale' => 'de', 'title' => 'Matrix', 'body_md' => 'Text']],
    'help publish' => ['POST', '/admin/content/help/{help}/published', ADM35_CONTENT, ['published' => false]],
    'help delete' => ['DELETE', '/admin/content/help/{help}', ADM35_CONTENT, ['reason' => adm32Reason()]],
    'template save' => ['PUT', '/admin/content/templates/mail.report_received/de', ADM35_CONTENT, ['fields' => ['subject' => 'Deine Meldung ist da']]],
    'template reset' => ['DELETE', '/admin/content/templates/mail.report_received/de', ADM35_CONTENT, []],
    'template preview' => ['POST', '/admin/content/templates/mail.report_received/de/preview', ADM35_CONTENT, ['fields' => ['subject' => 'Neu']]],
    'template test' => ['POST', '/admin/content/templates/mail.report_received/de/test', ADM35_CONTENT, []],
    'rollback branding' => ['POST', '/admin/content/versions/branding/1/rollback', ADM35_CONTENT, ['reason' => adm32Reason()]],
    'rollback remote config' => ['POST', '/admin/content/versions/remote_config/1/rollback', ADM35_OWNER_ADMIN, ['reason' => adm32Reason()]],
    'flag change' => ['PATCH', '/admin/config/flags/{flag}', ADM35_OWNER_ADMIN, ['changes' => ['staff_only' => true], 'reason' => adm32Reason()]],
    'remote draft' => ['POST', '/admin/config/remote/draft', ADM35_OWNER_ADMIN, ['payload' => m35Remote()]],
    'remote discard' => ['DELETE', '/admin/config/remote/draft', ADM35_OWNER_ADMIN, []],
    'remote publish' => ['POST', '/admin/config/remote/publish', ADM35_OWNER_ADMIN, ['reason' => adm32Reason(), 'revision' => 1]],
    'release store' => ['POST', '/admin/config/releases', ADM35_OWNER_ADMIN, ['version_name' => '1.0.0', 'version_code' => 100, 'platform' => 'android', 'channel' => 'production']],
    'release update' => ['PATCH', '/admin/config/releases/{release}', ADM35_OWNER_ADMIN, ['notes' => 'Korrigiert.']],
    'release sync' => ['POST', '/admin/config/releases/sync', ADM35_OWNER_ADMIN, []],
]);

it('never routes a rollback of a key outside M3.5 (org belongs to the Owner page of M3.6)', function () {
    adm32SignedIn('owner');

    expect($this->post('/admin/content/versions/org/1/rollback', ['reason' => adm32Reason()])->status())->toBeIn([404, 405]);
    expect(ConfigKey::tryFrom('org'))->not->toBeNull();
});
