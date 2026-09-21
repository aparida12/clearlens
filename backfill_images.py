import health_research_monitor as m

with m.get_conn() as c:
    rows = m.run(c, "SELECT title, source, article_date FROM uploaded_articles WHERE image_url IS NULL OR image_url = '' ORDER BY id DESC LIMIT 10").fetchall()
for t, s, d in rows:
    print("->", t[:60])
    m.attach_image(t, s, d)
