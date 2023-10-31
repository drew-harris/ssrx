/*!
 * Portions of this code are adapted from nextjs.
 *
 * MIT License, Copyright (c) 2023 Vercel, Inc.
 * https://github.com/vercel/next.js/blob/canary/packages/next/src/server/stream-utils/node-web-streams-helper.ts
 */

const sleep = (n = 2000) => new Promise(r => setTimeout(r, n));

export function chainTransformers<T>(
  readable: ReadableStream<T>,
  transformers: readonly (TransformStream<T, T> | null)[],
): ReadableStream<T> {
  let stream = readable;
  for (const transformer of transformers) {
    if (!transformer) continue;

    stream = stream.pipeThrough(transformer);
  }
  return stream;
}

export function createHeadInsertionTransformStream(
  insert: () => Promise<string> | string,
): TransformStream<Uint8Array, Uint8Array> {
  let inserted = false;
  let freezing = false;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new TransformStream({
    async transform(chunk, controller) {
      // While react is flushing chunks, we don't apply insertions
      if (freezing) {
        controller.enqueue(chunk);
        return;
      }

      if (inserted) {
        controller.enqueue(chunk);
        freezing = true;
      } else {
        const content = decoder.decode(chunk);
        const index = content.indexOf('</head>');
        if (index !== -1) {
          const html = await insert();

          // console.log('createHeadInsertionTransformStream', html, content);
          // console.log('\n\n--------\n\n');

          const insertedHeadContent = content.slice(0, index) + html + content.slice(index);
          controller.enqueue(encoder.encode(insertedHeadContent));
          freezing = true;
          inserted = true;
        }
      }

      if (!inserted) {
        controller.enqueue(chunk);
      } else {
        setTimeout(() => {
          freezing = false;
        }, 0);
      }
    },
  });
}

export function createInsertedHTMLStream(
  insert: () => Promise<string> | string,
): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new TransformStream({
    transform: async (chunk, controller) => {
      let inserted = false;

      const html = await insert();
      if (html) {
        const content = decoder.decode(chunk);

        // If the chunk includes the start of the doc, insert it first
        // This can happen if consumer called something like stream.allReady
        // createMoveSuffixStream will handle making sure inserted content is
        // moved above the closing body tag
        const index = content.indexOf('<!DOCTYPE');
        if (index > -1) {
          controller.enqueue(chunk);
          inserted = true;
        }

        controller.enqueue(encoder.encode(html));

        // console.log('createInsertedHTMLStream', { html, content: decoder.decode(chunk) });
        // console.log('\n\n--------\n\n');
      }

      if (!inserted) {
        controller.enqueue(chunk);
      }
    },
  });
}

/**
 * This transform stream moves the suffix to the end of the stream, so results
 * like `</body></html><script>...</script>` will be transformed to
 * `<script>...</script></body></html>`.
 */
export function createMoveSuffixStream(suffix: string): TransformStream<Uint8Array, Uint8Array> {
  let foundSuffix = false;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new TransformStream({
    transform(chunk, controller) {
      if (foundSuffix) {
        return controller.enqueue(chunk);
      }

      const buf = decoder.decode(chunk);

      const index = buf.indexOf(suffix);
      if (index > -1) {
        foundSuffix = true;

        // If the whole chunk is the suffix, then don't write anything, it will
        // be written in the flush.
        if (buf.length === suffix.length) {
          return;
        }

        // Write out the part before the suffix.
        const before = buf.slice(0, index);
        chunk = encoder.encode(before);
        controller.enqueue(chunk);

        // In the case where the suffix is in the middle of the chunk, we need
        // to split the chunk into two parts.
        if (buf.length > suffix.length + index) {
          // Write out the part after the suffix.
          const after = buf.slice(index + suffix.length);
          chunk = encoder.encode(after);
          controller.enqueue(chunk);
        }
      } else {
        controller.enqueue(chunk);
      }
    },
    flush(controller) {
      // Even if we didn't find the suffix, the HTML is not valid if we don't
      // add it, so insert it at the end.
      controller.enqueue(encoder.encode(suffix));
    },
  });
}

export function createBufferedTransformStream(): TransformStream<Uint8Array, Uint8Array> {
  let buffer: Uint8Array = new Uint8Array();
  let pending: DetachedPromise<void> | undefined;

  const flush = (controller: TransformStreamDefaultController) => {
    // If we already have a pending flush, then return early.
    if (pending) return;

    const detached = new DetachedPromise<void>();
    pending = detached;

    setTimeout(() => {
      try {
        controller.enqueue(buffer);
        buffer = new Uint8Array();
      } catch {
        // If an error occurs while enqueuing it can't be due to this
        // transformers fault. It's likely due to the controller being
        // errored due to the stream being cancelled.
      } finally {
        pending = undefined;
        detached.resolve();
      }
    }, 0);
  };

  return new TransformStream({
    transform(chunk, controller) {
      // Combine the previous buffer with the new chunk.
      const combined = new Uint8Array(buffer.length + chunk.byteLength);
      combined.set(buffer);
      combined.set(chunk, buffer.length);
      buffer = combined;

      // Flush the buffer to the controller.
      flush(controller);
    },
    flush() {
      if (!pending) return;

      return pending.promise;
    },
  });
}

/**
 * A `Promise.withResolvers` implementation that exposes the `resolve` and
 * `reject` functions on a `Promise`.
 *
 * @see https://tc39.es/proposal-promise-with-resolvers/
 */
class DetachedPromise<T = any> {
  public readonly resolve: (value: T | PromiseLike<T>) => void;
  public readonly reject: (reason: any) => void;
  public readonly promise: Promise<T>;

  constructor() {
    let resolve: (value: T | PromiseLike<T>) => void;
    let reject: (reason: any) => void;

    // Create the promise and assign the resolvers to the object.
    this.promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    // We know that resolvers is defined because the Promise constructor runs
    // synchronously.
    this.resolve = resolve!;
    this.reject = reject!;
  }
}
