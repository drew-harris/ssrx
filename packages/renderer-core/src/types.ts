export type ServerRenderer = {
  renderToStream: (props: { app: React.ReactNode }) => Promise<ReadableStream>;
};

type BaseHandlerOpts = {
  renderRoot: (props: { children: React.ReactNode }) => React.ReactNode;
  renderApp?: (props: { req: Request }) => React.ReactNode | Promise<React.ReactNode>;
};

export type ClientHandlerOpts<P extends RenderPlugin<any, any>[]> = BaseHandlerOpts & {
  plugins?: P;
};

export type ServerHandlerOpts<P extends RenderPlugin<any, any>[]> = BaseHandlerOpts & {
  renderer: ServerRenderer;
  plugins?: P;
};

export type RenderPlugin<C extends Record<string, unknown>, AC extends Record<string, unknown>> = {
  id: Readonly<string>;

  createCtx?: (props: { req: Request }) => C;

  hooks?: {
    'app:extendCtx'?: (props: { ctx: C }) => AC;
    'app:wrap'?: (props: { req: Request; ctx: C; children: React.ReactNode }) => React.ReactNode;
    'app:render'?: (props: { req: Request }) => React.ReactNode | Promise<React.ReactNode>;

    // Return a string or ReactElement to emit
    // some HTML into the document's head.
    'ssr:emitToHead'?: (props: {
      req: Request;
      ctx: C;
    }) => string | void | undefined | Promise<string | void | undefined>;

    // Return a string to emit into the
    // SSR stream just before the rendering framework (react, solid, etc) emits a
    // chunk of the page.
    'ssr:emitBeforeFlush'?: (props: {
      req: Request;
      ctx: C;
    }) => string | void | undefined | Promise<string | void | undefined>;

    // Return a string to emit
    // some HTML into the document's body before it is closed.
    'ssr:emitToBody'?: (props: {
      req: Request;
      ctx: C;
    }) => string | void | undefined | Promise<string | void | undefined>;

    'ssr:completed'?: (props: { req: Request; ctx: C }) => void | Promise<void>;
  };
};

/**
 * Some types useful to downstream consumers.
 */
export type { SetOptional } from 'type-fest';
