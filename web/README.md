# SPEED CLUB — platform backend and admin portal

Laravel 13 application that serves the REST API for the member app, the public SEO pages (build pages, profiles, QR landing pages), the member web app at `/app` (an export of `../mobile`) and the admin portal at `/admin` (Inertia + Vue 3).

## Structure

| Path | Contents |
|---|---|
| `routes/api/v1/*.php` | Versioned REST API, one file per domain (auth, garage, discover, messages, settings, safety …) |
| `routes/admin/*.php` | Admin portal routes, one file per module |
| `app/Http/Controllers` | Thin controllers; validation in FormRequests, authorisation in Policies, logic in `app/Actions` |
| `app/Services` | Domain services: media pipeline, search projection, home ranking, moderation, approvals, audit, AI gateway |
| `resources/views/public` | Blade public pages |
| `resources/js/admin` | Admin portal: pages, Reka UI based component kit, data tables, record layouts |
| `database/` | Migrations, factories, seeders and seed data (catalogue, legal drafts, help articles) |
| `tests/` | Pest feature and unit tests; `tests/e2e` holds the Playwright suites, the visual regression matrix and the DOM audit |

## Local setup

```bash
composer install
cp .env.example .env          # set DB_* for your local MySQL / MariaDB
php artisan key:generate
php artisan migrate --seed
npm install && npm run build
php artisan serve
```

## Checks

```bash
composer verify               # Pint, PHPStan (level 8), Pest, composer audit
npm run verify                # vue-tsc, ESLint, Vite build
npm run e2e                   # Playwright (needs the app running and the member web exported to public/app)
php artisan speedclub:doctor  # environment check for a host
```

Deployment to shared hosting is described in `../docs/DEPLOY.md`.
