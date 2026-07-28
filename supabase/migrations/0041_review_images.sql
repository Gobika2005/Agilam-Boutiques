-- Buyer-uploaded review photos.
--
-- Reviews (migration 0014) were text + star rating only. Buyers can now attach
-- up to a few photos of the piece as delivered — the single biggest thing a
-- fashion review is missing without them. Adds the column and a dedicated,
-- buyer-owned storage bucket, following the same public-bucket-with-folder-
-- ownership pattern as product-images (0016) and boutique-images (0019).
--
-- Additive and idempotent. Run once in the Supabase SQL editor after 0014+.

alter table reviews add column if not exists images text[] not null default '{}';

-- ── Bucket ────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('review-images', 'review-images', true)
on conflict (id) do update set public = true;

-- ── Storage RLS ───────────────────────────────────────────────────────────
-- Objects live under `{buyer_id}/{file}` so ownership is the path's first
-- folder against auth.uid() — the same shape product-images checks against
-- the boutique id, just keyed to the buyer instead of a boutique.
drop policy if exists "review-images: public read"  on storage.objects;
drop policy if exists "review-images: owner upload" on storage.objects;
drop policy if exists "review-images: owner delete" on storage.objects;

create policy "review-images: public read" on storage.objects for select
  using (bucket_id = 'review-images');

create policy "review-images: owner upload" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'review-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "review-images: owner delete" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'review-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
