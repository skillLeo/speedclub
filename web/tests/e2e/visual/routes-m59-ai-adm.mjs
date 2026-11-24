// Visual registry entries of M5.9 AI helpers, admin part (m5.9-contract §8 D-5 and §2.4; commit 40aef7b6): ADM-14's model page with
// "KI-Herstellerangaben" (Pages/Catalog/Partials/AiSpecsSection.vue) and its reason dialog, and ADM-21's decision composer with the
// triage's "KI-Vorschlag: <Vorlage>" (DecisionComposer.vue). Same fields as routes.mjs, which merges this list.
//
// No provider runs locally (OA-18), so no seed has a cached spec suggestion or a triage template: the cells run inside the stage
// fixture `m59-ai-admin` (support/stage-fixtures.mjs, support/backend.php m59AiAdminFixture): two cached suggestions of BMW M3 (E30 since
// 03.11.2026, E46 since 12.11.2026), score 0,74 with a reason and the template key street_racing on the web notice of paul.roadster's
// MX-5, and ai.moderation_triage on (the case page shows the triage only with it). The teardown removes exactly those rows and puts
// the case's columns and the flag back.

const FIXTURE = 'm59-ai-admin';
const FIXTURE_NOTE = 'Inside the stage fixture m59-ai-admin (cached suggestions and the triage template are written for the capture only).';
/** The web notice of the matrix (ModerationDemoSeeder fixedId): paul.roadster's MX-5, reported through WEB-09 for illegal racing. */
const CASE = '01m66awqg0mg086app44e8jg60';

/** @type {import('./matrix.mjs').RouteDef[]} */
export const routesM59AiAdm = [
  {
    id: 'ADM-14-model-aiSpecs',
    path: '/admin/catalog/models/6',
    phase: 3,
    auth: 'staff-content',
    states: ['default'],
    fixture: FIXTURE,
    ready: '[data-qa-state="ready"] [data-testid="ADM-14-model.ai-specs"] [data-testid="ADM-14-model.ai-specs.row"]',
    notes: `${FIXTURE_NOTE} M5.9 D-5 BMW M3 as the content editor: under the generations table the section "KI-Herstellerangaben" (headline) with its intro ("Typische Werksangaben, die Mitglieder … übernehmen können. Ist ein Wert falsch, lösch den Vorschlag …"), then a hairline list of the generations with a cached suggestion, "E30" · "Vorschlag vom 03.11.2026" and "E46" · "Vorschlag vom 12.11.2026" (tnum), each with a red text-only "Löschen" (Button variant destructive-ghost, trash glyph; accessible name "KI-Herstellerangaben von E30 löschen"; catalog.manage; DQ-P5-064). Generations without one are not listed.`,
  },
  {
    id: 'ADM-14-model-aiSpecs-dialog',
    path: '/admin/catalog/models/6?dialog=ai-specs',
    phase: 3,
    auth: 'staff-content',
    states: ['default', 'error'],
    fixture: FIXTURE,
    ready: '[data-testid="ADM-14-model.ai-specs.dialog"]',
    capture: 'viewport',
    notes: `${FIXTURE_NOTE} The reason dialog of the first row (?dialog=ai-specs opens it): "KI-Herstellerangaben von E30 löschen?", "Der gespeicherte Vorschlag wird gelöscht. Was Mitglieder schon übernommen haben, bleibt an ihren Fahrzeugen.", the reason field (10–1.000 characters), Abbrechen and the red "KI-Herstellerangaben löschen" (danger, the only red fill). error = the dialog's server error line.`,
  },
  {
    id: 'ADM-21-aiTemplate',
    volatile: true,
    path: `/admin/moderation/cases/${CASE}?dialog=decide`,
    phase: 3,
    auth: 'staff-moderator',
    states: ['default'],
    fixture: FIXTURE,
    ready: '[data-testid="ADM-21.composer.ai-template"]',
    capture: 'viewport',
    notes: `${FIXTURE_NOTE} M5.9 (10 §8.6) the decision composer of the MX-5 web notice as moderator: one bordered line "KI-Vorschlag: Verherrlichung illegaler Rennen" (the template in the member's language) with "Nur ein Vorschlag. Du prüfst die Vorlage und entscheidest selbst." under it and "Vorlage einsetzen" (secondary S), which has the initial focus (DQ-P5-063: no focus ring on a radio); nothing preselected, all four action radios empty, the template field still empty; the human applies it and decides.`,
  },
  {
    id: 'ADM-21-aiTemplate-applied',
    volatile: true,
    path: `/admin/moderation/cases/${CASE}?dialog=decide`,
    phase: 3,
    auth: 'staff-moderator',
    states: ['default'],
    fixture: FIXTURE,
    walk: async ({ page }) => {
      const apply = page.getByTestId('ADM-21.composer.ai-template.apply');
      await apply.waitFor({ state: 'visible' });
      await apply.click();
      // DQ-P5-061: no hover state in the picture (the button stays under the pointer, disabled as "Eingesetzt").
      await page.mouse.move(0, 0);
    },
    // The template applied (the button disabled) and the DE/EN preview of the statement loaded, so nothing is in flight.
    ready:
      '[id="ADM-21.composer-form"]:has([data-testid="ADM-21.composer.ai-template.apply"]:disabled) ' +
      '[data-testid="ADM-21.composer.preview"]:not([aria-busy="true"]) :is([data-testid="ADM-21.composer.preview.de"], [data-testid="ADM-21.composer.preview.en"])',
    capture: 'viewport',
    notes: `${FIXTURE_NOTE} DQ-P5-057 (c): the composer after "Vorlage einsetzen": the AI line keeps its text, its button reads "Eingesetzt" (disabled); the template "Verherrlichung illegaler Rennen" fills the statement (facts with the reported content and date, ground "§ 315d StGB … und Community-Richtlinien", document Gesetz) and picks its action "Inhalt entfernen", which the moderator can still change; the DE/EN preview below. Nothing is sent: the human still decides with "Entscheidung senden".`,
  },
  {
    id: 'ADM-21-aiTemplate-case',
    volatile: true,
    path: `/admin/moderation/cases/${CASE}`,
    phase: 3,
    auth: 'staff-moderator',
    states: ['default'],
    fixture: FIXTURE,
    ready: '[data-qa-state="ready"] [data-testid="ADM-21.overview"]',
    notes: `${FIXTURE_NOTE} The case page behind it with the triage on: the outlined "KI-Vorschlag 74 %" chip in the meta line (M3.7, ai.moderation_triage; its reason in the chip's tooltip), the rest as ADM-21; the composer opens from "Entscheiden".`,
  },
];
