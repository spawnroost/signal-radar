/**
 * Why the summarizer cannot read a link, decided from the URL alone (browser-safe).
 * `video`: YouTube has no article text. `redirect`: Google News article links reach the
 * publisher only through a script, so the server sees an empty page.
 */
export function unreadableReason(url: string): 'video' | 'redirect' | null {
  let h: string;
  try {
    h = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  if (h === 'youtu.be' || h === 'youtube.com' || h.endsWith('.youtube.com')) return 'video';
  if (h === 'news.google.com') return 'redirect';
  return null;
}
