/**
 * M5.6 post-event gallery (10 §4; server contract docs/reports/phase-5/m5.6-contract.md §4), behind the flag `events.gallery` (off by
 * default). EVT-02 shows the approved photos and "Fotos hinzufügen"; EVT-06 lists the photos waiting for the organiser's approval.
 * An attendee's photo is `pending` until the organiser approves it; the organiser's own photos publish directly. Every upload passes
 * the M5.9a plate blur step first (the blurred derivative is the only public source, ADR-509).
 *
 * Typed by the generated schema (EventPhotoResource, EventResource.gallery) and called through the typed client.
 */
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';

import { api, apiData, ApiError } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import { EVENTS_FLAG, EVENTS_GALLERY_FLAG, eventKeys, type EventDetail } from '@/api/queries/events';
import { retryUnlessAnswered } from '@/api/queries/vehicles';
import type { components, operations } from '@/api/schema';

/** EventPhotoResource (contract §4.3). `status` other than approved and `reject_reason` reach only the organiser and the uploader. */
export type EventPhoto = components['schemas']['EventPhotoResource'];
export type EventPhotoStatus = EventPhoto['status'];

/** EventResource.gallery (contract §4.2); absent while the flag is off. */
export type EventGalleryInfo = NonNullable<EventDetail['gallery']>;

/** The list a gallery read asks for: the approved photos (everybody), the organiser's queue, or the viewer's own uploads. */
export type GalleryStatus = NonNullable<NonNullable<operations['v1.events.gallery.index']['parameters']['query']>['status']>;

/** Contract §4.4 errors the screens word. */
export const GALLERY_CLOSED = 'gallery_closed';
export const GALLERY_NOT_ATTENDEE = 'gallery_not_attendee';
export const PHOTO_ALREADY_REVIEWED = 'photo_already_reviewed';
/** Photos one attendee may add (contract §4.4 `gallery_limits`): the picker offers at most this many at once. */
export const GALLERY_PICK_MAX = 10;
export const GALLERY_PAGE_SIZE = 30;
export const GALLERY_PREVIEW = 6;

type Page<T> = { data: T[]; meta: { next_cursor: string | null } };

/** The detail's `gallery`, or null while the flag is off (the key is then absent). */
export function galleryOf(event: Pick<EventDetail, 'gallery'>): EventGalleryInfo | null {
  return event.gallery ?? null;
}

/** `can.add_photos` (contract §4.2): the organiser, going or checked-in members, while the window is open (absent with the flag off). */
export function canAddPhotos(event: Pick<EventDetail, 'can'>): boolean {
  return event.can.add_photos === true;
}

/** `can.moderate_photos`: the organiser. */
export function canModeratePhotos(event: Pick<EventDetail, 'can'>): boolean {
  return event.can.moderate_photos === true;
}

export const galleryKeys = {
  all: (slug: string) => ['events', 'gallery', slug] as const,
  list: (slug: string, status: GalleryStatus) => ['events', 'gallery', slug, status] as const,
};

export const galleryApi = {
  async list(slug: string, status: GalleryStatus, cursor: string | null, signal?: AbortSignal): Promise<Page<EventPhoto>> {
    return apiData(
      api.GET('/events/{slug}/gallery', {
        params: { path: { slug }, query: { status, per_page: GALLERY_PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
        signal,
      }),
    );
  },
  async upload(slug: string, form: FormData, idempotencyKey: string): Promise<EventPhoto> {
    const answer = await apiData(
      api.POST('/events/{slug}/gallery', {
        params: { path: { slug } },
        // The generated type describes the multipart fields; the serializer hands the FormData on as is (as the cover upload).
        body: form as unknown as components['schemas']['StoreEventPhotoRequest'],
        bodySerializer: (body) => body as unknown as FormData,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    );
    return answer.data;
  },
  async review(slug: string, id: string, decision: 'approve' | 'reject', reason?: string): Promise<EventPhoto> {
    const params = { path: { slug, photo: id } };
    const answer =
      decision === 'approve'
        ? await apiData(api.POST('/events/{slug}/gallery/{photo}/approve', { params }))
        : await apiData(api.POST('/events/{slug}/gallery/{photo}/reject', { params, body: reason ? { reason } : {} }));
    return answer.data;
  },
  async remove(slug: string, id: string): Promise<void> {
    await apiData(api.DELETE('/events/{slug}/gallery/{photo}', { params: { path: { slug, photo: id } } }));
  },
};

function useGalleryOn(): boolean {
  const events = useFlag(EVENTS_FLAG);
  const gallery = useFlag(EVENTS_GALLERY_FLAG);
  return events && gallery;
}

/** Whether the gallery exists for this reader: both flags on (the detail field says the rest). */
export function useGalleryEnabled(): boolean {
  return useGalleryOn();
}

/** One list of the gallery, by the contract's cursor. */
export function useEventGallery(slug: string, status: GalleryStatus, enabled: boolean = true) {
  const on = useGalleryOn();
  return useInfiniteQuery({
    queryKey: galleryKeys.list(slug, status),
    queryFn: ({ pageParam, signal }) => galleryApi.list(slug, status, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.meta.next_cursor ?? undefined,
    enabled: on && enabled && slug !== '',
    retry: retryUnlessAnswered,
  });
}

/** Every photo of an infinite gallery list, de-duplicated by id. */
export function flattenPhotos(pages: readonly Page<EventPhoto>[] | undefined): EventPhoto[] {
  const seen = new Set<string>();
  const rows: EventPhoto[] = [];
  for (const page of pages ?? []) {
    for (const photo of page.data) {
      if (seen.has(photo.id)) continue;
      seen.add(photo.id);
      rows.push(photo);
    }
  }
  return rows;
}

/** A photo out of every cached copy of one gallery list (approve, reject, delete). */
function dropPhoto(data: InfiniteData<Page<EventPhoto>> | undefined, id: string) {
  if (!data) return data;
  return { ...data, pages: data.pages.map((page) => ({ ...page, data: page.data.filter((photo) => photo.id !== id) })) };
}

/** Whatever a gallery change touches: the lists and the detail's counts and preview. */
function refresh(client: ReturnType<typeof useQueryClient>, slug: string): void {
  void client.invalidateQueries({ queryKey: galleryKeys.all(slug) });
  void client.invalidateQueries({ queryKey: eventKeys.detail(slug) });
}

/** "Fotos hinzufügen": one photo per call, each with its own Idempotency-Key and plate blur choice. */
export function useUploadEventPhoto(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ form, idempotencyKey }: { form: FormData; idempotencyKey: string }) => galleryApi.upload(slug, form, idempotencyKey),
    onSettled: () => refresh(client, slug),
  });
}

/** EVT-06 "Freigeben" / "Ablehnen": the photo leaves the queue at once and comes back when the call fails. */
export function useReviewEventPhoto(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, reason }: { id: string; decision: 'approve' | 'reject'; reason?: string }) =>
      galleryApi.review(slug, id, decision, reason),
    onMutate: async ({ id }) => {
      const key = galleryKeys.list(slug, 'pending');
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<InfiniteData<Page<EventPhoto>>>(key);
      client.setQueryData<InfiniteData<Page<EventPhoto>>>(key, (data) => dropPhoto(data, id));
      return { before };
    },
    onError: (_error, _variables, context) => {
      if (context?.before) client.setQueryData(galleryKeys.list(slug, 'pending'), context.before);
    },
    onSettled: () => refresh(client, slug),
  });
}

/** The uploader's own photo, or the organiser taking any photo down. */
export function useDeleteEventPhoto(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => galleryApi.remove(slug, id),
    onSuccess: (_answer, id) => {
      for (const status of ['approved', 'pending', 'mine'] as const)
        client.setQueryData<InfiniteData<Page<EventPhoto>>>(galleryKeys.list(slug, status), (data) => dropPhoto(data, id));
    },
    onSettled: () => refresh(client, slug),
  });
}

/** Whether a refused upload was the window or the right to add (the section then explains instead of a toast). */
export function isGalleryRefusal(error: unknown): boolean {
  return error instanceof ApiError && (error.code === GALLERY_CLOSED || error.code === GALLERY_NOT_ATTENDEE);
}
