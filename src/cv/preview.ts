import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { installReadableStreamAsyncIterator } from "../polyfills";

installReadableStreamAsyncIterator();
GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Draws every page of the generated PDF into canvases `width` CSS px wide, so the preview is the
 * real file the user will export (the webview cannot be trusted to show PDFs inline).
 */
export async function renderPdfPages(pdfBlob: Blob, width: number, maxPages = 10): Promise<HTMLCanvasElement[]> {
  const task = getDocument({ data: new Uint8Array(await pdfBlob.arrayBuffer()) });
  try {
    const pdf = await task.promise;
    const canvases: HTMLCanvasElement[] = [];
    const ratio = window.devicePixelRatio || 1;
    for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * ratio });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${width}px`;
      await page.render({ canvas, viewport }).promise;
      canvases.push(canvas);
    }
    return canvases;
  } finally {
    await task.destroy();
  }
}
