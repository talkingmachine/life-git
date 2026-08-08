import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface ExtractedPdfText {
  readonly text: string;
  readonly pages: ReadonlyMap<number, string>;
}

export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedPdfText | null> {
  const data = new Uint8Array(bytes.byteLength);
  data.set(bytes);
  const loadingTask = getDocument({
    data,
    disableFontFace: true,
    stopAtErrors: true,
    useSystemFonts: true,
    useWorkerFetch: false,
  });
  const pages = new Map<number, string>();
  try {
    const document = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : ""))
        .join("")
        .replace(/[ \t]+\n/g, "\n")
        .trim();
      pages.set(pageNumber, text);
    }
  } catch {
    return null;
  } finally {
    await loadingTask.destroy();
  }

  const text = [...pages.values()].join("\n");
  return text.length === 0 ? null : { text, pages };
}
