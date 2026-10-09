# word count for the home page's recent writing list. counts words with a
# letter or number in them, from the post body (intro note included) up to the
# likes and comments. usage: python3 scripts/word-count.py now/sep-2026/index.html
import re, sys, html
h = open(sys.argv[1]).read()
body = h.split("page-header--post", 1)[1].split("</header>", 1)[1]
body = re.split(r'<section\s+class="post-social"', body, 1)[0]
body = re.sub(r"<!--.*?-->", " ", body, flags=re.S)
text = html.unescape(re.sub(r"<[^>]+>", " ", body))
print(len([w for w in text.split() if re.search(r"[A-Za-z0-9]", w)]))
