# Packaged SQLite Native Bindings

Each directory contains one exact `better-sqlite3` runtime target:

```txt
<platform>-<architecture>-abi<module ABI>/better_sqlite3.node
```

The plugin selects a binding from the installed plugin directory using
`process.platform`, `process.arch`, and `process.versions.modules`. It does not
fall back across ABIs or architectures because loading an incompatible native
module can crash or corrupt startup behavior.

Currently packaged and tested:

- `darwin-arm64-abi140`: Apple Silicon macOS, tested with Obsidian 1.12.7 /
  Electron 39.8.3.

Add and test a separate exact-target directory before releasing for another
platform, architecture, or Electron module ABI.
