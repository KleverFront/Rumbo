// WebKit (the macOS Tauri webview) does not implement async iteration of ReadableStream,
// but pdfjs v6 uses `for await (... of readableStream)` in page.getTextContent().
export function installReadableStreamAsyncIterator(): void {
  const proto = ReadableStream.prototype as unknown as Record<symbol, unknown>;
  if (proto[Symbol.asyncIterator]) return;
  proto[Symbol.asyncIterator] = async function* (this: ReadableStream) {
    const reader = this.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
}
