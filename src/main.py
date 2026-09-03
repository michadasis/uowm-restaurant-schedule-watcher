import sys
from utils import build_sql, parse_week_from_page
from translate import translate_weeks

try:
    import pdfplumber
except ImportError:
    sys.exit("Missing dependency. Run: pip install -r requirements.txt")


def main():
    if len(sys.argv) < 2:
        sys.exit(f"Usage: python {sys.argv[0]} <input.pdf> [output.sql] [source_pdf_url]")

    pdf_path = sys.argv[1]
    sql_path = sys.argv[2] if len(sys.argv) > 2 else "restaurantMenu.sql"
    source_pdf_url = sys.argv[3] if len(sys.argv) > 3 else None

    print(f"Reading PDF: {pdf_path}")

    weeks_gr = []
    with pdfplumber.open(pdf_path) as pdf:
        num_pages = len(pdf.pages)
        print(f"Pages found: {num_pages}  ->  {num_pages} week(s) in menu cycle")
        for page in pdf.pages:
            weeks_gr.append(parse_week_from_page(page))

    weeks_en = translate_weeks(weeks_gr)

    sql_content = build_sql(weeks_gr, weeks_en, len(weeks_gr), source_pdf_url)

    with open(sql_path, "w", encoding="utf-8") as f:
        f.write(sql_content)

    print(f"Written to: {sql_path}")


if __name__ == "__main__":
    main()
