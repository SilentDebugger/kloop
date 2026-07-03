import { useMemo } from "react";

/**
 * Tiny, dependency-free markdown renderer for article blocks and messages.
 * Supports: headings, bold/italic, inline code, fenced code, links,
 * ordered/unordered lists, blockquotes, paragraphs. Escapes all HTML first.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className={`md-body ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, (_, c: string) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function renderMarkdown(src: string): string {
  const lines = escapeHtml(src.replace(/\r\n/g, "\n")).split("\n");
  const out: string[] = [];
  let i = 0;
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.startsWith("```")) {
      closeList();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
        buf.push(lines[i] ?? "");
        i++;
      }
      i++; // closing fence
      out.push(`<pre><code>${buf.join("\n")}</code></pre>`);
      continue;
    }

    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      closeList();
      const level = h[1]!.length;
      out.push(`<h${level}>${inline(h[2] ?? "")}</h${level}>`);
      i++;
      continue;
    }

    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    const ul = line.match(/^\s*[-*]\s+(.*)/);
    if (ol || ul) {
      const kind = ol ? "ol" : "ul";
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((ol ?? ul)![1] ?? "")}</li>`);
      i++;
      continue;
    }

    if (line.startsWith("&gt;")) {
      closeList();
      out.push(`<blockquote>${inline(line.slice(4).trim())}</blockquote>`);
      i++;
      continue;
    }

    if (line.trim() === "") {
      closeList();
      i++;
      continue;
    }

    closeList();
    // merge consecutive text lines into one paragraph
    const buf = [line];
    while (i + 1 < lines.length) {
      const next = lines[i + 1] ?? "";
      if (next.trim() === "" || /^(#{1,3})\s|^\s*\d+[.)]\s|^\s*[-*]\s|^```|^&gt;/.test(next)) break;
      buf.push(next);
      i++;
    }
    out.push(`<p>${inline(buf.join("<br/>"))}</p>`);
    i++;
  }
  closeList();
  return out.join("");
}
