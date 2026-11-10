/** ADM-07 results, produced by App\Http\Controllers\Admin\Support\SearchData. */
export type SearchGroupKey = 'members' | 'vehicles' | 'qr' | 'cases';

export interface SearchItem {
    id: string;
    title: string;
    subtitle: string | null;
    url: string | null;
}

export interface SearchGroup {
    group: SearchGroupKey;
    items: SearchItem[];
}
