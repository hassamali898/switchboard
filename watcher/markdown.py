"""HTML email to a clean Markdown preview, with the standard library only.

Remote images are dropped (they are how senders track opens, and nothing here loads them); an
image's alt text stays when it has one. Scripts, styles and the document head are dropped. Links keep
their address only when it is http(s) or mailto. The result is what the Inbox shows and what the
draft model reads, so it never carries markup a reader could act on.
"""

from __future__ import annotations

import re
from html import unescape
from html.parser import HTMLParser

_BLOCK = {"p", "div", "section", "article", "header", "footer", "table", "tr", "ul", "ol", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "pre"}
_SKIP = {"script", "style", "head", "title", "noscript", "template"}
_SAFE_LINK = re.compile(r"^(https?:|mailto:)", re.I)


class _Markdown(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.skip = 0
        self.links: list[str | None] = []
        self.lists: list[str] = []
        self.quote = 0
        self.pre = 0

    def _text(self, text: str) -> None:
        self.out.append(text)

    def _break(self, count: int = 1) -> None:
        self.out.append("\n" * count)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIP:
            self.skip += 1
            return
        if self.skip:
            return
        values = {name: value or "" for name, value in attrs}
        if tag in ("br",):
            self._break()
        elif tag in _BLOCK:
            self._break(2)
            if tag.startswith("h") and len(tag) == 2:
                self._text("#" * int(tag[1]) + " ")
            elif tag == "blockquote":
                self.quote += 1
                self._text("> ")
            elif tag in ("ul", "ol"):
                self.lists.append(tag)
            elif tag == "pre":
                self.pre += 1
                self._text("```\n")
        elif tag == "li":
            self._break()
            self._text("  " * max(0, len(self.lists) - 1) + ("1. " if self.lists and self.lists[-1] == "ol" else "- "))
        elif tag in ("strong", "b"):
            self._text("**")
        elif tag in ("em", "i"):
            self._text("_")
        elif tag in ("td", "th"):
            self._text(" | ")
        elif tag == "a":
            href = values.get("href", "").strip()
            self.links.append(href if _SAFE_LINK.match(href) else None)
            if self.links[-1]:
                self._text("[")
        elif tag == "img":
            alt = values.get("alt", "").strip()
            if alt:
                self._text(f"[image: {alt}]")
        elif tag == "hr":
            self._break(2)
            self._text("---")
            self._break(2)

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return
        if tag in ("strong", "b"):
            self._text("**")
        elif tag in ("em", "i"):
            self._text("_")
        elif tag == "a":
            href = self.links.pop() if self.links else None
            if href:
                self._text(f"]({href})")
        elif tag in _BLOCK:
            if tag == "blockquote":
                self.quote = max(0, self.quote - 1)
            elif tag in ("ul", "ol") and self.lists:
                self.lists.pop()
            elif tag == "pre":
                self.pre = max(0, self.pre - 1)
                self._text("\n```")
            self._break(2)

    def handle_data(self, data: str) -> None:
        if self.skip:
            return
        text = data if self.pre else re.sub(r"\s+", " ", data)
        if self.quote and not self.pre:
            text = text.replace("\n", "\n> ")
        self._text(text)

    def markdown(self) -> str:
        text = unescape("".join(self.out))
        lines = []
        for line in text.split("\n"):
            line = line.rstrip()
            line = re.sub(r"^\s*\|\s*", "", line)  # a row's leading cell separator
            line = re.sub(r"\*\*\s*\*\*", "", line)  # empty bold
            lines.append(line.strip() if not line.startswith("    ") else line)
        joined = "\n".join(lines)
        joined = re.sub(r"\[\]\([^)]*\)", "", joined)  # links around nothing (an image that was dropped)
        return re.sub(r"\n{3,}", "\n\n", joined).strip()


def html_to_markdown(html: str) -> str:
    parser = _Markdown()
    try:
        parser.feed(html)
        parser.close()
    except Exception:  # a broken document: fall back to stripping tags
        return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", html))).strip()
    return parser.markdown()
