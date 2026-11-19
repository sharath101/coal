'use client';

import { useState } from 'react';

interface OpenOptions {
  /** The link is a PDF: show it in the tab instead of downloading it. */
  pdf?: boolean;
}

/**
 * Storage links ask the browser to download. To read a PDF in the tab, fetch it and open it as a
 * local file with its own type; if that fails, fall back to the link itself.
 */
async function showablePdf(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    if (!response.ok) return url;
    const bytes = await response.blob();
    return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  } catch {
    return url;
  }
}

/**
 * Opens a short-lived link (a PDF, a stored file) in a new tab. The tab is opened straight away,
 * inside the click, so pop-up blockers allow it; the link is fetched next and put in it.
 */
export function useOpenLink() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = async (getUrl: () => Promise<string | null>, options: OpenOptions) => {
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    setPending(true);
    setError(null);
    try {
      const url = await getUrl();
      if (!url) {
        tab?.close();
        return;
      }
      const target = options.pdf ? await showablePdf(url) : url;
      if (tab) tab.location.href = target;
      else window.location.assign(target);
    } catch (e) {
      tab?.close();
      setError(e);
    } finally {
      setPending(false);
    }
  };

  // Fire and forget: failures land in `error`.
  const open = (getUrl: () => Promise<string | null>, options: OpenOptions = {}) => {
    void run(getUrl, options);
  };

  return { open, pending, error };
}
