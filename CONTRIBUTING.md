# Contributing

## Development

```sh
bun install
bun run build        # every package's dist/ (JS + .d.ts)
```

Package `exports` point at `dist/`, so tests, examples and the docs site run
against built output: rebuild (or run a package's `tsc -b --watch`) after
changing a dependency. Editors don't need a build; TypeScript project
references point them at sibling packages' sources.

## Releasing

All published packages share one version (Nx Release, fixed mode).

```sh
bun run release:version 0.0.22   # bump every package, commit, tag
git push --follow-tags
```

Then run the **Release** workflow on GitHub (leave "dry run" on to check
first). It builds, lints the packages with publint, and runs
`nx release publish`, which skips versions already on npm and publishes the
rest via OIDC trusted publishing.

To try packages locally before releasing:

```sh
bun run build && bun run pack   # tarballs in packs/
```
