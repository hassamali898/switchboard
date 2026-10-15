"""HTML email to the Markdown preview: structure kept, remote images and scripts dropped."""

from watcher.markdown import html_to_markdown
from watcher.adapters.gmail import plain_body
import base64


def test_structure_links_and_lists():
    html = ("<html><head><title>x</title><style>p{}</style></head><body><h2>Q4 roadmap</h2>"
            "<p>Hi <b>Alex</b>, see <a href='https://example.com/deck'>the deck</a>.</p>"
            "<ul><li>auth timeline</li><li>headcount</li></ul><script>alert(1)</script></body></html>")
    text = html_to_markdown(html)
    assert text.startswith("## Q4 roadmap")
    assert "Hi **Alex**, see [the deck](https://example.com/deck)." in text
    assert "- auth timeline\n- headcount" in text
    assert "alert" not in text and "p{}" not in text


def test_remote_images_dropped_unsafe_links_kept_as_text():
    html = ("<p><img src='https://track.example.com/open.gif' width=1 height=1>"
            "<img src='https://cdn.example.com/chart.png' alt='Revenue chart'>"
            "<a href='javascript:steal()'>click</a> <a href='https://x.example'><img src='https://x.example/logo.png'></a></p>")
    text = html_to_markdown(html)
    assert "track.example.com" not in text and "chart.png" not in text
    assert "[image: Revenue chart]" in text
    assert "javascript" not in text and "click" in text
    assert "x.example" not in text  # a link around a dropped image disappears with it


def test_entities_and_quotes():
    assert html_to_markdown("<p>Fish &amp; chips&nbsp;&lt;3</p>") == "Fish & chips <3"
    assert html_to_markdown("<blockquote>quoted</blockquote>") == "> quoted"


def test_gmail_prefers_plain_text_and_converts_html_only_mail():
    encode = lambda s: base64.urlsafe_b64encode(s.encode()).decode()
    html_only = {"mimeType": "text/html", "body": {"data": encode("<p>Hello <i>there</i></p><img src='https://t.example/p.gif'>")}}
    assert plain_body(html_only) == "Hello _there_"
    both = {"mimeType": "multipart/alternative", "parts": [
        {"mimeType": "text/plain", "body": {"data": encode("Plain hello")}},
        {"mimeType": "text/html", "body": {"data": encode("<p>Hello</p>")}},
    ]}
    assert plain_body(both) == "Plain hello"
