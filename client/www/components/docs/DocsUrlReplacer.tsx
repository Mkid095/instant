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

    // Replace hardcoded instantdb.com URLs and placeholders in code blocks
    const replacements: Record<string, string> = {
      '$API_URL': apiUrl || 'https://api.instantdb.com',
      '$WS_URL': wsUrl,
      '$DASHBOARD_URL': dashboardUrl,
      '${your-selfhosted-dashboard-url}': dashboardUrl,
      // OAuth callback URLs
      'https://api.instantdb.com/runtime/oauth/callback': `${apiUrl || 'https://api.instantdb.com'}/runtime/oauth/callback`,
      // Platform OAuth URLs
      'https://api.instantdb.com/platform/oauth/start': `${apiUrl || 'https://api.instantdb.com'}/platform/oauth/start`,
      'https://api.instantdb.com/platform/oauth/token': `${apiUrl || 'https://api.instantdb.com'}/platform/oauth/token`,
      'https://api.instantdb.com/platform/oauth/revoke': `${apiUrl || 'https://api.instantdb.com'}/platform/oauth/revoke`,
      'https://api.instantdb.com/superadmin/apps': `${apiUrl || 'https://api.instantdb.com'}/superadmin/apps`,
      // Dashboard URLs
      'https://instantdb.com/dash': dashboardUrl + '/dash',
      'https://www.instantdb.com/dash': dashboardUrl + '/dash',
      'https://instantdb.com/recipes': dashboardUrl + '/recipes',
      'https://www.instantdb.com/recipes': dashboardUrl + '/recipes',
      'https://www.instantdb.com/llms-full.txt': dashboardUrl + '/llms-full.txt',
      // Image URLs
      'https://www.instantdb.com/img/icon/logo-512.svg': dashboardUrl + '/img/icon/logo-512.svg',
    };

    // Dashboard URLs with query strings need path+query replacement
    const dashboardUrlBase = dashboardUrl;
    const dashReplacements = [
      ['https://instantdb.com/dash?s=main&t=oauth-apps', `${dashboardUrlBase}/dash?s=main&t=oauth-apps`],
      ['https://instantdb.com/dash?s=main&t=auth', `${dashboardUrlBase}/dash?s=main&t=auth`],
      ['https://instantdb.com/dash?s=main&t=admin', `${dashboardUrlBase}/dash?s=main&t=admin`],
      ['https://instantdb.com/dash?s=invites', `${dashboardUrlBase}/dash?s=invites`],
      ['https://www.instantdb.com/dash?s=personal-access-tokens', `${dashboardUrlBase}/dash?s=personal-access-tokens`],
      ['https://www.instantdb.com/dash?t=sandbox', `${dashboardUrlBase}/dash?t=sandbox`],
      ['https://www.instantdb.com/dash?t=explorer', `${dashboardUrlBase}/dash?t=explorer`],
      ['https://www.instantdb.com/dash/user-settings', `${dashboardUrlBase}/dash/user-settings`],
      ['https://api.instantdb.com/...', `${apiUrl || 'https://api.instantdb.com'}/...`],
    ];

    // Find all elements in the docs area (inside article and main)
    const docElements = document.querySelectorAll('article *');
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

      // Handle dashboard URLs with query strings
      for (const [from, to] of dashReplacements) {
        if (html.includes(from)) {
          html = html.split(from).join(to);
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
