import { useEffect, useState } from 'react';
import { ThreadList } from '@/components/chat/ThreadList';
import { usePageMeta } from '@/lib/pageMeta';
import { useAsync } from '@/hooks/useAsync';
import { useCatalog } from '@/state/CatalogContext';
import { getBuyerId, fetchConversationsForBuyer } from '@/data/chat';
import type { Thread } from '@/data/demo';

const relTime = (iso: string | null) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return m + 'm';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h';
  return Math.round(h / 24) + 'd';
};

export function Messages() {
  usePageMeta({ title: 'Messages', description: 'Your conversations with MangaiMart boutiques.' });
  // The inbox is keyed by boutique, so the catalogue can supply each shop's
  // logo for the thread avatar.
  const { boutiqueById } = useCatalog();
  // Only read an existing identity — merely opening the inbox shouldn't mint an
  // anonymous account; that happens when the buyer actually opens a chat.
  const [buyerId, setBuyerId] = useState<string | null>(null);
  useEffect(() => {
    getBuyerId().then(setBuyerId).catch(() => setBuyerId(null));
  }, []);

  const { data: convos } = useAsync(
    () => (buyerId ? fetchConversationsForBuyer(buyerId) : Promise.resolve([])),
    [buyerId],
  );

  // Key each thread by boutique id — the buyer chat route resolves the
  // conversation from the boutique, so product/boutique pages and the inbox all
  // land on the same live thread.
  const threads: Thread[] = (convos ?? []).map((c) => ({
    id: c.boutique_id,
    name: c.boutique_name || 'Boutique',
    last: c.last_message,
    time: relTime(c.last_message_at),
    unread: c.unread,
    online: false,
    tone: c.boutique_tone % 8,
    avatar: boutiqueById(c.boutique_id)?.logo || undefined,
  }));

  return <ThreadList threads={threads} chatBase="/chat" />;
}
