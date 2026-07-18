import { createRequire } from "node:module";
import { dirname, join, extname } from "node:path";
import { Parser, Language } from "web-tree-sitter";

const require = createRequire(import.meta.url);

// resolve each wasm via its package.json dir. js grammar comes from the top-level
// package, not the stale copy nested inside tree-sitter-typescript.
function wasmDir(pkg: string): string {
  return dirname(require.resolve(pkg + "/package.json"));
}

const WASM: Record<Grammar, string> = {
  typescript: join(wasmDir("tree-sitter-typescript"), "tree-sitter-typescript.wasm"),
  tsx: join(wasmDir("tree-sitter-typescript"), "tree-sitter-tsx.wasm"),
  javascript: join(wasmDir("tree-sitter-javascript"), "tree-sitter-javascript.wasm"),
  python: join(wasmDir("tree-sitter-python"), "tree-sitter-python.wasm"),
};

export type Grammar = "typescript" | "tsx" | "javascript" | "python";

export function grammarForExt(ext: string): Grammar | null {
  switch (ext.toLowerCase()) {
    case ".ts":
      return "typescript";
    case ".tsx":
      return "tsx";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".py":
      return "python";
    default:
      return null;
  }
}

export function grammarForPath(p: string): Grammar | null {
  return grammarForExt(extname(p));
}

let initPromise: Promise<void> | null = null;
let parser: Parser | null = null;
const langs = new Map<Grammar, Language>();

// one process-wide parser; languages cached after first load.
export async function getParser(grammar: Grammar): Promise<Parser> {
  if (!initPromise) initPromise = Parser.init();
  await initPromise;
  if (!parser) parser = new Parser();
  let lang = langs.get(grammar);
  if (!lang) {
    lang = await Language.load(WASM[grammar]);
    langs.set(grammar, lang);
  }
  parser.setLanguage(lang);
  return parser;
}
