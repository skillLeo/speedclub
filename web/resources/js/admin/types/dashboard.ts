/** ADM-06 props, produced by App\Http\Controllers\Admin\Support\DashboardData. */
export interface QueueValue {
    count: number | null;
    status?: 'ok' | 'warning' | 'danger';
    since?: string | null;
}

export interface Kpi {
    key: string;
    value: number;
    previous: number | null;
    series: number[];
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
