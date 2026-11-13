#!/usr/bin/env node
/**
 * Builds the client preview of a phase: one self-contained HTML file (images, fonts and colours inline, no external request)
 * with the flagship screens of the phase in all three themes and German captions (release checklist).
 *
 *   node scripts/dev/build-client-preview.mjs --phase=1 [--src=DIR] [--summary=FILE] [--out=DIR]
 *
 * --src      the screenshots, default docs/reports/visual/phase-<N>. Sharp on Retina screens needs 2x captures, which the
 *            visual runner writes outside the gate:
 *              node scripts/dev/qa-run.mjs npm --prefix web run visual -- --tier=phase --phase=1 --device-scale=2 \
 *                --out=docs/reports/visual/preview-x2 --routes=AUTH-02,GAR-01,GAR-03-specs,GAR-10,VEH-01,QR-02,WEB-01,PROF-01,SET-10
 *            and then --src=docs/reports/visual/preview-x2/phase-1. The scale is read from each picture.
 * --summary  the gate's own phase-tier run (default docs/reports/visual/phase-<N>/summary.json). The "checked" line comes only
 *            from a passed phase-tier run of this phase and is left out otherwise.
 * Colours and layout values come from design/tokens/tokens.json, the logo from design/brand (the client's white version, only
 * scaled), the photo from design/seed-photos (licence in its CREDITS.md), fonts from the 2.0 font build in design/fonts/web
 * (ADR-402), WebP from sharp, the public page's path from the visual route registry.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const requireWeb = createRequire(join(root, 'web', 'package.json'));
const sharp = requireWeb('sharp');
const visualDir = join(root, 'web', 'tests', 'e2e', 'visual');
const { routes: ROUTES } = await import(pathToFileURL(join(visualDir, 'routes.mjs')).href);

const { values } = parseArgs({
  options: { phase: { type: 'string', default: '1' }, src: { type: 'string' }, summary: { type: 'string' }, out: { type: 'string' } },
});
const phase = Number(values.phase);
const src = resolve(root, values.src ?? `docs/reports/visual/phase-${phase}`);
const summaryPath = resolve(root, values.summary ?? `docs/reports/visual/phase-${phase}/summary.json`);
const out = resolve(root, values.out ?? `docs/reports/phase-${phase}/client-preview`);

/**
 * @typedef {{ fs: string, route: string, nav: string, title: string, caption: string, firstScreen?: boolean, desktop?: boolean, admin?: boolean, sameInAllThemes?: string }} Screen
 * firstScreen: show only the first phone screen. A Blade page scrolls the document, so a full-page capture paints its fixed
 * bottom bar where the first screen ends; the first screen is what a phone shows.
 * sameInAllThemes: the note shown with a single phone when the three captures are identical (checked pixel by pixel).
 * admin: an admin portal page (03_DESIGN_SYSTEM §14): no phones, the desktop at ADMIN in the ADMIN_THEMES only.
 */
/** @type {Record<number, { headline: string, intro: string, hero: { photo: string, alt: string, credit: string, focal?: string }, screens: Screen[] }>} */
const PHASES = {
  1: {
    headline: 'Vom Parkplatz direkt zum Build',
    intro:
      'Phase 1 legt das Fundament von SPEED CLUB: Konto, Garage, Fahrzeugprofil, strukturierte Modifikationen, der QR-Code fürs Auto und die öffentliche Fahrzeugseite. Die Bildschirme stehen hier in der Reihenfolge, in der ein Mitglied sie durchläuft, jeweils in allen drei Farbwelten.',
    hero: {
      photo: 'design/seed-photos/porsche-992-01.jpg',
      alt: 'Schwarzer Porsche 911 nachts am Straßenrand, das rote Lichtband leuchtet',
      credit: 'Startbild: Franco Debartolo',
    },
    screens: [
      {
        fs: 'FS-1',
        route: 'AUTH-02',
        nav: 'Willkommen',
        title: 'Willkommen',
        caption:
          'Der erste Eindruck der App: Nachtfoto, Logo und „Cars. People. Culture.“ Von hier geht es zu „Konto erstellen“, „Anmelden“ oder „Erst umsehen“, ganz ohne Konto.',
        sameInAllThemes: 'Der Willkommensbildschirm steht auf dem Foto und sieht deshalb in allen drei Farbwelten gleich aus.',
      },
      {
        fs: 'FS-4',
        route: 'GAR-01',
        nav: 'Garage',
        title: 'Garage',
        caption:
          'Alle eigenen Fahrzeuge, das Hauptfahrzeug zuerst. Jede Karte zeigt die wichtigsten Daten, wie vollständig der Build dokumentiert ist, und führt direkt zum QR-Code. Angefangene Fahrzeuge warten unter „Entwürfe“.',
      },
      {
        fs: 'FS-5',
        route: 'GAR-03-specs',
        nav: 'Fahrzeug hinzufügen',
        title: 'Fahrzeug hinzufügen · Technik',
        caption:
          'Schritt 2 von 4 fragt die Technik so ab, wie die Szene darüber spricht: Motorcode, Hubraum, Aufladung, Antrieb und Leistung in PS, kW oder hp. Leistung und Drehmoment tragen ihre Herkunft: „Werksangabe“, „Besitzerangabe“ oder „Gemessen“. „Entwurf speichern“ geht jederzeit.',
      },
      {
        fs: 'FS-6',
        route: 'GAR-10',
        nav: 'Modifikation',
        title: 'Modifikation · Räder & Reifen',
        caption:
          'Mods als Daten statt Freitext: Felge, Breite, ET, Lochkreis, Reifen, Einbau und Kosten, dazu der Status „Verbaut“, „Geplant“ oder „Entfernt“. Die Zeile oben zeigt live, wie die Mod später im Profil steht. Kosten sieht nur der Besitzer, bis er „Kosten öffentlich zeigen“ einschaltet.',
      },
      {
        fs: 'FS-3',
        route: 'VEH-01',
        nav: 'Fahrzeugprofil',
        title: 'Fahrzeugprofil',
        caption:
          'Der wichtigste Bildschirm: Galerie, Eckdaten auf einen Blick (Leistung, Drehmoment, Baujahr, Antrieb), der Besitzer mit „Folgen“ und „Nachricht“, darunter die Reiter „Übersicht“, „Technik“, „Mods“ und „Verlauf“.',
      },
      {
        fs: 'FS-9',
        route: 'QR-02',
        nav: 'QR-Code',
        title: 'QR-Code',
        caption:
          'Der Code, der das echte Auto mit seiner Seite verbindet. „Herunterladen“ liefert PNG, SVG oder einen PDF-Sticker; dazu „Teilen“, „Öffentliche Seite ansehen“, Hinweise zur Sticker-Platzierung und „QR-Code ersetzen“. Alte Sticker zeigen danach nur noch „nicht mehr gültig“. In dieser Vorschau steht unter dem Code eine Testadresse.',
      },
      {
        fs: 'FS-10',
        route: 'WEB-01',
        nav: 'Öffentliche Seite',
        title: 'Öffentliche Fahrzeugseite',
        caption:
          'Das sieht, wer den Sticker scannt: die Fahrzeugseite im Browser, ohne App und ohne Konto. Mit Eckdaten, Technik, allen Mods und dem Verlauf, dazu „In der App öffnen“ und „Registrieren“. Auf dem Handy und am Desktop.',
        firstScreen: true,
        desktop: true,
      },
      {
        fs: 'FS-8',
        route: 'PROF-01',
        nav: 'Profil',
        title: 'Profil',
        caption:
          'Das eigene Profil: Name, Ort, „Mitglied seit“, Zahlen zu Fahrzeugen, Followern und „Folge ich“, Bio und die Garage zum Durchwischen. Darunter „Meine QR-Codes“, „Einstellungen“ und „Fahrzeug hinzufügen“.',
      },
      {
        fs: 'SET-10',
        route: 'SET-10',
        nav: 'Erscheinungsbild',
        title: 'Erscheinungsbild',
        caption:
          'Drei Farbwelten: Carbon als Grundeinstellung, Schwarz für OLED-Displays, Hell für Tageslicht; „System“ folgt dem Gerät. Die Vorschaukarten zeigen die echten Farben, die Auswahl gilt sofort.',
      },
    ],
  },
  2: {
    headline: 'Aus der Garage in die Szene',
    intro:
      'Phase 2 macht aus der Garage eine Community: Start mit neuen Builds und Updates, Entdecken mit Filtern nach Marke, Modell und Mods, Nachrichten mit Anfragen, Einstellungen mit Datenexport und Kontolöschung, dazu Melden und Einspruch nach dem Digital Services Act. Die Bildschirme stehen in der Reihenfolge, in der ein Mitglied sie nutzt, jeweils in allen drei Farbwelten.',
    hero: {
      photo: 'design/seed-photos/nissan-r34-01.jpg',
      alt: 'Blauer Nissan Skyline GT-R R34 von hinten unter Gewitterwolken',
      credit: 'Startbild: Andrew Akabane',
    },
    screens: [
      {
        fs: 'FS-2',
        route: 'HOME-01',
        nav: 'Start',
        title: 'Start',
        caption:
          'Der Einstieg nach dem Öffnen: oben ein Featured Build, darunter neue Builds, Build-Updates, aktive Mitglieder und die beliebtesten Mods der Woche. „Folge ich“ zeigt nur die Mitglieder, denen man folgt. In der Vorschau mit Demo-Mitgliedern und echten Fahrzeugdaten.',
      },
      {
        fs: 'FS-11',
        route: 'DISC-01',
        nav: 'Entdecken',
        title: 'Entdecken',
        caption:
          'Die Suche nach Marke, Modell, Mods oder Mitgliedern, darunter die Marken mit der echten Zahl ihrer Builds, Kollektionen und beliebte Mods. Ein Tipp auf eine Marke führt direkt zu ihren Fahrzeugen.',
      },
      {
        fs: 'FS-11',
        route: 'DISC-02',
        nav: 'Ergebnisse',
        title: 'Entdecken · Ergebnisse',
        caption:
          'Fahrzeuge und Mitglieder getrennt, aktive Filter als Chips, die sich einzeln entfernen lassen, Sortierung und Liste oder Raster. Die Zahlen sind die echten Treffer der Suche, keine Platzhalter.',
      },
      {
        fs: 'FS-7',
        route: 'MSG-01',
        nav: 'Nachrichten',
        title: 'Nachrichten',
        caption:
          'Alle Unterhaltungen, ungelesene markiert. Wer noch nicht verbunden ist, landet unter „Anfragen“ und kann erst schreiben, wenn die Anfrage angenommen ist. Blockieren und Melden gibt es überall.',
      },
      {
        fs: 'FS-7',
        route: 'MSG-02',
        nav: 'Unterhaltung',
        title: 'Unterhaltung',
        caption:
          'Ein Gespräch mit Tagestrennern und Lesebestätigung; neue Nachrichten erscheinen ohne Neuladen. Fotos und Fahrzeuge lassen sich direkt teilen; Fotos sind privat und nur für die beiden Beteiligten abrufbar.',
      },
      {
        fs: 'PROF-02',
        route: 'PROF-02',
        nav: 'Mitglied',
        title: 'Profil eines Mitglieds',
        caption:
          'Das Profil eines anderen Mitglieds: Garage, Follower und „Folge ich“, dazu Folgen, Nachricht schreiben, Blockieren und Melden. Gesperrte und private Inhalte bleiben verborgen.',
      },
      {
        fs: 'FS-12',
        route: 'SET-01',
        nav: 'Einstellungen',
        title: 'Einstellungen',
        caption:
          'Konto, Sicherheit mit Zwei-Faktor-Schutz und angemeldeten Geräten, Privatsphäre, Mitteilungen, Sprache und Einheiten, Datenexport und Kontolöschung, Hilfe und Rechtliches, alles an einem Ort.',
      },
      {
        fs: 'SAFE-01',
        route: 'SAFE-01',
        nav: 'Entscheidung',
        title: 'Entscheidung und Einspruch',
        caption:
          'Wenn SPEED CLUB etwas entfernt oder einschränkt, steht hier, was betroffen ist, warum, auf welcher Grundlage und bis wann Einspruch möglich ist, so wie es der Digital Services Act verlangt.',
      },
    ],
  },
  3: {
    headline: 'Der Kontrollraum hinter SPEED CLUB',
    intro:
      'Phase 3 bringt das Admin-Portal: Mitglieder, Fahrzeuge, Moderation, Support, Inhalte, Konfiguration, Team und Datenschutz an einem Ort, mit Pflicht zur Zwei-Faktor-Anmeldung, Vier-Augen-Freigaben und einem lückenlosen Audit-Log. Dazu kommen die KI-Funktionen hinter Schaltern, die Absicherung der ganzen Plattform und das Paket für den Webspace. Die Bildschirme stehen in der Reihenfolge eines Arbeitstags im Team, jeweils in Carbon und Hell.',
    hero: {
      photo: 'design/seed-photos/nissan-r35-01.jpg',
      alt: 'Orangefarbener Nissan GT-R R35 von vorn in völliger Dunkelheit',
      credit: 'Startbild: Kyrell',
      focal: '50% 75%',
    },
    screens: [
      {
        fs: 'ADM-06',
        route: 'ADM-06',
        admin: true,
        nav: 'Dashboard',
        title: 'Dashboard',
        caption:
          'Der Einstieg nach der Anmeldung: offene Meldungen, Einsprüche, fällige Datenschutzanfragen und fehlgeschlagene Jobs als Warteschlangen, darunter die Kennzahlen der letzten 14 Tage. Alle Zahlen sind echte Werte, keine Platzhalter.',
      },
      {
        fs: 'ADM-09',
        route: 'ADM-09',
        admin: true,
        nav: 'Mitglieder',
        title: 'Mitglieder',
        caption:
          'Alle Mitglieder in einer Tabelle, die der Server sortiert, filtert und seitenweise lädt. Dazu gespeicherte Ansichten, wählbare Spalten und Sammelaktionen für mehrere Konten auf einmal.',
      },
      {
        fs: 'ADM-10',
        route: 'ADM-10',
        admin: true,
        nav: 'Mitglied',
        title: 'Mitgliedskonto',
        caption:
          'Ein Konto auf einen Blick: Fahrzeuge, Sicherheit und Sitzungen, Meldungen und rechts der Verlauf aus dem Audit-Log. Von hier aus lässt sich das Konto einschränken oder sperren oder ein Code zum Zurücksetzen des Passworts senden; Passwörter selbst sieht und setzt das Team nie.',
      },
      {
        fs: 'ADM-21',
        route: 'ADM-21',
        admin: true,
        nav: 'Moderation',
        title: 'Moderationsfall',
        caption:
          'Ein gemeldeter Inhalt mit Beweisen und Verlauf. Die Entscheidung entsteht aus Begründungsvorlagen; das Mitglied erhält sie mit Rechtsgrundlage und Einspruchsfrist, so wie es der Digital Services Act verlangt.',
      },
      {
        fs: 'ADM-26',
        route: 'ADM-26',
        admin: true,
        nav: 'Support',
        title: 'Support-Ticket',
        caption:
          'Ein Ticket mit dem ganzen Verlauf: Antworten aus Textbausteinen, interne Notizen, die das Mitglied nie sieht, dazu Status und Zuständigkeit.',
      },
      {
        fs: 'ADM-34',
        route: 'ADM-34',
        admin: true,
        nav: 'Vorschau',
        title: 'Entwurfsvorschau',
        caption:
          'Änderungen an Marke, Startseite und Ankündigungen entstehen zuerst als Entwurf. Die Vorschau zeigt App und Web wahlweise in Carbon, Schwarz oder Hell, bevor etwas live geht, und jede Veröffentlichung lässt sich zurückrollen.',
      },
      {
        fs: 'ADM-36',
        route: 'ADM-36',
        admin: true,
        nav: 'Schalter',
        title: 'Feature-Flags',
        caption:
          'Funktionen ein- und ausschalten, auch die KI-Funktionen. Kritische Schalter brauchen die Freigabe einer zweiten Person; jede Änderung steht mit Begründung im Audit-Log.',
      },
      {
        fs: 'ADM-43',
        route: 'ADM-43',
        admin: true,
        nav: 'Freigaben',
        title: 'Vier-Augen-Freigaben',
        caption:
          'Riskante Aktionen wie Kontolöschung, Datenexport oder neue Admin-Rechte warten hier, bis eine zweite berechtigte Person zustimmt. Eigene Anfragen kann niemand selbst freigeben.',
      },
      {
        fs: 'ADM-44',
        route: 'ADM-44',
        admin: true,
        nav: 'Audit-Log',
        title: 'Audit-Log',
        caption:
          'Jede Aktion des Teams mit Person, Zeit, Ziel und den Werten vorher und nachher. Die Einträge sind miteinander verkettet, so fällt jede nachträgliche Änderung bei der Prüfung auf.',
      },
      {
        fs: 'ADM-45',
        route: 'ADM-45',
        admin: true,
        nav: 'Datenschutz',
        title: 'DSGVO-Anfragen',
        caption:
          'Auskunft, Export, Löschung und Berichtigung mit der gesetzlichen Frist von einem Monat; was bald fällig ist, steht oben und auf dem Dashboard. Export und Löschung laufen über dieselben Abläufe wie in der App.',
      },
    ],
  },
};

const config = PHASES[phase];
if (!config) throw new Error(`No client preview defined for phase ${phase}`);

const tokens = JSON.parse(readFileSync(join(root, 'design', 'tokens', 'tokens.json'), 'utf8'));
const THEMES = /** @type {string[]} */ (tokens.themeOrder);
const carbon = tokens.themes.carbon.color;
const layout = tokens.layout;
const PHONE = { w: 390, h: 844 };
const DESKTOP = { w: 1280, h: 800 };
const ADMIN = { w: 1440, h: 900 };
/** The admin portal's themes (03_DESIGN_SYSTEM §14: Carbon by default, and Light), in token order. */
const ADMIN_THEMES = THEMES.filter((theme) => theme === 'carbon' || theme === 'light');
/**
 * The captures a screen shows, each as [viewport, themes]: phones (and the desktop if asked), or an admin page's desktop.
 * @param {Screen} screen @returns {Array<[{w:number,h:number}, string[]]>}
 */
const frames = (screen) =>
  screen.admin ? [[ADMIN, ADMIN_THEMES]] : [[PHONE, THEMES], ...(screen.desktop ? [/** @type {[{w:number,h:number}, string[]]} */ ([DESKTOP, THEMES])] : [])];
const version = JSON.parse(readFileSync(join(root, 'mobile', 'version.json'), 'utf8'));

/** @param {string} route @param {{w:number,h:number}} vp @param {string} theme */
const shotPath = (route, vp, theme) => join(src, `${route}__${vp.w}x${vp.h}__${theme}__de.png`);

/**
 * A capture as WebP. The capture's scale (device pixels per CSS pixel) is its width over the viewport width; the returned
 * width and height are CSS pixels, so the page lays it out at its real size and a 2x capture stays sharp on Retina.
 * @param {Buffer} input
 * @param {{ cssWidth?: number, firstScreenHeight?: number, width?: number, quality?: number, lossless?: boolean }} [opts]
 */
async function webp(input, { cssWidth, firstScreenHeight, width, quality = 78, lossless = false } = {}) {
  let image = sharp(input);
  const meta = await image.metadata();
  const scale = cssWidth ? Math.max(1, Math.round((meta.width ?? cssWidth) / cssWidth)) : 1;
  if (firstScreenHeight) {
    image = image.extract({ left: 0, top: 0, width: meta.width ?? 0, height: Math.min(meta.height ?? 0, firstScreenHeight * scale) });
  }
  if (width) image = image.resize({ width, withoutEnlargement: true });
  const buffer = await image.webp(lossless ? { lossless: true, effort: 6 } : { quality, effort: 5 }).toBuffer();
  const info = await sharp(buffer).metadata();
  return {
    uri: `data:image/webp;base64,${buffer.toString('base64')}`,
    width: Math.round((info.width ?? 0) / scale),
    height: Math.round((info.height ?? 0) / scale),
    bytes: buffer.length,
  };
}

/** Whether the captures show the same pixels. */
async function identical(/** @type {string[]} */ files) {
  const raws = await Promise.all(files.map((f) => sharp(readFileSync(f)).raw().toBuffer()));
  return raws.every((r) => r.equals(/** @type {Buffer} */ (raws[0])));
}

/** @param {string} file a face of the 2.0 font build (design/fonts/web) */
const font = (file) => `data:font/woff2;base64,${readFileSync(join(root, 'design', 'fonts', 'web', file)).toString('base64')}`;

const escapeHtml = (/** @type {string} */ s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Visible text: escaped, and "QR-Code" never breaks after its hyphen (U+2060 word joiner, as in the app). */
const text = (/** @type {string} */ s) => escapeHtml(s).replace(/\bQR-/g, 'QR-⁠');
const number = (/** @type {number} */ n) => new Intl.NumberFormat('de-DE').format(n);

const missing = config.screens.flatMap((screen) =>
  frames(screen).flatMap(([vp, themes]) => themes.map((theme) => shotPath(screen.route, vp, theme)).filter((file) => !existsSync(file))),
);
if (missing.length > 0) {
  console.error(`Missing screenshots (run the visual matrix first, see the header of this script):\n${missing.join('\n')}`);
  process.exit(1);
}
// A picture of a failed capture is never shown to a client, whatever the file on disk looks like. The runner writes one audit file
// per cell next to its picture.
const failedShots = config.screens.flatMap((screen) =>
  frames(screen).flatMap(([vp, themes]) =>
    themes.map((theme) => shotPath(screen.route, vp, theme)).filter((file) => {
      const audit = file.replace(/\.png$/, '.audit.json');
      return existsSync(audit) && JSON.parse(readFileSync(audit, 'utf8')).failed === true;
    }),
  ),
);
if (failedShots.length > 0) {
  console.error(`These captures failed (run them again):\n${failedShots.join('\n')}`);
  process.exit(1);
}

// What the gate checked, only from its own run: the phase tier of this phase over every registered route of the phase, failing
// on Medium (the Definition of Done allows no open High or Medium) and passed. A module, partial or failed run would misstate it.
// Every count comes from the shots of that run: routes, captures, and the widths, themes and languages in their cell names.
let checked = '';
if (existsSync(summaryPath)) {
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const phaseRoutes = new Set(
    // The phase tier covers phases 1..N (M2.8), so the gate's run holds every registered route up to this phase.
    ROUTES.filter((/** @type {{phase:number,status?:string}} */ r) => r.phase <= phase && r.status !== 'planned').map((/** @type {{id:string}} */ r) => r.id),
  );
  const runRoutes = new Set(Array.isArray(summary.routes) ? summary.routes : []);
  const shots = Array.isArray(summary.shots) ? summary.shots.filter((/** @type {{failed:boolean}} */ s) => s.failed === false) : [];
  const fullRun =
    summary.tier === 'phase' &&
    Number(summary.phase) === phase &&
    summary.failOn === 'medium' &&
    summary.passed === true &&
    Number(summary.totals?.failed) === 0 &&
    Number(summary.totals?.high) === 0 &&
    Number(summary.totals?.medium) === 0 &&
    Number.isInteger(summary.totals?.captured) &&
    summary.totals.captured === shots.length &&
    runRoutes.size === phaseRoutes.size &&
    [...phaseRoutes].every((id) => runRoutes.has(id));
  if (fullRun) {
    const parts = shots.map((/** @type {{name:string}} */ s) => s.name.split('__'));
    const distinct = (/** @type {number} */ i) => new Set(parts.map((p) => p[i])).size;
    /** @type {[number, string, string][]} count, singular, plural */
    const items = [
      [runRoutes.size, 'Bildschirm', 'Bildschirme'],
      [shots.length, 'Aufnahme', 'Aufnahmen'],
      [new Set(parts.map((p) => String(p[1]).split('x')[0])).size, 'Breite', 'Breiten'],
      [distinct(2), 'Farbwelt', 'Farbwelten'],
      [distinct(3), 'Sprache', 'Sprachen'],
    ];
    checked = `<div class="checked"><p class="checked-label">Automatisch geprüft</p><p class="checked-items">${items
      .map(([n, one, many]) => `<span class="keep"><b>${number(n)}</b> ${n === 1 ? one : many}</span>`)
      .join('<span class="sep" aria-hidden="true"> · </span>')}</p></div>`;
  }
}

const commit = execFileSync('git', ['-c', `safe.directory=${root}`, '-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
/** The first capture a screen shows, in Carbon. @param {Screen} s */
const firstShot = (s) => shotPath(s.route, /** @type {[{w:number,h:number}, string[]]} */ (frames(s)[0])[0], 'carbon');
const capturedAt = new Date(Math.max(...config.screens.map((s) => statSync(firstShot(s)).mtimeMs)));
const dateDe = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }).format(capturedAt);
const themeLabel = (/** @type {string} */ theme) => tokens.themes[theme].label.de;
const routePath = (/** @type {string} */ id) => ROUTES.find((/** @type {{id:string}} */ r) => r.id === id)?.path ?? '';

const heroPhoto = await webp(readFileSync(join(root, config.hero.photo)), { width: 1200, quality: 74 });
const logo = await webp(readFileSync(join(root, 'design', 'brand', 'logo-wide-white.png')), { width: 720, lossless: true });

let imageBytes = heroPhoto.bytes + logo.bytes;
const sections = [];
for (const [index, screen] of config.screens.entries()) {
  const step = String(index + 1).padStart(2, '0');
  const files = THEMES.map((theme) => shotPath(screen.route, PHONE, theme));
  const single = !screen.admin && Boolean(screen.sameInAllThemes) && (await identical(files));
  const phones = [];
  for (const [i, theme] of (screen.admin ? [] : THEMES).entries()) {
    if (single && i > 0) break;
    const image = await webp(readFileSync(/** @type {string} */ (files[i])), {
      cssWidth: PHONE.w,
      firstScreenHeight: screen.firstScreen ? PHONE.h : undefined,
    });
    imageBytes += image.bytes;
    const label = single ? `${screen.title}, alle drei Farbwelten` : `${screen.title}, ${themeLabel(theme)}`;
    phones.push(`<figure class="shot">
          <button type="button" class="phone" data-full="${index}-${theme}" aria-label="${escapeHtml(label)}: ganzen Bildschirm ansehen">
            <img src="${image.uri}" alt="${escapeHtml(label)}" width="${image.width}" height="${image.height}" decoding="async" id="img-${index}-${theme}">
          </button>
          <figcaption>${single ? 'Carbon, Schwarz (OLED) und Hell' : text(themeLabel(theme))}</figcaption>
        </figure>`);
  }
  if (single) phones.push(`<p class="single-note">${text(/** @type {string} */ (screen.sameInAllThemes))}</p>`);
  let desktop = '';
  if (screen.desktop || screen.admin) {
    const [vp, themes] = screen.admin ? [ADMIN, ADMIN_THEMES] : [DESKTOP, THEMES];
    const tabs = [];
    const panes = [];
    for (const [i, theme] of themes.entries()) {
      const image = await webp(readFileSync(shotPath(screen.route, vp, theme)), { cssWidth: vp.w, quality: 72 });
      imageBytes += image.bytes;
      const id = `d-${index}-${theme}`;
      const label = `${screen.title} am Desktop, ${themeLabel(theme)}`;
      tabs.push(
        `<input type="radio" name="desk-${index}" id="${id}"${i === 0 ? ' checked' : ''}><label for="${id}">${text(themeLabel(theme))}</label>`,
      );
      panes.push(`<button type="button" class="browser" style="aspect-ratio: ${vp.w} / ${vp.h + 32}" data-full="${id}" aria-label="${escapeHtml(label)}: ganze Seite ansehen">
            <span class="bar" aria-hidden="true">${escapeHtml(routePath(screen.route))}</span>
            <img src="${image.uri}" alt="${escapeHtml(label)}" width="${image.width}" height="${image.height}" decoding="async" id="img-${id}">
          </button>`);
    }
    desktop = `<div class="desktop${screen.admin ? ' admin' : ''}">
        <p class="eyebrow">${screen.admin ? 'Admin-Portal' : 'Desktop'} · ${vp.w} × ${vp.h} px</p>
        <div class="tabs" role="radiogroup" aria-label="Farbwelt am Desktop">${tabs.join('')}</div>
        <div class="panes">${panes.join('')}</div>
      </div>`;
  }
  sections.push(`<section class="screen" id="${screen.route.toLowerCase()}" data-fs="${escapeHtml(screen.fs)}" data-route="${escapeHtml(screen.route)}" aria-labelledby="h-${index}">
      <header class="screen-head">
        <p class="eyebrow"><span class="step">${step}</span> / ${String(config.screens.length).padStart(2, '0')}</p>
        <h2 id="h-${index}">${text(screen.title)}</h2>
        <p class="caption">${text(screen.caption)}</p>
      </header>
      ${phones.length > 0 ? `<div class="phones${single ? ' single' : ''}">${phones.join('')}</div>` : ''}
      ${desktop}
    </section>`);
}

const nav = config.screens.map((s) => `<a href="#${s.route.toLowerCase()}">${text(s.nav)}</a>`).join('');
const exampleIndex = Math.max(0, config.screens.findIndex((s) => s.fs === 'FS-3'));
const example = `„${String(exampleIndex + 1).padStart(2, '0')}“ (${text(config.screens[exampleIndex]?.title ?? '')})`;

const html = `<!doctype html>
<!-- SPEED CLUB client preview, phase ${phase}, built by scripts/dev/build-client-preview.mjs at commit ${commit} -->
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex, nofollow">
<meta name="generator" content="scripts/dev/build-client-preview.mjs, commit ${commit}">
<title>SPEED CLUB · Phase ${phase} · Vorschau</title>
<style>
@font-face { font-family: 'Inter'; font-weight: 400; font-display: swap; src: url(${font('Inter-Regular.woff2')}) format('woff2'); }
@font-face { font-family: 'Inter'; font-weight: 600; font-display: swap; src: url(${font('Inter-SemiBold.woff2')}) format('woff2'); }
@font-face { font-family: 'Archivo SemiExpanded'; font-weight: 600; font-display: swap; src: url(${font('ArchivoSemiExpanded-SemiBold.woff2')}) format('woff2'); }
:root {
  --canvas: ${carbon['bg.canvas']}; --surface: ${carbon['bg.surface']}; --raised: ${carbon['bg.raised']}; --overlay: ${carbon['bg.overlay']};
  --border: ${carbon['border.subtle']}; --border-strong: ${carbon['border.default']};
  --ink: ${carbon['text.primary']}; --ink-2: ${carbon['text.secondary']}; --ink-3: ${carbon['text.tertiary']};
  --focus: ${carbon['focus.ring']}; --scrim: ${carbon['overlay.photoScrimEnd']}; --photo-ground: ${carbon['media.ground']};
  --ui: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
  --display: ${tokens.font.marque.css};
  --gutter: ${layout.gutter.phone}px;
  --content: ${layout.contentMax}px;
  color-scheme: dark;
}
@media (min-width: ${layout.phoneLargeMinWidth}px) { :root { --gutter: ${layout.gutter.phoneLarge}px; } }
@media (min-width: ${layout.breakpoints.tablet}px) { :root { --gutter: ${layout.gutter.tablet}px; } }
* { box-sizing: border-box; }
html { background: var(--canvas); }
html:has(dialog[open]) { overflow: hidden; }
body { margin: 0; background: var(--canvas); color: var(--ink); font: 400 1rem/1.5rem var(--ui); -webkit-font-smoothing: antialiased; }
a { color: inherit; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.wrap { max-width: calc(var(--content) + 2 * var(--gutter)); margin: 0 auto; padding-left: var(--gutter); padding-right: var(--gutter); }
.eyebrow { margin: 0 0 8px; font: 600 .75rem/1rem var(--ui); letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
h1, h2 { font-family: var(--display); font-weight: 600; letter-spacing: -.01em; margin: 0; text-wrap: balance; overflow-wrap: break-word; }
h1, h2, .lead, .caption, .single-note, footer p { hyphens: auto; -webkit-hyphens: auto; hyphenate-limit-chars: 10 4 4; }
.keep { white-space: nowrap; }

/* Hero: a night photo with the client's logo, the one brand moment of the page. */
.hero { padding-bottom: 40px; border-bottom: 1px solid var(--border); }
.hero-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 32px; }
.hero-photo { position: relative; margin: 0 calc(-1 * var(--gutter)); height: min(125vw, 72vh); overflow: hidden; background: var(--photo-ground); }
.hero-photo .photo { display: block; width: 100%; height: 100%; object-fit: cover; object-position: ${config.hero.focal ?? '50% 56%'}; }
.hero-photo::after { content: ''; position: absolute; inset: 0; background: linear-gradient(to top, var(--scrim), transparent 55%); }
.hero-photo .logo { position: absolute; z-index: 1; left: 50%; bottom: 32px; width: min(64%, 320px); height: auto; transform: translateX(-50%); }
h1 { font-size: clamp(2rem, 4vw + 1rem, 4rem); line-height: 1; }
.lead { max-width: 60ch; margin: 20px 0 0; font-size: 1.125rem; line-height: 1.75rem; color: var(--ink-2); }
.checked { margin: 24px 0 0; }
.checked p { margin: 0; }
.checked-label { font: 600 .75rem/1rem var(--ui); letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
.checked-items { margin-top: 8px !important; font-size: .875rem; line-height: 1.25rem; color: var(--ink-2); }
.checked b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.sep { color: var(--ink-3); }
.meta { margin: 20px 0 0; font-size: .875rem; line-height: 1.25rem; color: var(--ink-3); }
@media (min-width: 1024px) {
  .hero { padding-top: 48px; padding-bottom: 48px; }
  .hero-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 48px; align-items: center; }
  .hero-photo { order: 2; margin: 0; height: auto; width: 100%; aspect-ratio: 4 / 5; max-width: max(400px, calc((100vh - 168px) * .8)); justify-self: end; border-radius: 12px; }
}

nav { position: sticky; top: 0; z-index: 2; background: var(--canvas); border-bottom: 1px solid var(--border); }
nav .wrap { display: flex; gap: 8px; overflow-x: auto; padding-top: 12px; padding-bottom: 12px; scrollbar-width: none; }
nav .wrap::-webkit-scrollbar { display: none; }
nav a { flex: none; display: inline-flex; align-items: center; min-height: 36px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border-strong); font: 600 .875rem/1.25rem var(--ui); text-decoration: none; color: var(--ink-2); }
nav a:hover { color: var(--ink); border-color: var(--ink-3); }
nav a[aria-current] { background: var(--ink); color: var(--canvas); border-color: var(--ink); }

.screen { padding: 64px 0; border-bottom: 1px solid var(--border); scroll-margin-top: 64px; }
.screen-head { max-width: 680px; margin-bottom: 32px; }
.step { color: var(--ink); font-variant-numeric: tabular-nums; }
h2 { font-size: clamp(1.75rem, 2.5vw + 1rem, 2.75rem); line-height: 1.05; }
.caption { margin: 12px 0 0; color: var(--ink-2); }
.phones { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
.single-note { grid-column: 2 / span 2; align-self: start; max-width: 40ch; margin: 0; color: var(--ink-2); }
@media (max-width: ${layout.breakpoints.tablet - 1}px) {
  .phones { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scroll-padding-left: var(--gutter); gap: 16px; margin: 0 calc(-1 * var(--gutter)); padding: 0 var(--gutter) 8px; scrollbar-width: none; }
  .phones::-webkit-scrollbar { display: none; }
  .phones .shot { flex: 0 0 80%; scroll-snap-align: start; }
  .phones.single { display: block; margin: 0; padding: 0; }
  .phones.single .shot { width: 80%; }
  .single-note { margin-top: 16px; }
}
.shot { margin: 0; }
.phone, .browser { display: block; width: 100%; padding: 0; border: 1px solid var(--border-strong); border-radius: 12px; background: var(--surface); cursor: zoom-in; overflow: hidden; color: inherit; font: inherit; }
.phone { aspect-ratio: ${PHONE.w} / ${PHONE.h}; }
.phone img, .browser img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
.shot figcaption { margin-top: 12px; font-size: .875rem; line-height: 1.25rem; color: var(--ink-3); }
.desktop { margin-top: 48px; }
.desktop.admin { margin-top: 0; }
.tabs { display: inline-flex; flex-wrap: wrap; max-width: 100%; padding: 2px; margin-bottom: 16px; border-radius: 8px; background: var(--raised); }
.tabs input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.tabs label { display: inline-flex; align-items: center; min-height: 32px; padding: 0 12px; border-radius: 8px; font: 600 .875rem/1.25rem var(--ui); color: var(--ink-2); cursor: pointer; }
.tabs input:checked + label { background: var(--overlay); color: var(--ink); }
.tabs input:focus-visible + label { outline: 2px solid var(--focus); outline-offset: 2px; }
.browser { aspect-ratio: ${DESKTOP.w} / ${DESKTOP.h + 32}; display: none; }
.browser .bar { display: flex; align-items: center; height: 32px; padding: 0 12px; background: var(--raised); border-bottom: 1px solid var(--border); font-size: .75rem; line-height: 1rem; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.browser img { height: calc(100% - 32px); }
${THEMES.map((_, i) => `.desktop:has(.tabs input:nth-of-type(${i + 1}):checked) .browser:nth-of-type(${i + 1})`).join(',\n')} { display: block; }

footer { padding: 48px 0 64px; font-size: .875rem; line-height: 1.25rem; color: var(--ink-3); }
footer p { max-width: 72ch; margin: 0 0 8px; }

dialog { padding: 0; border: 0; background: transparent; max-width: 100vw; max-height: 100vh; width: 100%; height: 100%; margin: 0; }
dialog::backdrop { background: var(--photo-ground); }
dialog .frame { height: 100%; overflow: auto; overscroll-behavior: contain; display: flex; justify-content: center; padding: 64px var(--gutter) 32px; }
dialog img { display: block; height: auto; width: 100%; max-width: min(100%, var(--w)); align-self: flex-start; border-radius: 12px; }
dialog .close { position: fixed; top: 16px; right: 16px; min-width: 44px; min-height: 44px; padding: 0 16px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--ink); font: 600 .875rem/1.25rem var(--ui); cursor: pointer; }
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
</style>
</head>
<body>
<header class="hero">
  <div class="wrap hero-grid">
    <figure class="hero-photo">
      <img class="photo" src="${heroPhoto.uri}" alt="${escapeHtml(config.hero.alt)}" width="${heroPhoto.width}" height="${heroPhoto.height}" fetchpriority="high" decoding="sync">
      <img class="logo" src="${logo.uri}" alt="SPEED CLUB" width="${logo.width}" height="${logo.height}">
    </figure>
    <div class="hero-text">
      <p class="eyebrow">Phase ${phase} · Vorschau</p>
      <h1>${text(config.headline)}</h1>
      <p class="lead">${text(config.intro)}</p>
      ${checked}
      <p class="meta">Stand ${escapeHtml(dateDe)} · App-Version ${escapeHtml(String(version.versionName))} · Demodaten</p>
    </div>
  </div>
</header>
<nav aria-label="Bildschirme"><div class="wrap">${nav}</div></nav>
<main class="wrap">
${sections.join('\n')}
</main>
<footer class="wrap">
  <p>${
    config.screens.every((s) => s.admin)
      ? `Aufnahmen aus der automatischen Prüfung von Phase ${phase}, Admin-Portal auf Deutsch am Desktop mit ${ADMIN.w} × ${ADMIN.h} px; geprüft wird das Portal außerdem mit ${DESKTOP.w} px Breite, auf Englisch und mit 200 % Zoom. Ein Klick auf eine Aufnahme zeigt die ganze Seite.`
      : `Aufnahmen aus der automatischen Prüfung von Phase ${phase}, Web-Version der App auf Deutsch: Handy ${PHONE.w} × ${PHONE.h} px, Desktop ${DESKTOP.w} × ${DESKTOP.h} px. Die Android-App nutzt denselben Code. Ein Klick auf eine Aufnahme zeigt den ganzen Bildschirm.`
  }</p>
  <p>Alle Personen, Fahrzeuge und Zahlen sind Demodaten. Fotos unter Unsplash-Lizenz, ${escapeHtml(config.hero.credit)}.</p>
  <p>Rückmeldungen am einfachsten mit der Nummer aus der Kopfzeile, zum Beispiel ${example}.</p>
</footer>
<dialog id="viewer" aria-label="Ganzer Bildschirm">
  <button type="button" class="close" autofocus>Schließen</button>
  <div class="frame"><img alt=""></div>
</dialog>
<script>
(() => {
  const viewer = document.getElementById('viewer');
  const big = viewer.querySelector('img');
  let opener = null;
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-full]');
    if (!trigger) return;
    const img = document.getElementById('img-' + trigger.dataset.full);
    big.src = img.src;
    big.alt = img.alt;
    big.style.setProperty('--w', img.getAttribute('width') + 'px');
    opener = trigger;
    viewer.showModal();
    viewer.querySelector('.frame').scrollTop = 0;
  });
  viewer.querySelector('.close').addEventListener('click', () => viewer.close());
  viewer.addEventListener('click', (event) => { if (event.target === viewer || event.target.classList.contains('frame')) viewer.close(); });
  viewer.addEventListener('close', () => { if (opener) opener.focus(); });

  // The chip of the section under the bar is current, and scrolled into the bar when the chips do not all fit.
  const bar = document.querySelector('nav .wrap');
  const chips = new Map([...bar.querySelectorAll('a')].map((a) => [a.hash.slice(1), a]));
  const sections = [...document.querySelectorAll('.screen')];
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const inBand = new Set();
  let current = null;
  const mark = (chip) => {
    if (chip === current) return;
    if (current) current.removeAttribute('aria-current');
    current = chip;
    if (!chip) return;
    chip.setAttribute('aria-current', 'true');
    const c = chip.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    if (c.left < b.left + 16 || c.right > b.right - 16) bar.scrollBy({ left: c.left - b.left - 16, behavior: smooth ? 'smooth' : 'auto' });
  };
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) entry.isIntersecting ? inBand.add(entry.target) : inBand.delete(entry.target);
    const section = sections.find((s) => inBand.has(s));
    mark(section ? chips.get(section.id) ?? null : null);
  }, { rootMargin: '-72px 0px -55% 0px' });
  sections.forEach((s) => observer.observe(s));
})();
</script>
</body>
</html>
`;

mkdirSync(out, { recursive: true });
const file = join(out, 'index.html');
writeFileSync(file, html);
const scales = new Set(
  await Promise.all(
    config.screens.map(async (s) => {
      const vp = /** @type {[{w:number,h:number}, string[]]} */ (frames(s)[0])[0];
      return Math.round(((await sharp(firstShot(s)).metadata()).width ?? vp.w) / vp.w);
    }),
  ),
);
console.log(
  `${file}: ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MB (images ${(imageBytes / 1024 / 1024).toFixed(1)} MB), ${config.screens.length} screens x ${config.screens.every((x) => x.admin) ? ADMIN_THEMES.length : THEMES.length} themes, capture scale ${[...scales].join('/')}x, ${checked ? 'checked line from the phase run' : 'no passed phase-tier summary: checked line left out'}`,
);
