#!/usr/bin/env python3
"""Generate a textureless code-only factory from a strict img2threejs sculpt spec.

The authoritative spec keeps reference-PBR paths because upstream strict validation uses
them as evidence.  Runtime output must not load those files, so this adapter validates the
authoritative spec first, strips evidence-only paths from an in-memory copy, calls the
official generator, removes the now-unreachable external texture loader helpers, and makes
procedural canvas maps explicit opt-in.  The default runtime therefore uses authored flat
PBR values, which is the textureless contract expected by this repository.

No component, transform, geometry descriptor, rig, or material response number is changed.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from typing import Any


EXPECTED_IMG2THREEJS_COMMIT = "d6673386f89673a58736f8d398dd16ece67874f5"
EVIDENCE_ONLY_KEYS = {
    "evidencePath",
    "evidencePaths",
    "evidenceRef",
    "evidenceRefs",
    "materialEvidence",
    "materialReference",
    "referenceMaterialId",
    "referencePbr",
    "sourceImage",
    "sourceImages",
}
PATH_KEYS = {"path", "url"}
RUNTIME_FIELD_ID = "independent-runtime-canvas-field"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--official-root", type=Path, required=True)
    parser.add_argument("--spec", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--pass-id", default="blockout")
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def canonical_hash(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return sha256_bytes(payload.encode("utf-8"))


def git_commit(repo: Path) -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def load_generator(path: Path) -> ModuleType:
    # Running the upstream file as a CLI implicitly adds its directory to sys.path.
    # Recreate that condition before importing the same file as a module.
    sys.path.insert(0, str(path.parent))
    module_spec = importlib.util.spec_from_file_location("img2threejs_official_generator", path)
    if module_spec is None or module_spec.loader is None:
        raise RuntimeError(f"cannot import official generator: {path}")
    module = importlib.util.module_from_spec(module_spec)
    sys.modules[module_spec.name] = module
    module_spec.loader.exec_module(module)
    return module


def sanitize_runtime_value(value: Any, stats: dict[str, int], key: str = "") -> Any:
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for child_key, child_value in value.items():
            if child_key in EVIDENCE_ONLY_KEYS or child_key in PATH_KEYS:
                stats[child_key] = stats.get(child_key, 0) + 1
                continue
            if child_key in {"map", "heightSource"} and isinstance(child_value, dict):
                stats[f"{child_key}Object"] = stats.get(f"{child_key}Object", 0) + 1
                cleaned[child_key] = RUNTIME_FIELD_ID
                continue
            cleaned[child_key] = sanitize_runtime_value(child_value, stats, child_key)
        return cleaned
    if isinstance(value, list):
        return [sanitize_runtime_value(item, stats, key) for item in value]
    return value


def remove_external_loader_helpers(rendered: str) -> str:
    start_marker = "function referenceMapUrl("
    end_marker = "function makeProceduralTextureSet("
    start = rendered.find(start_marker)
    end = rendered.find(end_marker)
    if start < 0 or end < 0 or end <= start:
        raise RuntimeError("official generator texture-loader helper boundaries changed")
    rendered = rendered[:start] + rendered[end:]
    upstream_call = (
        "const textures = makeReferenceTextureSet(spec, options) "
        "?? makeProceduralTextureSet(id, spec, options);"
    )
    runtime_call = "const textures = makeProceduralTextureSet(id, spec, options);"
    if upstream_call not in rendered:
        raise RuntimeError("official generator material texture selection changed")
    return rendered.replace(upstream_call, runtime_call, 1)


def add_procedural_texture_opt_in(rendered: str) -> str:
    option_anchor = "  qualityPriority?: 'reference-fidelity' | 'balanced';\n};"
    option_replacement = (
        "  qualityPriority?: 'reference-fidelity' | 'balanced';\n"
        "  proceduralTextures?: boolean;\n"
        "};"
    )
    if rendered.count(option_anchor) != 1:
        raise RuntimeError("official generator options interface changed")
    rendered = rendered.replace(option_anchor, option_replacement, 1)

    function_anchor = (
        "function makeProceduralTextureSet(\n"
        "  id: string,\n"
        "  spec: SculptMaterialSpec,\n"
        "  options: ProceduralModelOptions,\n"
        "): ProceduralTextureSet | null {\n"
        "  if (typeof document === 'undefined') return null;"
    )
    function_replacement = (
        "function makeProceduralTextureSet(\n"
        "  id: string,\n"
        "  spec: SculptMaterialSpec,\n"
        "  options: ProceduralModelOptions,\n"
        "): ProceduralTextureSet | null {\n"
        "  if (options.proceduralTextures !== true || typeof document === 'undefined') return null;"
    )
    if rendered.count(function_anchor) != 1:
        raise RuntimeError("official generator procedural texture function changed")
    return rendered.replace(function_anchor, function_replacement, 1)


def contract_scan(rendered: str) -> dict[str, Any]:
    rules = {
        "glbLoader": r"GLTFLoader",
        "textureLoader": r"TextureLoader",
        "glbExtension": r"\.glb(?:[^A-Za-z0-9]|$)",
        "imageExtension": r"\.(?:png|jpe?g|webp|avif)(?:[^A-Za-z0-9]|$)",
        "remoteUrl": r"https?://",
        "dataPayload": r"data:(?:model/gltf|application/octet-stream|image/)|;base64,",
        "absoluteUserPath": r"/Users/",
    }
    matches = {
        name: len(re.findall(pattern, rendered, flags=re.IGNORECASE))
        for name, pattern in rules.items()
    }
    return {"status": "GO" if not any(matches.values()) else "NO-GO", "matches": matches}


def main() -> int:
    args = parse_args()
    official_root = args.official_root.expanduser().resolve()
    spec_path = args.spec.expanduser().resolve()
    output_path = args.out.expanduser().resolve()
    manifest_path = args.manifest.expanduser().resolve()
    generator_path = official_root / "forge/stage3_build/generate_threejs_factory.py"

    for path in (spec_path, generator_path):
        if not path.is_file():
            raise FileNotFoundError(path)
    if output_path.exists() and not args.force:
        raise FileExistsError(f"output exists; use --force: {output_path}")

    commit = git_commit(official_root)
    if commit != EXPECTED_IMG2THREEJS_COMMIT:
        raise RuntimeError(
            f"official img2threejs commit mismatch: {commit} != {EXPECTED_IMG2THREEJS_COMMIT}"
        )

    authoritative_spec = json.loads(spec_path.read_text(encoding="utf-8"))
    if not isinstance(authoritative_spec, dict):
        raise ValueError("spec root must be an object")
    generator = load_generator(generator_path)
    errors, warnings, strict_failures = generator.strict_quality_failures(authoritative_spec)
    if strict_failures:
        raise RuntimeError("strict authoritative spec is blocked: " + "; ".join(strict_failures))
    generator.assert_pass_unlocked(authoritative_spec, args.pass_id)
    gaps = generator.pass_specific_gaps(authoritative_spec, args.pass_id)
    if gaps:
        raise RuntimeError(f"pass {args.pass_id!r} has gaps: {'; '.join(gaps)}")

    runtime_spec = copy.deepcopy(authoritative_spec)
    before_geometry_hash = canonical_hash(
        {
            "componentTree": authoritative_spec.get("componentTree"),
            "repetitionSystems": authoritative_spec.get("repetitionSystems"),
            "rig": authoritative_spec.get("rig"),
        }
    )
    stats: dict[str, int] = {}
    runtime_spec["materials"] = sanitize_runtime_value(runtime_spec.get("materials", []), stats)
    if "materialPipeline" in runtime_spec:
        runtime_spec["materialPipeline"] = sanitize_runtime_value(
            runtime_spec["materialPipeline"], stats
        )
    if "materialReference" in runtime_spec:
        runtime_spec["materialReference"] = sanitize_runtime_value(
            runtime_spec["materialReference"], stats
        )
    after_geometry_hash = canonical_hash(
        {
            "componentTree": runtime_spec.get("componentTree"),
            "repetitionSystems": runtime_spec.get("repetitionSystems"),
            "rig": runtime_spec.get("rig"),
        }
    )
    if before_geometry_hash != after_geometry_hash:
        raise RuntimeError("runtime evidence sanitization changed geometry, repetition, or rig data")

    upstream_rendered = generator.generate(runtime_spec, args.pass_id)
    rendered = remove_external_loader_helpers(upstream_rendered)
    rendered = add_procedural_texture_opt_in(rendered)
    header = (
        "// Runtime policy adapter: strict evidence retained only in the authoritative spec.\n"
        f"// Official img2threejs commit: {commit}\n"
        "// External GLB and image loading are intentionally absent from this factory.\n"
    )
    rendered = header + rendered
    scan = contract_scan(rendered)
    if scan["status"] != "GO":
        raise RuntimeError(f"runtime dependency contract failed: {scan['matches']}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(rendered, encoding="utf-8")
    manifest = {
        "status": "GO",
        "route": "strict-spec-to-code-only-runtime",
        "passId": args.pass_id,
        "authoritativeSpec": {
            "path": str(spec_path),
            "sha256": sha256_file(spec_path),
            "strictErrorCount": len(errors),
            "strictWarningCount": len(warnings),
            "strictFailureCount": len(strict_failures),
        },
        "officialImg2threejs": {
            "root": str(official_root),
            "commit": commit,
            "generatorPath": str(generator_path),
            "generatorSha256": sha256_file(generator_path),
        },
        "runtimeDerivation": {
            "persistedRuntimeSpec": False,
            "evidenceOnlyFieldsRemoved": dict(sorted(stats.items())),
            "geometryRigHashBefore": before_geometry_hash,
            "geometryRigHashAfter": after_geometry_hash,
            "upstreamGeneratedSha256": sha256_bytes(upstream_rendered.encode("utf-8")),
            "externalTextureHelpersRemoved": True,
            "proceduralCanvasTexturesDefault": False,
            "policy": "flat authored PBR by default; optional procedural CanvasTexture maps; no external GLB or image runtime dependency",
        },
        "factory": {
            "path": str(output_path),
            "sha256": sha256_file(output_path),
            "bytes": output_path.stat().st_size,
        },
        "contractScan": scan,
    }
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
