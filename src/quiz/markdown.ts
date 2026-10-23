import { Marked, type TokenizerAndRendererExtension } from "marked";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

const DISPLAY = /^\$\$([\s\S]+?)\$\$/;
const INLINE = /^\$(?!\s)([^$\n]*?[^\s$])\$/;

const math: TokenizerAndRendererExtension = {
  name: "math",
  level: "inline",
  start: (src) => src.indexOf("$"),
  tokenizer(src) {
    const m = DISPLAY.exec(src) ?? INLINE.exec(src);
    return m ? { type: "math", raw: m[0] } : undefined;
  },
  renderer: (token) => escape(token.raw),
};

const marked = new Marked({ extensions: [math], renderer: { html: ({ text }) => escape(text) } });

export function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false });
}
