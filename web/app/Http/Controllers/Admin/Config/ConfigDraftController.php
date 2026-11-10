<?php

namespace App\Http\Controllers\Admin\Config;

use App\Actions\Admin\Config\DiscardConfigDraft;
use App\Actions\Admin\Config\PublishConfigVersion;
use App\Actions\Admin\Config\RollbackConfigVersion;
use App\Actions\Admin\Config\SaveConfigDraft;
use App\Http\Controllers\Admin\Config\Requests\DiscardDraftRequest;
use App\Http\Controllers\Admin\Config\Requests\PublishRequest;
use App\Http\Controllers\Admin\Config\Requests\RollbackRequest;
use App\Http\Controllers\Admin\Config\Requests\SaveDraftRequest;
use App\Http\Controllers\Admin\Config\Support\ConfigAnswers;
use App\Http\Controllers\Controller;
use Symfony\Component\HttpFoundation\Response;

/**
 * The draft → publish → rollback writes of the M3.5 config keys (06 §1.5, m3.5 §1): ADM-28 branding, ADM-29 home curation, ADM-30
 * announcements, ADM-37 remote config, and ADM-35 rollbacks of any of them. The route names the key; each write goes through its Action
 * (atoms, revision check, four-eyes for maintenance on). Refusals come back as the error `refused` in words (ConfigAnswers).
 */
class ConfigDraftController extends Controller
{
    public function save(SaveDraftRequest $request, SaveConfigDraft $save): Response
    {
        return ConfigAnswers::run($request, function () use ($request, $save) {
            $save->handle($request->staff(), $request->key(), $request->payload(), $request->revision());

            return back(303)->with('success', 'config.flash.draft_saved');
        });
    }

    public function discard(DiscardDraftRequest $request, DiscardConfigDraft $discard): Response
    {
        return ConfigAnswers::run($request, function () use ($request, $discard) {
            $discard->handle($request->staff(), $request->key(), $request->optionalReason());

            return back(303)->with('success', 'config.flash.draft_discarded');
        });
    }

    public function publish(PublishRequest $request, PublishConfigVersion $publish): Response
    {
        return ConfigAnswers::run($request, function () use ($request, $publish) {
            $outcome = $publish->handle($request->staff(), $request->key(), $request->reason(), $request->integer('revision'));

            return ConfigAnswers::outcome($outcome->approval, 'config.flash.published');
        });
    }

    public function rollback(RollbackRequest $request, RollbackConfigVersion $rollback): Response
    {
        return ConfigAnswers::run($request, function () use ($request, $rollback) {
            $outcome = $rollback->handle($request->staff(), $request->key(), $request->version(), $request->reason());

            return ConfigAnswers::outcome($outcome->approval, 'config.flash.rolled_back');
        });
    }
}
