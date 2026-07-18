import { createHash } from "node:crypto";
import { basename, extname } from "node:path";
import type { Node as TSNode } from "web-tree-sitter";
import { getParser, grammarForPath, type Grammar } from "./grammars.js";
import type { EntityType, EdgeType, EntityShape } from "../shared/events.js";

// internal entity: carries hash + exported for diffing; the emitted shape drops both.
export interface ExtractedEntity {
  id: string;
  type: EntityType;
  path: string;
  name: string; // qualified name (== basename for the file entity)
  span: [number, number];
  loc: number;
  hash: string;
  exported: boolean;
}

export interface ImportRequest {
  lang: "js" | "py";
  spec: string; // js: raw specifier; py: dotted module path
  level: number; // py: leading-dot count; js: unused
}

export interface ExtractEdge {
  from: string;
  to: string;
  type: EdgeType;
}

export interface FileExtract {
  path: string;
  entities: ExtractedEntity[];
  imports: ImportRequest[];
  defines: ExtractEdge[]; // file -> each symbol
}

export function toShape(e: ExtractedEntity): EntityShape {
  return { id: e.id, type: e.type, path: e.path, name: e.name, span: e.span, loc: e.loc };
}

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

function children(n: TSNode): TSNode[] {
  return n.children.filter((c): c is TSNode => c != null);
}

function namedChildren(n: TSNode): TSNode[] {
  return n.namedChildren.filter((c): c is TSNode => c != null);
}

function countLines(source: string): number {
  if (source.length === 0) return 0;
  return source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
}

export async function extractFile(relPath: string, source: string): Promise<FileExtract | null> {
  const grammar = grammarForPath(relPath);
  if (!grammar) return null;
  const parser = await getParser(grammar);
  const tree = parser.parse(source);
  if (!tree) return null;
  try {
    const entities: ExtractedEntity[] = [];
    const imports: ImportRequest[] = [];

    const lines = countLines(source);
    entities.push({
      id: relPath,
      type: "file",
      path: relPath,
      name: basename(relPath),
      span: [1, Math.max(1, lines)],
      loc: lines,
      hash: sha1(source),
      exported: false,
    });

    if (grammar === "python") walkPython(tree.rootNode, relPath, entities, imports);
    else walkJsTs(tree.rootNode, relPath, entities, imports);

    const defines: ExtractEdge[] = entities
      .filter((e) => e.type !== "file")
      .map((e) => ({ from: relPath, to: e.id, type: "defines" as const }));

    return { path: relPath, entities, imports, defines };
  } finally {
    tree.delete();
  }
}

function mkEntity(
  type: EntityType,
  relPath: string,
  qname: string,
  node: TSNode,
  exported: boolean,
): ExtractedEntity {
  const span: [number, number] = [node.startPosition.row + 1, node.endPosition.row + 1];
  return {
    id: `${relPath}#${qname}`,
    type,
    path: relPath,
    name: qname,
    span,
    loc: span[1] - span[0] + 1,
    hash: sha1(node.text),
    exported,
  };
}

// ---- javascript / typescript ----

const FN_VALUES = new Set([
  "arrow_function",
  "function",
  "function_expression",
  "generator_function",
]);

function walkJsTs(
  root: TSNode,
  relPath: string,
  entities: ExtractedEntity[],
  imports: ImportRequest[],
): void {
  for (const child of children(root)) handleTopJsTs(child, false, relPath, entities, imports);
}

function handleTopJsTs(
  node: TSNode,
  exported: boolean,
  relPath: string,
  entities: ExtractedEntity[],
  imports: ImportRequest[],
): void {
  switch (node.type) {
    case "import_statement": {
      const src = node.childForFieldName("source");
      if (src) imports.push({ lang: "js", spec: stripQuotes(src.text), level: 0 });
      return;
    }
    case "export_statement": {
      // `export ... from "x"` is an import relationship
      const src = node.childForFieldName("source");
      if (src) {
        imports.push({ lang: "js", spec: stripQuotes(src.text), level: 0 });
        return;
      }
      const decl = node.childForFieldName("declaration");
      if (decl) handleTopJsTs(decl, true, relPath, entities, imports);
      return;
    }
    case "function_declaration":
    case "generator_function_declaration": {
      const name = node.childForFieldName("name")?.text;
      if (name) entities.push(mkEntity("function", relPath, name, node, exported));
      return;
    }
    case "class_declaration":
    case "abstract_class_declaration": {
      const name = node.childForFieldName("name")?.text;
      if (!name) return;
      entities.push(mkEntity("class", relPath, name, node, exported));
      const body = node.childForFieldName("body");
      if (body) {
        for (const m of namedChildren(body)) {
          if (m.type !== "method_definition") continue;
          const mn = m.childForFieldName("name")?.text;
          if (mn) entities.push(mkEntity("function", relPath, `${name}.${mn}`, m, exported));
        }
      }
      return;
    }
    case "interface_declaration": {
      // interfaces have no `function` slot in the schema; map to `class` (a named type container)
      const name = node.childForFieldName("name")?.text;
      if (name) entities.push(mkEntity("class", relPath, name, node, exported));
      return;
    }
    case "lexical_declaration":
    case "variable_declaration": {
      for (const d of namedChildren(node)) {
        if (d.type !== "variable_declarator") continue;
        const val = d.childForFieldName("value");
        if (!val || !FN_VALUES.has(val.type)) continue;
        const name = d.childForFieldName("name")?.text;
        if (name) entities.push(mkEntity("function", relPath, name, d, exported));
      }
      return;
    }
  }
}

function stripQuotes(s: string): string {
  return s.replace(/^['"`]/, "").replace(/['"`]$/, "");
}

// ---- python ----

function walkPython(
  root: TSNode,
  relPath: string,
  entities: ExtractedEntity[],
  imports: ImportRequest[],
): void {
  for (const child of children(root)) {
    const def = child.type === "decorated_definition" ? child.childForFieldName("definition") : child;
    if (!def) continue;
    if (def.type === "function_definition") {
      const name = def.childForFieldName("name")?.text;
      if (name) entities.push(mkEntity("function", relPath, name, def, !name.startsWith("_")));
    } else if (def.type === "class_definition") {
      const name = def.childForFieldName("name")?.text;
      if (!name) continue;
      entities.push(mkEntity("class", relPath, name, def, !name.startsWith("_")));
      const body = def.childForFieldName("body");
      if (body) {
        for (const m of children(body)) {
          const mdef = m.type === "decorated_definition" ? m.childForFieldName("definition") : m;
          if (mdef?.type !== "function_definition") continue;
          const mn = mdef.childForFieldName("name")?.text;
          if (mn) entities.push(mkEntity("function", relPath, `${name}.${mn}`, mdef, !mn.startsWith("_")));
        }
      }
    } else if (child.type === "import_from_statement") {
      collectPyImports(child, imports);
    }
    // plain `import x` is absolute -> skipped
  }
}

function collectPyImports(node: TSNode, imports: ImportRequest[]): void {
  const mn = node.childForFieldName("module_name");
  if (!mn || mn.type !== "relative_import") return; // absolute from-import -> skip
  const rel = mn.text;
  const dots = /^\.+/.exec(rel)?.[0].length ?? 0;
  const modPath = rel.slice(dots);
  if (modPath) {
    imports.push({ lang: "py", spec: modPath, level: dots });
    return;
  }
  // `from . import a, b` -> each imported name is a submodule
  for (const c of namedChildren(node)) {
    if (c === mn) continue;
    if (c.type === "dotted_name") imports.push({ lang: "py", spec: c.text, level: dots });
    else if (c.type === "aliased_import") {
      const dn = c.childForFieldName("name") ?? namedChildren(c)[0];
      if (dn) imports.push({ lang: "py", spec: dn.text, level: dots });
    }
  }
}
