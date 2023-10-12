import { assetsForRequest, renderAssetsToHtml } from '@super-ssr/vite/runtime';
import type { Simplify } from 'type-fest';

import type { RenderPlugin, ServerHandlerOpts } from '../types.ts';
import { storage } from './ctx.ts';
import { injectIntoStream } from './stream-transformer.ts';

export function createApp<P extends RenderPlugin<any, any>[]>({
  renderRoot,
  renderer,
  renderApp,
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

    serverHandler: async ({ req }: { req: Request }) => {
      const assets = await assetsForRequest(req.url);

      const pluginCtx: Record<string, any> = {};
      const appCtx: Record<string, any> = {};

      for (const p of plugins || []) {
        if (p.hooks?.extendRequestCtx) {
          pluginCtx[p.id] = p.hooks.extendRequestCtx({ req });
        }

        if (p.hooks?.extendAppCtx) {
          Object.assign(appCtx, p.hooks.extendAppCtx({ ctx: pluginCtx[p.id] }) || {});
        }
      }

      /**
       * Run the rest of the hooks in storage scope so we can access the ctx
       */
      const appStream = await storage.run({ appCtx, pluginCtx }, async () => {
        let appElem = renderApp ? await renderApp({ req }) : undefined;

        for (const p of plugins || []) {
          if (!p.hooks?.renderApp) continue;

          if (appElem) {
            throw new Error('Only one plugin can implement renderApp. Use wrapApp instead.');
          }

          appElem = await p.hooks.renderApp({ req });

          break;
        }

        if (!appElem) {
          throw new Error('No plugin implemented renderApp');
        }

        for (const p of plugins || []) {
          if (!p.hooks?.wrapApp) continue;

          appElem = p.hooks.wrapApp({ req, ctx: pluginCtx[p.id], children: appElem });
        }

        const RootComp = renderRoot;

        return (await renderer.renderToStream({ app: <RootComp>{appElem}</RootComp> })).pipeThrough(
          injectIntoStream({
            async emitToDocumentHead() {
              const work = [];
              for (const p of plugins || []) {
                if (!p.hooks?.emitToDocumentHead) continue;

                work.push(p.hooks.emitToDocumentHead({ req, ctx: pluginCtx[p.id] }));
              }

              const html = [renderAssetsToHtml(assets), ...(await Promise.all(work))];

              return html.filter(Boolean).join('');
            },

            async emitBeforeSsrChunk() {
              const work = [];
              for (const p of plugins || []) {
                if (!p.hooks?.emitBeforeSsrChunk) continue;

                work.push(p.hooks.emitBeforeSsrChunk({ req, ctx: pluginCtx[p.id] }));
              }

              return (await Promise.all(work)).filter(Boolean).join('');
            },

            async emitToDocumentBody() {
              const work = [];
              for (const p of plugins || []) {
                if (!p.hooks?.emitToDocumentBody) continue;

                work.push(p.hooks.emitToDocumentBody({ req, ctx: pluginCtx[p.id] }));
              }

              return (await Promise.all(work)).filter(Boolean).join('');
            },
          }),
        );
      });

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
  Extract<T[number], { id: K }>['hooks']
>['extendRequestCtx'] extends (...args: any[]) => infer R
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
>['extendAppCtx'] extends (...args: any[]) => infer R
  ? R
  : never;