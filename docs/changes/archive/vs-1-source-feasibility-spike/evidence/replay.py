import argparse
import hashlib
import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import xml.etree.ElementTree as ET


def finish(payload, code=0):
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    raise SystemExit(code)


parser = argparse.ArgumentParser()
parser.add_argument("--artifact")
args = parser.parse_args()

root_dir = Path(__file__).parent
manifest_path = root_dir / "manifest.json"
checksums_path = root_dir / "checksums.sha256"

checksum_entries = {}
for line in checksums_path.read_text().splitlines():
    expected_hash, filename = line.split(maxsplit=1)
    checksum_entries[filename] = expected_hash

for filename in ("manifest.json", "retrieval-log.json", "replay.py"):
    evidence_path = root_dir / filename
    if not evidence_path.exists():
        finish({"status": "unavailable", "marker": "yellow", "reason": "evidence-package-file-missing"}, 2)
    if hashlib.sha256(evidence_path.read_bytes()).hexdigest() != checksum_entries.get(filename):
        finish({"status": "unavailable", "marker": "yellow", "reason": "evidence-package-checksum-mismatch"}, 2)

manifest_bytes = manifest_path.read_bytes()
actual_manifest_hash = hashlib.sha256(manifest_bytes).hexdigest()

manifest = json.loads(manifest_bytes)
artifact_path = Path(args.artifact) if args.artifact else root_dir / manifest["capture"]["artifact"]
if not artifact_path.exists():
    finish({"status": "unavailable", "marker": "yellow", "reason": "artifact-missing"}, 2)

artifact = artifact_path.read_bytes()
actual_artifact_hash = hashlib.sha256(artifact).hexdigest()
if actual_artifact_hash != manifest["capture"]["sha256"]:
    finish({"status": "unavailable", "marker": "yellow", "reason": "artifact-hash-mismatch"}, 2)
if args.artifact is None and actual_artifact_hash != checksum_entries.get(manifest["capture"]["artifact"]):
    finish({"status": "unavailable", "marker": "yellow", "reason": "evidence-package-checksum-mismatch"}, 2)

xml_root = ET.fromstring(artifact)
eur = next(item for item in xml_root.findall("Valute") if item.findtext("CharCode") == "EUR")
value = eur.findtext("VunitRate").replace(",", ".")
effective_date = "-".join(reversed(xml_root.attrib["Date"].split(".")))
if value != manifest["claim"]["value"] or effective_date != manifest["claim"]["effectiveDate"]:
    finish({"status": "unavailable", "marker": "yellow", "reason": "claim-mismatch"}, 2)

income_eur = (Decimal(manifest["derivation"]["inputMonthlyIncomeRub"]) / Decimal(value)).quantize(
    Decimal("0.01"), rounding=ROUND_HALF_UP
)
if str(income_eur) != manifest["derivation"]["outputMonthlyIncomeEur"]:
    finish({"status": "unavailable", "marker": "yellow", "reason": "derivation-mismatch"}, 2)

finish(
    {
        "artifactSha256": actual_artifact_hash,
        "effectiveDate": effective_date,
        "incomeEur": str(income_eur),
        "manifestSha256": actual_manifest_hash,
        "rateRubPerEur": value,
        "status": "verified-replay"
    }
)
