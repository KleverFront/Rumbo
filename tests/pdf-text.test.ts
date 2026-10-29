// Run with: pnpm test  (Node's built-in runner; Node strips the TS types natively)
import assert from "node:assert/strict";
import { test } from "node:test";
import { installReadableStreamAsyncIterator } from "../src/polyfills.ts";

/** Minimal one-page PDF with real text; offsets computed so pdfjs accepts it. */
function makePdf(text: string): Uint8Array {
  const content = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

async function pdfText(data: Uint8Array): Promise<string> {
  const { getDocument } = await import("pdfjs-dist");
  const task = getDocument({ data });
  try {
    const content = await (await (await task.promise).getPage(1)).getTextContent();
    return content.items.map((i) => ("str" in i ? i.str : "")).join("");
  } finally {
    await task.destroy();
  }
}

test("pdfjs text extraction works without native ReadableStream async iteration (WebKit)", async () => {
  const proto = ReadableStream.prototype as unknown as Record<symbol, unknown>;
  const native = proto[Symbol.asyncIterator];
  delete proto[Symbol.asyncIterator]; // what the macOS webview looks like
  try {
    await assert.rejects(pdfText(makePdf("Sin polyfill")), /async iterable/);

    installReadableStreamAsyncIterator();
    assert.equal(await pdfText(makePdf("Juan Perez Python Docker")), "Juan Perez Python Docker");
  } finally {
    proto[Symbol.asyncIterator] = native;
  }
});

test("polyfill keeps a native implementation untouched", () => {
  const proto = ReadableStream.prototype as unknown as Record<symbol, unknown>;
  const native = proto[Symbol.asyncIterator];
  installReadableStreamAsyncIterator();
  assert.equal(proto[Symbol.asyncIterator], native);
});
