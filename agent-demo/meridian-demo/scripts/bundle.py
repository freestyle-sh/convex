"""Package generated JSONL tables in Convex's directory-based ZIP format."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1] / "data"
tables = sorted(root.glob("*/documents.jsonl"))
if len(tables) != 19:
    raise SystemExit("Run npm run generate first; expected all 19 tables.")
with ZipFile(root / "meridian-supply.zip", "w", ZIP_DEFLATED) as archive:
    for table in tables:
        archive.write(table, table.relative_to(root))
print(f"Packaged {len(tables)} tables in data/meridian-supply.zip")
