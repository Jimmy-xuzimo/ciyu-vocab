#!/usr/bin/env python3
"""Build the compact, deduplicated app lexicon from the documented sources.

Example:
  python scripts/build_vocabulary.py \
    --kyle-root ../english-vocabulary \
    --gaokao-root ../word3500 \
    --cet4-pdf "C:/Users/.../大学英语四级词汇带音标-乱序版.pdf" \
    --cet6-pdf "C:/Users/.../大学英语六级词汇乱序版.pdf"

The original project data is read from scripts/data/legacy_chunk*.txt. PDF input is never
copied into the app; only extracted word data is written to public/data.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any

try:
    import pdfplumber
except ImportError as exc:  # pragma: no cover - command-line dependency guard
    raise SystemExit("Install pdfplumber and pypdf to import the supplied PDFs.") from exc


BOOKS = [
    {"id": "junior-high", "title": "初中", "subtitle": "打牢基础词汇", "color": "mint"},
    {"id": "senior-high", "title": "高中", "subtitle": "高中与高考核心词汇", "color": "blue"},
    {"id": "cet4", "title": "大学四级", "subtitle": "CET-4 高频词汇", "color": "purple"},
    {"id": "cet6", "title": "大学六级", "subtitle": "CET-6 进阶词汇", "color": "rose"},
    {"id": "ielts", "title": "雅思", "subtitle": "IELTS 学术英语", "color": "teal"},
    {"id": "postgraduate", "title": "考研", "subtitle": "研究生入学考试", "color": "gold"},
    {"id": "toefl", "title": "托福", "subtitle": "TOEFL 学术英语", "color": "sky"},
    {"id": "sat", "title": "SAT", "subtitle": "学术与阅读词汇", "color": "indigo"},
]

KYLE_BOOKS = {
    "初中": "junior-high",
    "高中": "senior-high",
    "四级": "cet4",
    "六级": "cet6",
    "雅思": "ielts",
    "考研": "postgraduate",
    "托福": "toefl",
    "SAT": "sat",
}

SOURCES = [
    {
        "id": "legacy-project",
        "title": "原 gaokao-vocab 词表",
        "url": "https://github.com/Jimmy-xuzimo/gaokao-vocab",
        "license": "原项目词表（项目所有者提供）",
    },
    {
        "id": "word3500",
        "title": "pluto0x0/word3500",
        "url": "https://github.com/pluto0x0/word3500",
        "license": "MIT",
    },
    {
        "id": "kylebing",
        "title": "KyleBing/english-vocabulary",
        "url": "https://github.com/KyleBing/english-vocabulary",
        "license": "BSD-3-Clause",
    },
    {
        "id": "user-cet4-pdf",
        "title": "用户提供的大学英语四级词汇 PDF（乱序版）",
        "license": "用户提供资料；公开再分发许可尚未核实",
    },
    {
        "id": "user-cet6-pdf",
        "title": "用户提供的大学英语六级词汇 PDF（乱序版）",
        "license": "用户提供资料；公开再分发许可尚未核实",
    },
]

POS_LINE = re.compile(
    r"^(?:n\.|vt\.?|vi\.?|v\.|adj\.|a\.|adv\.|ad\.|prep\.|conj\.|pron\.|"
    r"art\.|num\.|int\.|abbr\.)",
    re.IGNORECASE,
)
HAN = re.compile(r"[\u4e00-\u9fff]")
VALID_HEADWORD = re.compile(r"^[\w&][\w&.'’'/-]*(?:\s+[\w&][\w&.'’'/-]*)*$", re.UNICODE)
PDF6_POS_TOKEN = r"(?:vt|vi|adj|adv|prep|conj|pron|num|int|art|abbr|n|v|a|ad)\."
PDF6_POS = re.compile(
    rf"(?i)([a-z][a-z’'\-]*(?:\([a-z]+\))?)\s*"
    rf"(({PDF6_POS_TOKEN})(?:&{PDF6_POS_TOKEN})*)\s*"
    r"(?=[^a-zA-Z]|aux(?:iliary)?\.?)"
)
PDF6_BARE_POS = re.compile(
    r"(?i)^([a-z][a-z’'\-]*(?:\([a-z]+\))?)\s+"
    r"(vt|vi|adj|adv|prep|conj|pron|num|int|art|abbr|n|v|a|ad)\s*"
    r"(?=[\u4e00-\u9fff(《])"
)

PDF4_CORRECTIONS = {
    "accommodatio": "accommodation",
    "inser": "insert",
    "recommendati on": "recommendation",
}

# Visible truncations in the supplied CET-6 PDF. These are corrected only when
# the meaning and the combined source vocabularies support the intended form.
PDF6_CORRECTIONS = {
    "rmost": "outermost",
    "outeintegral": "integral",
    "iinfinitely": "infinitely",
    "ndefinite": "indefinite",
    "ile": "tile",
    "twatt": "watt",
    "mishief": "mischief",
}


def clean_headword(raw: str) -> tuple[str, list[str]]:
    word = unicodedata.normalize("NFKC", raw).strip().replace("’", "'")
    word = re.sub(r"[\ue000-\uf8ff]", "-", word)
    word = word.replace("ˈ", "'").rstrip("*")
    word = re.sub(r"\s+", " ", word)
    aliases: list[str] = []
    # Legacy dictionary rows put spelling/inflection notes in parentheses or
    # after an equals sign. Keep the actual headword as the learning identity.
    if "=" in word:
        word, alternate = word.split("=", 1)
        aliases.extend(part.strip() for part in re.split(r"[,/;]", alternate) if part.strip())
    # Some legacy rows put a second spelling after the first in plain text.
    if word.casefold().startswith("can ") and "can't" in word.casefold():
        aliases.append("can't")
        forms = re.search(r"\(([^)]*)\)", word)
        if forms:
            aliases.extend(part.strip() for part in forms.group(1).split(",") if part.strip())
        word = "can"
    if word.casefold().startswith("does ") and "doesn" in word.casefold():
        aliases.append("does")
        aliases.append("doesn't")
        word = "do"
    if word.casefold().startswith("do ") and "don't" in word.casefold():
        aliases.append("don't")
        forms = re.search(r"\(([^)]*)\)", word)
        if forms:
            aliases.extend(part.strip() for part in forms.group(1).split(",") if part.strip())
        word = "do"
    slash = re.fullmatch(r"(.+?)\s*/\s*([^/]+)", word)
    if slash:
        word, alternate = slash.group(1).strip(), slash.group(2).strip()
        aliases.append(alternate)
    while True:
        alt = re.search(r"\(([^()]*)\)", word)
        if not alt:
            break
        form = alt.group(1).strip()
        base = word[:alt.start()].rstrip()
        tail = word[alt.end():].strip()
        if form:
            for item in re.split(r"[,;]", form):
                item = re.sub(r"^(?:pl\.|past|pp\.|p\.p\.|m/f)\s*", "", item.strip(), flags=re.I)
                if not item or item.casefold() in {"m/f", "f/m"}:
                    continue
                if item.startswith("-"):
                    aliases.append(base + item)
                elif item.casefold() in {"s", "es", "ies"}:
                    aliases.append(base + item)
                else:
                    aliases.append(item)
        word = " ".join(part for part in (base, tail) if part)
    # Remove explanatory spelling material after the first clear headword.
    # This also normalizes source rows such as "can (could) can't = ...".
    if word.casefold().startswith("can ") and "can't" in word.casefold():
        aliases.append("can't")
        word = "can"
    word = re.sub(r"\s+-\s*", "-", word)
    word = re.sub(r"\s+", " ", word).strip(" .;,:*\t\r\n")
    aliases = [re.sub(r"\s+", " ", a).strip(" .;,:*\t\r\n") for a in aliases]
    return word.strip(" .;,:"), aliases


def word_key(word: str) -> str:
    value = unicodedata.normalize("NFKC", word).casefold().replace("’", "'")
    value = re.sub(r"\s*[-‐‑‒–—]\s*", "-", value)
    return re.sub(r"\s+", " ", value).strip(" .;,:\t\r\n")


def add_word(
    index: dict[str, dict[str, Any]],
    *,
    word: str,
    book_id: str,
    source_id: str,
    meanings: list[dict[str, str]],
    phonetic: str = "",
    example: dict[str, str] | None = None,
    aliases: list[str] | None = None,
) -> bool:
    raw_word = word
    legacy_id = None
    if source_id == "legacy-project":
        legacy_id = "wd_" + re.sub(r"[^a-z0-9]", "", raw_word.casefold())
    word, inferred_aliases = clean_headword(word)
    if not word or not VALID_HEADWORD.fullmatch(word):
        return False
    key = word_key(word)
    if not key:
        return False
    entry = index.get(key)
    if entry is None:
        entry = {
            "id": key,
            "word": word,
            "phonetic": phonetic.strip(),
            "meanings": [],
            "example": None,
            "books": [],
            "sources": [],
            "aliases": [],
            "legacyIds": [],
        }
        index[key] = entry
    if book_id not in entry["books"]:
        entry["books"].append(book_id)
    if source_id not in entry["sources"]:
        entry["sources"].append(source_id)
    if legacy_id and legacy_id not in entry["legacyIds"]:
        entry["legacyIds"].append(legacy_id)
    if not entry["phonetic"] and phonetic.strip():
        entry["phonetic"] = phonetic.strip()
    if entry["example"] is None and example and example.get("english"):
        entry["example"] = example
    for alias in (aliases or []) + inferred_aliases:
        alias_key = word_key(alias)
        if alias_key and alias_key != key and alias not in entry["aliases"]:
            entry["aliases"].append(alias)
    known_meanings = {re.sub(r"\s+", " ", m["text"]).casefold() for m in entry["meanings"]}
    for meaning in meanings:
        text = re.sub(r"\s+", " ", meaning.get("text", "")).strip(" ;，,\t\r\n")
        if not text:
            continue
        pos = re.sub(r"\s+", "", meaning.get("pos", "")).strip(" .")
        dedupe_key = re.sub(r"\s+", " ", text).casefold()
        if dedupe_key in known_meanings:
            continue
        entry["meanings"].append({"pos": pos, "text": text})
        known_meanings.add(dedupe_key)
    # Retain compact learning data: a handful of translations and one example.
    if len(entry["meanings"]) > 10:
        del entry["meanings"][10:]
    return True


def parse_simple_lines(lines: list[str]) -> list[dict[str, Any]]:
    parsed: list[dict[str, Any]] = []
    current: dict[str, Any] = {}

    def flush() -> None:
        nonlocal current
        if current.get("word"):
            parsed.append(current)
        current = {}

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        if (line.startswith("[") and line.endswith("]")) or (
            line.startswith("/") and line.endswith("/")
        ):
            current["phonetic"] = line.strip("[]/").strip()
        elif HAN.search(line) or POS_LINE.match(line):
            current.setdefault("meanings", []).append(line)
        else:
            flush()
            current = {"word": line, "meanings": []}
    flush()
    return parsed


def parse_pos_meanings(lines: list[str]) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for line in lines:
        value = re.sub(r"\s+", " ", line).strip()
        match = re.match(
            r"(?i)^(n\.|vt\.?|vi\.?|v\.|adj\.|a\.|adv\.|ad\.|prep\.|conj\.|"
            r"pron\.|art\.|num\.|int\.|abbr\.)\s*(.*)$",
            value,
        )
        if match:
            result.append({"pos": match.group(1).rstrip("."), "text": match.group(2)})
        else:
            result.append({"pos": "", "text": value})
    return result


def add_legacy_source(
    index: dict[str, dict[str, Any]], source_file: Path, book_id: str, source_id: str
) -> int:
    text = source_file.read_text(encoding="utf-8")
    if source_file.suffix == ".ts":
        match = re.search(r"`([\s\S]*?)`", text)
        if not match:
            return 0
        text = match.group(1)
    parsed = parse_simple_lines(text.splitlines())
    added = 0
    for record in parsed:
        if add_word(
            index,
            word=record["word"],
            book_id=book_id,
            source_id=source_id,
            meanings=parse_pos_meanings(record.get("meanings", [])),
            phonetic=record.get("phonetic", ""),
        ):
            added += 1
    return added


def add_kyle_book(
    index: dict[str, dict[str, Any]], root: Path, name: str, book_id: str
) -> int:
    path = root / "full_line_jsonl" / "full" / "正序" / f"{name}.jsonl"
    if not path.exists():
        raise FileNotFoundError(f"KyleBing full JSONL not found: {path}")
    count = 0
    with path.open("r", encoding="utf-8") as stream:
        for line in stream:
            row = json.loads(line)
            word_data = row.get("content", {}).get("word", {})
            content = word_data.get("content", {})
            word = row.get("headWord") or word_data.get("wordHead") or ""
            translations = content.get("trans", []) or []
            meanings = [
                {"pos": str(item.get("pos", "")), "text": str(item.get("tranCn", ""))}
                for item in translations
                if item.get("tranCn")
            ]
            if not meanings:
                synos = content.get("syno", {}).get("synos", [])
                meanings = [
                    {"pos": str(item.get("pos", "")), "text": str(item.get("tran", ""))}
                    for item in synos
                    if item.get("tran")
                ]
            phonetic_parts = []
            for label, key in (("US", "usphone"), ("UK", "ukphone")):
                value = str(content.get(key, "")).strip()
                if value:
                    phonetic_parts.append(f"{label} /{value}/")
            sentences = content.get("sentence", {}).get("sentences", [])
            example = None
            for sentence in sentences:
                english = re.sub(r"<[^>]+>", "", str(sentence.get("sContent", ""))).strip()
                chinese = str(sentence.get("sCn", "")).strip()
                if english:
                    example = {"english": english, "chinese": chinese}
                    break
            if add_word(
                index,
                word=str(word),
                book_id=book_id,
                source_id="kylebing",
                meanings=meanings,
                phonetic=" · ".join(phonetic_parts),
                example=example,
            ):
                count += 1
    return count


def import_cet4_pdf(index: dict[str, dict[str, Any]], path: Path) -> tuple[int, int]:
    entries = skipped = 0
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                for row in table:
                    if len(row) < 4 or not row[0] or not str(row[0]).strip().isdigit():
                        continue
                    word = str(row[1] or "").strip()
                    if not word:
                        skipped += 1
                        continue
                    phonetic = re.sub(r"\s+", "", str(row[2] or ""))
                    meaning = re.sub(r"\s+", " ", str(row[3] or "")).strip()
                    word = PDF4_CORRECTIONS.get(word.casefold(), word)
                    if word == "insert" and meaning.casefold().startswith("t vt."):
                        meaning = meaning[1:].lstrip()
                    meaning = re.sub(r"^advS\.", "adv.", meaning, flags=re.IGNORECASE)
                    if not meaning or not add_word(
                        index,
                        word=word,
                        book_id="cet4",
                        source_id="user-cet4-pdf",
                        meanings=[{"pos": "", "text": meaning}],
                        phonetic=phonetic,
                    ):
                        skipped += 1
                    else:
                        entries += 1
    return entries, skipped


def import_cet6_pdf(index: dict[str, dict[str, Any]], path: Path) -> tuple[int, int, list[str]]:
    entries = skipped = 0
    skipped_samples: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                for row in table:
                    for cell in row:
                        if not cell or not re.search(r"[A-Za-z]", cell):
                            continue
                        flat = re.sub(r"\s+", " ", cell).strip()
                        modal = re.match(r"(?i)^(should|ought)\s+v\.aux\.(.*)$", flat)
                        if modal:
                            word, pos, meaning = modal.group(1), "v.aux", modal.group(2).strip()
                        elif "统计，统计数字" in flat and re.search(r"\bsta\b", flat, re.IGNORECASE):
                            word, pos, meaning = "statistics", "n", "统计，统计数字"
                        else:
                            match = PDF6_POS.search(flat)
                        if modal or ("统计，统计数字" in flat and re.search(r"\bsta\b", flat, re.IGNORECASE)):
                            pass
                        elif (bare_pos := PDF6_BARE_POS.search(flat)):
                            word = bare_pos.group(1)
                            pos = bare_pos.group(2)
                            meaning = flat[bare_pos.end():].strip(" ;，,")
                        elif match:
                            word = match.group(1)
                            pos = match.group(2).replace(".", "")
                            meaning = flat[match.end():].strip(" ;，,")
                        else:
                            fallback = re.search(
                                r"(?i)([a-z][a-z’'\-]*(?:\([a-z]+\))?)\s+([\u4e00-\u9fff].+)",
                                flat,
                            )
                            if not fallback:
                                skipped += 1
                                if len(skipped_samples) < 40:
                                    skipped_samples.append(flat)
                                continue
                            word, meaning = fallback.group(1), fallback.group(2)
                            pos = ""
                        leading_cjk = HAN.search(flat)
                        pre_meaning = flat[:leading_cjk.start()] if leading_cjk else flat
                        stray_letters = re.findall(r"(?<![A-Za-z])[A-Za-z](?![A-Za-z])", pre_meaning)
                        if (len(word) == 1 and word.casefold() not in {"a", "i"}) or len(stray_letters) >= 4:
                            skipped += 1
                            if len(skipped_samples) < 40:
                                skipped_samples.append(flat)
                            continue
                        word = PDF6_CORRECTIONS.get(word.casefold(), word)
                        if not meaning or not add_word(
                            index,
                            word=word,
                            book_id="cet6",
                            source_id="user-cet6-pdf",
                            meanings=[{"pos": pos, "text": meaning}],
                        ):
                            skipped += 1
                            if len(skipped_samples) < 40:
                                skipped_samples.append(flat)
                        else:
                            entries += 1
    return entries, skipped, skipped_samples


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kyle-root", type=Path, default=Path("../english-vocabulary"))
    parser.add_argument("--gaokao-root", type=Path, default=Path("../word3500"))
    parser.add_argument("--cet4-pdf", type=Path)
    parser.add_argument("--cet6-pdf", type=Path)
    parser.add_argument("--out", type=Path, default=Path("public/data/lexicon.json"))
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    index: dict[str, dict[str, Any]] = {}
    counts: Counter[str] = Counter()
    for source_name, book_id in KYLE_BOOKS.items():
        counts[f"kyle:{source_name}"] = add_kyle_book(index, args.kyle_root, source_name, book_id)

    gaokao_count = add_legacy_source(index, args.gaokao_root / "3500.txt", "senior-high", "word3500")
    legacy_files = [Path("scripts/data/legacy_chunk1.txt"), Path("scripts/data/legacy_chunk2.txt"), Path("scripts/data/legacy_chunk3.txt")]
    legacy_count = 0
    for source_file in legacy_files:
        if source_file.exists():
            legacy_count += add_legacy_source(index, source_file, "senior-high", "legacy-project")
    counts["word3500"] = gaokao_count
    counts["legacy-project"] = legacy_count

    if args.cet4_pdf:
        counts["user-cet4-pdf"], counts["user-cet4-pdf-skipped"] = import_cet4_pdf(index, args.cet4_pdf)
    if args.cet6_pdf:
        counts["user-cet6-pdf"], counts["user-cet6-pdf-skipped"], skipped6 = import_cet6_pdf(index, args.cet6_pdf)
    else:
        skipped6 = []

    for entry in index.values():
        entry["books"].sort()
        entry["sources"].sort()
        entry["aliases"].sort()
    book_counts = {
        book["id"]: sum(book["id"] in entry["books"] for entry in index.values())
        for book in BOOKS
    }
    active_sources = [
        source
        for source in SOURCES
        if source["id"] in {source_id for entry in index.values() for source_id in entry["sources"]}
    ]
    payload = {
        "version": 1,
        "books": BOOKS,
        "sources": active_sources,
        "bookCounts": book_counts,
        "words": sorted(index.values(), key=lambda entry: entry["id"]),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    report = {
        "sourceRows": dict(counts),
        "uniqueWords": len(index),
        "bookCounts": book_counts,
        "pdf6SkippedSamples": skipped6,
        "outputBytes": args.out.stat().st_size,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
