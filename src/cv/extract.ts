import mammoth from "mammoth";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { installReadableStreamAsyncIterator } from "../polyfills";

installReadableStreamAsyncIterator();
GlobalWorkerOptions.workerSrc = workerUrl;

export const ACCEPTED_CV_TYPES = ".pdf,.docx";

/** Plain text of a PDF or DOCX file. Throws on any other type. */
export async function extractCvText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const data = await file.arrayBuffer();
  if (name.endsWith(".pdf")) return extractPdf(data);
  if (name.endsWith(".docx")) return (await mammoth.extractRawText({ arrayBuffer: data })).value.trim();
  throw new Error("Formato no admitido. Use un archivo PDF o DOCX.");
}

async function extractPdf(data: ArrayBuffer): Promise<string> {
  // pdfjs v6 frees the document through the loading task, not the document proxy.
  const task = getDocument({ data });
  const pdf = await task.promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(
        content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join(""),
      );
    }
    return pages.join("\n\n").trim();
  } finally {
    await task.destroy();
  }
}
