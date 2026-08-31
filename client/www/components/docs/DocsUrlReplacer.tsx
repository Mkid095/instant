'use client';

import { useEffect } from 'react';

interface UrlConfig {
  apiURI?: string;
  wsUrl?: string;
  dashboardUrl?: string;
}

function deriveWsUrl(apiURI: string): string {
  try {
    const url = new URL(apiURI);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/runtime/session';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return 'wss://api.instantdb.com/runtime/session';
  }
}

function deriveDashboardUrl(apiURI: string): string {
  try {
    const url = new URL(apiURI);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'https://instantdb.com';
  }
}

export function DocsUrlReplacer() {
  useEffect(() => {
    const config: UrlConfig = (window as unknown as { __instantConfig?: UrlConfig }).__instantConfig || {};
    const apiUrl = config.apiURI || '';
    const wsUrl = deriveWsUrl(apiUrl);
    const dashboardUrl = deriveDashboardUrl(apiUrl);

    // Only run on client side
    if (typeof document === 'undefined') return;

    // Replace placeholders in code blocks
    const replacements: Record<string, string> = {
      '$API_URL': apiUrl || 'https://api.instantdb.com',
      '$WS_URL': wsUrl,
      '$DASHBOARD_URL': dashboardUrl,
      '${your-selfhosted-dashboard-url}': dashboardUrl,
    };

    // Find all pre/code elements in the docs area (inside article)
    const docElements = document.querySelectorAll('article pre, article code, main pre, main code');
    docElements.forEach((el) => {
      let html = el.innerHTML;
      let modified = false;

      for (const [placeholder, value] of Object.entries(replacements)) {
        if (html.includes(placeholder)) {
          // Escape special regex characters in placeholder
          const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          html = html.replace(new RegExp(escaped, 'g'), value);
          modified = true;
        }
      }

      if (modified) {
        el.innerHTML = html;
      }
    });
  }, []);

  // This component renders nothing visible
  return null;
}
