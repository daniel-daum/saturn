import html
import re
import sys

h = open(sys.argv[1]).read()

body = h.split("page-header--post", 1)[1].split("</header>", 1)[1]
body = body.split("</article>", 1)[0]
body = re.sub(r"<!--.*?-->", " ", body, flags=re.S)
text = html.unescape(re.sub(r"<[^>]+>", " ", body))

print(len([w for w in text.split() if re.search(r"[A-Za-z0-9]", w)]))
