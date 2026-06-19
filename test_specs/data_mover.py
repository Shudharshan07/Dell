import os
import shutil
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from threading import Lock

# =========================
# CONFIG
# =========================

SOURCE = Path("APIs")

DEST_JSON = Path("test_specs/Json")
DEST_V2 = Path("test_specs/V2")
DEST_V3 = Path("test_specs/V3")

MAX_WORKERS = 32
PROGRESS_EVERY = 1000

for d in (DEST_JSON, DEST_V2, DEST_V3):
    d.mkdir(parents=True, exist_ok=True)

# =========================
# ANSI COLORS     
# =========================

RESET = "\033[0m"
RED = "\033[31m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
BLUE = "\033[34m"
CYAN = "\033[36m"

# =========================
# COUNTERS
# =========================

lock = Lock()

processed = 0
moved = 0
json_count = 0
v2_count = 0
v3_count = 0


# =========================
# HELPERS
# =========================

def unique_destination(filepath: Path, target_dir: Path) -> Path:
    """
    Preserve uniqueness using the relative path.

    APIs/foo/bar/openapi.yaml
    ->
    foo_bar_openapi.yaml
    """

    relative = filepath.relative_to(SOURCE)

    safe_name = "_".join(relative.parts)

    return target_dir / safe_name


def detect_target(filepath: Path):
    try:
        # JSON by extension
        if filepath.suffix.lower() == ".json":
            return DEST_JSON

        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read(4096).lower()

        if "swagger:" in text and "2.0" in text:
            return DEST_V2

        if "openapi:" in text:
            return DEST_V3

    except Exception:
        return None

    return None


def process_file(filepath: Path):
    global processed
    global moved
    global json_count
    global v2_count
    global v3_count

    target = detect_target(filepath)

    with lock:
        processed += 1

        if processed % PROGRESS_EVERY == 0:
            print(
                f"{CYAN}[INFO]{RESET} "
                f"Processed {processed:,} files | "
                f"Moved {moved:,}"
            )

    if not target:
        return

    try:
        destination = unique_destination(filepath, target)

        shutil.move(str(filepath), str(destination))

        with lock:
            moved += 1

            if target == DEST_JSON:
                json_count += 1
            elif target == DEST_V2:
                v2_count += 1
            elif target == DEST_V3:
                v3_count += 1

    except Exception as e:
        with lock:
            print(
                f"{RED}[ERROR]{RESET} "
                f"{filepath.name} -> {e}"
            )


# =========================
# DISCOVER FILES
# =========================

print(f"{BLUE}[SCAN]{RESET} Building file list...")

files = []

for root, dirs, filenames in os.walk(SOURCE):

    # Prevent scanning output folders if they ever end up inside APIs
    dirs[:] = [
        d for d in dirs
        if d.lower() not in {"json", "v2", "v3"}
    ]

    for name in filenames:
        if name.lower().endswith(
            (".yaml", ".yml", ".json")
        ):
            files.append(Path(root) / name)

print(
    f"{GREEN}[FOUND]{RESET} "
    f"{len(files):,} candidate files"
)

# =========================
# PROCESS
# =========================

print(f"{BLUE}[START]{RESET} Processing...")

with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
    executor.map(process_file, files)

# =========================
# SUMMARY
# =========================

print()
print(f"{GREEN}========== SUMMARY =========={RESET}")
print(f"Files scanned : {processed:,}")
print(f"Files moved   : {moved:,}")
print(f"JSON          : {json_count:,}")
print(f"Swagger 2.0   : {v2_count:,}")
print(f"OpenAPI 3.x   : {v3_count:,}")
print(f"{GREEN}============================={RESET}")