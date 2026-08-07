export interface ExtractedPdfText {
  readonly text: string;
  readonly pages: ReadonlyMap<number, string>;
}

function decodePdfLiteral(value: string): string {
  return value.replace(
    /\\([nrtbf()\\]|[0-7]{1,3})/g,
    (_, escaped: string) => {
      if (/^[0-7]/.test(escaped)) return String.fromCharCode(Number.parseInt(escaped, 8));
      const escapes: Readonly<Record<string, string>> = {
        n: "\n",
        r: "\r",
        t: "\t",
        b: "\b",
        f: "\f",
        "(": "(",
        ")": ")",
        "\\": "\\",
      };
      return escapes[escaped] ?? escaped;
    },
  );
}

function textOperators(value: string): string {
  const pieces: string[] = [];
  const operator = /\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")/g;
  for (const match of value.matchAll(operator)) pieces.push(decodePdfLiteral(match[1]));
  return pieces.join("\n");
}

export function extractPdfText(bytes: Uint8Array): ExtractedPdfText | null {
  const raw = new TextDecoder("latin1").decode(bytes);
  if (!raw.startsWith("%PDF-")) return null;

  const pages = new Map<number, string>();
  const markers = [...raw.matchAll(/%%Page:\s*(\d+)\s+\d+/g)];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]!;
    const pageNumber = Number(marker[1]);
    const start = (marker.index ?? 0) + marker[0].length;
    const end = markers[index + 1]?.index ?? raw.length;
    pages.set(pageNumber, textOperators(raw.slice(start, end)));
  }

  const text = markers.length === 0 ? textOperators(raw) : [...pages.values()].join("\n");
  return text.length === 0 ? null : { text, pages };
}
