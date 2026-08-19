/**
 * "2 weeks ago" for anything dated in days rather than minutes — reviews,
 * replies, order history.
 *
 * Day granularity on purpose. A review is not a chat message: "3 minutes ago"
 * on someone's opinion of a saree is noise, and the useful comparison is "is
 * this recent enough to still be true of the shop". The feed's own clock
 * (`FeedPostCard`) is minute-granular and stays separate — a post that landed
 * an hour ago genuinely is different from one from this morning.
 */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}
