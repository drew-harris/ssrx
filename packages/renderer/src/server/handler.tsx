import { assetsForRequest, renderAssetsToHtml } from '@ssrx/vite/runtime';
import type { Simplify } from 'type-fest';

import type { RenderPlugin, ServerHandlerOpts } from '../types.ts';
import { storage } from './ctx.ts';
import { injectIntoStream } from './stream-transformer.ts';

export function createApp<P extends RenderPlugin<any, any>[]>({
  RootLayout,
  renderer,
  appRenderer,
  plugins,
}: ServerHandlerOpts<P>) {
  function __getPluginCtx<K extends P[number]['id']>(pluginId: K): Simplify<ExtractPluginContext<P, K>>;
  function __getPluginCtx<K extends P[number]['id']>(pluginId?: K): Simplify<ExtractPluginsContext<P>>;
  function __getPluginCtx<K extends P[number]['id']>(
    pluginId?: K,
  ): Simplify<ExtractPluginsContext<P> | ExtractPluginContext<P, K>> {
    const store = storage.getStore()?.pluginCtx || {};

    if (typeof pluginId !== 'undefined') return store[pluginId] || {};

    // @ts-expect-error ignore, complicated
    return store;
  }

  const ctx = new Proxy({} as ExtractPluginsAppContext<P>, {
    get(_target, prop) {
      const store = storage.getStore()?.appCtx || {};
      // @ts-expect-error ignore
      return store[prop];
    },
  });

  return {
    ctx,

    // for internal debugging
    __getPluginCtx,

    clientHandler: () => {
      throw new Error(
        'The client handler should not be called on the server. . Something is wrong, make sure you are not calling `appHandler.client()` in code that is included in the server.',
      );
    },

    serverHandler: async ({ req, meta }: { req: Request; meta?: Record<string, unknown> }) => {
      const assets = await assetsForRequest(req.url);

      const pluginCtx: Record<string, any> = {};
      for (const p of plugins || []) {
        if (p.createCtx) {
          pluginCtx[p.id] = p.createCtx({ req, meta });
        }
      }

      const appCtx: Record<string, any> = {};
      for (const p of plugins || []) {
        if (p.hooks?.['app:extendCtx']) {
          Object.assign(
            appCtx,
            p.hooks['app:extendCtx']({
              ctx: pluginCtx[p.id],
              meta,
              getPluginCtx<T>(id: string) {
                return pluginCtx[id] as T;
              },
            }) || {},
          );
        }
      }

      async function createAppStream() {
        let AppComp = appRenderer ? await appRenderer({ req }) : undefined;

        for (const p of plugins || []) {
          if (!p.hooks?.['app:render']) continue;

          if (AppComp) {
            throw new Error('Only one plugin can implement app:render. app:wrap might be what you are looking for.');
          }

          AppComp = await p.hooks['app:render']({ req });

          break;
        }

        const wrappers: Array<(props: { children: () => JSX.Element }) => JSX.Element> = [];
        for (const p of plugins || []) {
          if (!p.hooks?.['app:wrap']) continue;

          wrappers.push(p.hooks['app:wrap']({ req, ctx: pluginCtx[p.id] }));
        }

        const renderApp = () => {
          if (!AppComp) {
            throw new Error('No plugin implemented renderApp');
          }

          let finalApp;
          if (wrappers.length) {
            for (const i in wrappers) {
              const Wrap = wrappers[i]!;
              const nextWrapper = wrappers[Number(i) + 1];
              const children = nextWrapper || AppComp;
              // @ts-expect-error ignore
              finalApp = Wrap({ children });
            }
          } else {
            finalApp = AppComp();
          }

          // @ts-expect-error ignore
          return RootLayout({ children: finalApp });
        };

        return (await renderer.renderToStream({ app: renderApp })).pipeThrough(
          injectIntoStream({
            async emitToDocumentHead() {
              const work = [];
              for (const p of plugins || []) {
                if (!p.hooks?.['ssr:emitToHead']) continue;

                work.push(p.hooks['ssr:emitToHead']({ req, ctx: pluginCtx[p.id] }));
              }

              const html = [renderAssetsToHtml(assets), ...(await Promise.all(work))];

              return html.filter(Boolean).join('');
            },

            async emitBeforeSsrChunk() {
              const work = [];
              for (const p of plugins || []) {
                if (!p.hooks?.['ssr:emitBeforeFlush']) continue;

                work.push(p.hooks['ssr:emitBeforeFlush']({ req, ctx: pluginCtx[p.id] }));
              }

              return (await Promise.all(work)).filter(Boolean).join('');
            },

            async emitToDocumentBody() {
              const work = [];
              for (const p of plugins || []) {
                if (!p.hooks?.['ssr:emitToBody']) continue;

                work.push(p.hooks['ssr:emitToBody']({ req, ctx: pluginCtx[p.id] }));
              }

              return (await Promise.all(work)).filter(Boolean).join('');
            },
          }),
        );
      }

      /**
       * Run the rest of the hooks in storage scope so we can access the ctx
       */
      const appStream = await storage.run({ appCtx, pluginCtx }, createAppStream);
      // const appStream = await createAppStream();

      return appStream;
    },
  };
}

/**
 * Have to duplicate these extract types in client and server entry, or downstream packages don't work correctly
 */

type Flatten<T> = {
  [K in keyof T]: T[K] extends object ? T[K] : never;
}[keyof T];

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

type ExtractPluginsContext<T extends RenderPlugin<any, any>[]> = {
  [K in T[number]['id']]: ExtractPluginContext<T, K>;
};

type ExtractPluginContext<T extends RenderPlugin<any, any>[], K extends T[number]['id']> = NonNullable<
  Extract<T[number], { id: K }>
>['createCtx'] extends (...args: any[]) => infer R
  ? R
  : never;

type ExtractPluginsAppContext<T extends RenderPlugin<any, any>[]> = Simplify<
  UnionToIntersection<
    Flatten<{
      [K in T[number]['id']]: ExtractPluginAppContext<T, K>;
    }>
  >
>;

type ExtractPluginAppContext<T extends RenderPlugin<any, any>[], K extends T[number]['id']> = NonNullable<
  Extract<T[number], { id: K }>['hooks']
>['app:extendCtx'] extends (...args: any[]) => infer R
  ? R
  : never;