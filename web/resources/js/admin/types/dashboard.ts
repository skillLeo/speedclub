/** ADM-06 props, produced by App\Http\Controllers\Admin\Support\DashboardData. */
export interface QueueValue {
    count: number | null;
    status?: 'ok' | 'warning' | 'danger';
    since?: string | null;
}

/** One of the six tiles of 09 §10.2 (Kpi::tiles). `minutes`: a duration; `percent`: a share 0–1. Null: no data, never a guess. */
export interface Kpi {
    key: string;
    unit: 'count' | 'minutes' | 'percent';
    value: number | null;
    previous: number | null;
    series: (number | null)[];
}

export interface DashboardCharts {
    registrations: { date: string; value: number }[];
    qr_funnel: { date: string; scans: number; registrations: number }[];
    top_makes: { label: string; value: number }[];
}

export interface DsaFigure {
    average: number | null;
    months: { month: string; value: number }[];
}
