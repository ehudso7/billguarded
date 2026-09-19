/* global process, document, getComputedStyle, fetch, URLSearchParams, URL */
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('node:fs');
const path = require('node:path');

const port = Number(process.env.PORT || 3000);
const origin = `http://127.0.0.1:${port}`;
function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const location = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(location) : [location];
  });
}

function discoverRoutes() {
  const discovered = new Set(['/']);
  for (const root of ['src/pages', 'pages']) {
    for (const file of walk(root)) {
      if (!/\.(jsx?|tsx?)$/.test(file) || file.includes(`${path.sep}api${path.sep}`)) continue;
      let route = file.slice(root.length).replace(/\\/g, '/').replace(/\.(jsx?|tsx?)$/, '');
      if (route.split('/').some((part) => part.startsWith('_') || part.includes('['))) continue;
      route = route.replace(/\/index$/, '') || '/';
      if (route === '/404' || route === '/500') continue;
      discovered.add(route.startsWith('/') ? route : `/${route}`);
    }
  }
  for (const root of ['src/app', 'app']) {
    for (const file of walk(root).filter((item) => /\/page\.(jsx?|tsx?)$/.test(item.replace(/\\/g, '/')))) {
      let route = path.dirname(file).slice(root.length).replace(/\\/g, '/');
      if (route.split('/').some((part) => part.includes('['))) continue;
      route = route.split('/').filter((part) => part && !(part.startsWith('(') && part.endsWith(')'))).join('/');
      discovered.add(route ? `/${route}` : '/');
    }
  }
  return [...discovered].sort();
}

const configuredRoutes = (process.env.PORTFOLIO_ROUTES || 'auto').split(',').map((route) => route.trim()).filter(Boolean);
const routes = [...new Set([
  ...configuredRoutes.filter((route) => route !== 'auto'),
  ...(configuredRoutes.includes('auto') ? discoverRoutes() : []),
])];
const oauthProviders = (process.env.PORTFOLIO_OAUTH_PROVIDERS || '').split(',').map((provider) => provider.trim()).filter(Boolean);
const viewports = [
  { width: 320, height: 800 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1440, height: 1000 },
];

for (const route of routes) {
  for (const viewport of viewports) {
    test(`${route} fits ${viewport.width}px and passes the visual contract`, async ({ page }) => {
      const browserErrors = [];
      await page.route('**/_vercel/**', (request) =>
        request.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
      );
      page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
      });
      await page.setViewportSize(viewport);
      const response = await page.goto(`${origin}${route}`, { waitUntil: 'domcontentloaded' });
      expect(response, `No document response for ${route}`).toBeTruthy();
      expect(response.status(), `${route} returned ${response.status()}`).toBeLessThan(400);

      const layout = await page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        const visible = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        const clippedControls = [...document.querySelectorAll('button,input,select,textarea,[role="button"]')]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return visible(element) && (rect.left < -1 || rect.right > viewportWidth + 1);
          }).map((element) => element.outerHTML.slice(0, 180));
        const undersizedControls = [...document.querySelectorAll('button,input:not([type="hidden"]),select,[role="button"]')]
          .filter((element) => visible(element) && element.getBoundingClientRect().height < 40)
          .map((element) => element.outerHTML.slice(0, 180));
        const invalidIcons = [...document.querySelectorAll('svg')]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && !element.hasAttribute('viewBox') && !(element.hasAttribute('width') && element.hasAttribute('height'));
          }).length;
        const brokenImages = [...document.images].filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.currentSrc || image.src);
        const ids = [...document.querySelectorAll('[id]')].map((element) => element.id).filter(Boolean);
        const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
        return {
          overflow: document.documentElement.scrollWidth - viewportWidth,
          clippedControls,
          undersizedControls,
          invalidIcons,
          brokenImages,
          duplicateIds,
          overflowElements: [...document.querySelectorAll('body *')]
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              return visible(element) && (rect.left < -1 || rect.right > viewportWidth + 1);
            })
            .map((element) => element.outerHTML.slice(0, 180))
            .slice(0, 12),
        };
      });

      expect(
        layout.overflow,
        `The document overflows horizontally: ${JSON.stringify(layout.overflowElements)}`
      ).toBeLessThanOrEqual(1);
      expect(layout.clippedControls, 'Interactive controls are clipped').toEqual([]);
      expect(layout.undersizedControls, 'Interactive controls are shorter than 40px').toEqual([]);
      expect(layout.invalidIcons, 'Visible SVG icons require viewBox or dimensions').toBe(0);
      expect(layout.brokenImages, 'Rendered images failed to load').toEqual([]);
      expect(layout.duplicateIds, 'DOM ids must be unique').toEqual([]);
      const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const blocking = accessibility.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical');
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
      expect(browserErrors, browserErrors.join('\n')).toEqual([]);
    });
  }
}

for (const provider of oauthProviders) {
  test(`${provider} OAuth initiation preserves a state cookie`, async ({ context, page }) => {
    await context.clearCookies();
    await page.goto(`${origin}/auth/signin`);
    const response = await page.evaluate(async ({ oauthProvider, callbackUrl }) => {
      const csrfResponse = await fetch('/api/auth/csrf');
      const { csrfToken } = await csrfResponse.json();
      const signInResponse = await fetch(`/api/auth/signin/${oauthProvider}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Auth-Return-Redirect': '1',
        },
        body: new URLSearchParams({ csrfToken, callbackUrl, json: 'true' }),
      });
      return {
        ok: signInResponse.ok,
        contentType: signInResponse.headers.get('content-type'),
        text: await signInResponse.text(),
      };
    }, { oauthProvider: provider, callbackUrl: `${origin}/` });
    expect(response.ok).toBe(true);
    expect(response.contentType).toContain('application/json');
    const body = JSON.parse(response.text);
    const url = new URL(body.url);
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('redirect_uri')).toBe(`${origin}/api/auth/callback/${provider}`);
    const cookies = await context.cookies(origin);
    expect(cookies.some((cookie) => cookie.name.endsWith('next-auth.state') && cookie.value)).toBe(true);
  });
}
