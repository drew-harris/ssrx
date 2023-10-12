import type { Simplify } from 'type-fest';

import type { ClientHandlerOpts, RenderPlugin } from '../types.ts';

export function createApp<P extends RenderPlugin<any, any>[]>({
  renderRoot,
  renderApp,
  plugins,
}: ClientHandlerOpts<P>) {
  // @ts-expect-error ignore
  const req = new Request(`${window.location.pathname}${window.location.search}`);

  function __getPluginCtx<K extends P[number]['id']>(pluginId: K): Simplify<ExtractPluginContext<P, K>>;
  function __getPluginCtx<K extends P[number]['id']>(pluginId?: K): Simplify<ExtractPluginsContext<P>>;
  function __getPluginCtx<K extends P[number]['id']>(
    pluginId?: K,
  ): Simplify<ExtractPluginsContext<P> | ExtractPluginContext<P, K>> {
    // @ts-expect-error ignore, complicated
    const store = window.__PAGE_CTX__?.pluginCtx || {};

    if (typeof pluginId !== 'undefined') return store[pluginId] || {};

    return store;
  }

  const ctx = new Proxy({} as ExtractPluginsAppContext<P>, {
    get(_target, prop) {
      // @ts-expect-error ignore
      const store = window.__PAGE_CTX__?.appCtx || {};

      return store[prop];
    },
  });

  return {
    ctx,

    // for internal debugging
    __getPluginCtx,

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    serverHandler: (props: { req: Request }) => {
      throw new Error(
        'The server handler should not be called on the client. Something is wrong, make sure you are not calling `appHandler.server()` in code that is included in the client.',
      );
    },

    clientHandler: async () => {
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

      // @ts-expect-error ignore
      window.__PAGE_CTX__ = { pluginCtx, appCtx };

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

      return <RootComp>{appElem}</RootComp>;
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