"""Build one self-contained mockup page (dist/mockup.html) from public/ for sharing."""
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
pub = root / "mockup"
html = (pub / "index.html").read_text()
css = (pub / "styles.css").read_text()
js = (pub / "app.js").read_text()
html = html.replace('<link rel="stylesheet" href="styles.css">', "<style>\n" + css + "\n</style>")
html = html.replace('<script src="app.js"></script>', "<script>\n" + js + "\n</script>")
# The artifact host supplies doctype/html/head/body, so strip them.
html = re.sub(r"<!doctype html>\s*<html[^>]*>\s*<head>\s*", "", html, flags=re.I)
html = re.sub(r'<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*', "", html)
html = re.sub(r"</head>\s*<body>\s*", "\n", html)
html = re.sub(r"</body>\s*</html>\s*$", "\n", html)
out = root / "dist"; out.mkdir(exist_ok=True)
(out / "mockup.html").write_text(html)
print("wrote", out / "mockup.html", len(html), "bytes")
