import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA, type ManifestOptions } from 'vite-plugin-pwa';
import radarConfig from '../../radar.config';
import { normalizeSiteUrl, prerenderPlugin, siteUrlPlugin } from './build/prerender';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The policy pages read these from radar.config.ts, through the build and at runtime. */
const legalDefine = {
  __RADAR_LEGAL_NAME__: JSON.stringify(radarConfig.legalName),
  __RADAR_LEGAL_EMAIL__: JSON.stringify(radarConfig.contactEmail),
  __RADAR_INTL_PAYMENTS__: JSON.stringify(radarConfig.internationalPayments),
};

export default defineConfig(({ mode }) => {
  // API_PORT lives in the repo-root .env, shared with `pnpm api:dev`.
  const env = loadEnv(mode, '../..', '');
  const apiPort = env.API_PORT || '8787';
  const siteUrl = normalizeSiteUrl(env.VITE_SITE_URL);
  return {
    // VITE_* variables live in the repo-root .env too.
    envDir: '../..',
    define: legalDefine,
    plugins: [
      react(),
      siteUrlPlugin(siteUrl),
      prerenderPlugin(siteUrl, here, legalDefine),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/mark.svg', 'icons/apple-touch-icon.png'],
        // user_preferences is newer than the plugin's manifest type.
        manifest: {
          name: 'Signal Radar',
          short_name: 'Signal Radar',
          description: 'A ranked radar of what is moving in the niches you follow.',
          start_url: '/read',
          scope: '/',
          // The share sheet opens /save?url=…&text=…&title=…, which saves the link.
          share_target: {
            action: '/save',
            method: 'GET',
            params: { url: 'url', text: 'text', title: 'title' },
          },
          display: 'standalone',
          background_color: '#f7f7f4',
          theme_color: '#f7f7f4',
          // Installed app (bar, splash) follows the phone's dark mode where Chrome supports it.
          user_preferences: {
            color_scheme_dark: { background_color: '#1b1a16', theme_color: '#1b1a16' },
          },
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: '/icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        } as Partial<ManifestOptions>,
        workbox: {
          importScripts: ['push-sw.js'],
          globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              // Session, account, queue and billing data is per user and must never come from a cache.
              urlPattern: ({ url }) =>
                /^\/api\/(me|queue|saves|auth|billing|push|telegram)(\/|$)/.test(url.pathname),
              handler: 'NetworkOnly',
            },
            {
              // The last feed (and defaults) keeps working offline.
              urlPattern: ({ url }) => url.pathname.startsWith('/api/feed'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'radar-feed',
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 8, maxAgeSeconds: 7 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [200] },
              },
            },
          ],
        },
      }),
    ],
    // Quick tunnels (cloudflared) for testing on a phone.
    server: {
      allowedHosts: ['.trycloudflare.com'],
      proxy: { '/api': `http://localhost:${apiPort}` },
    },
  };
});
