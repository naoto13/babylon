// Backward-compatible entry point. The old one-file cauldron generator could
// overwrite a supplied cauldron, so all generation now follows the guarded
// multi-prop implementation. `--force` is intentionally forwarded unchanged.
console.info("make-test-glb.mjs is deprecated; using make-placeholder-glbs.mjs");
await import("./make-placeholder-glbs.mjs");
