"""
Checks the UoWM restaurant-schedule page for a new/changed menu PDF.
If the PDF differs from the one already recorded in menu_meta.source_pdf_url,
downloads it, runs it through the existing parse/translate pipeline, and
applies the resulting SQL straight to the database.

Requires POSTGRES_URL (or POSTGRES_URL_NON_POOLING) in the environment.
"""

import os
import re
import sys
import tempfile

import psycopg2
import requests
import pdfplumber

from utils import build_sql, parse_week_from_page
from translate import translate_weeks

PAGE_URL = "https://www.uowm.gr/epikairotita/sitisi/enimerosi-gia-tin-leitoyrgia-ton-estiatorion-toy-panepistimioy-dytikis-makedonias-2024/"


def find_pdf_url(page_url: str) -> str:
    resp = requests.get(page_url, timeout=30)
    resp.raise_for_status()
    match = re.search(r'href="([^"]+\.pdf)"', resp.text, re.IGNORECASE)
    if not match:
        sys.exit("No PDF link found on the page.")
    url = match.group(1)
    if url.startswith("/"):
        url = "https://www.uowm.gr" + url
    return url


def get_stored_pdf_url(conn) -> str | None:
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('public.menu_meta')")
        if cur.fetchone()[0] is None:
            return None
        cur.execute("SELECT source_pdf_url FROM menu_meta WHERE id = 1")
        row = cur.fetchone()
        return row[0] if row else None


def main():
    db_url = os.environ.get("POSTGRES_URL") or os.environ.get("POSTGRES_URL_NON_POOLING")
    if not db_url:
        sys.exit("Set POSTGRES_URL (or POSTGRES_URL_NON_POOLING) in the environment.")

    pdf_url = find_pdf_url(PAGE_URL)
    print(f"Found PDF on page: {pdf_url}")

    conn = psycopg2.connect(db_url)
    try:
        stored_url = get_stored_pdf_url(conn)
        if stored_url == pdf_url:
            print("No change since last run.")
            return

        print(f"New PDF detected (previously: {stored_url!r}). Downloading and processing...")
        resp = requests.get(pdf_url, timeout=60)
        resp.raise_for_status()

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(resp.content)
            tmp_path = tmp.name

        weeks_gr = []
        with pdfplumber.open(tmp_path) as pdf:
            print(f"Pages found: {len(pdf.pages)}")
            for page in pdf.pages:
                weeks_gr.append(parse_week_from_page(page))

        weeks_en = translate_weeks(weeks_gr)
        sql_content = build_sql(weeks_gr, weeks_en, len(weeks_gr), source_pdf_url=pdf_url)

        with conn.cursor() as cur:
            cur.execute(sql_content)
        conn.commit()
        print("Database updated successfully.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
