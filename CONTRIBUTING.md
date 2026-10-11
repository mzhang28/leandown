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

All published packages share one version (Nx Release, fixed mode). Bumping
and publishing are separate commands:

```sh
bun run release:version 0.0.22   # bump every package, commit, tag v0.0.22
bun run release:publish          # build and publish every package to npm
```

`release:publish` uses your `npm login` credentials, builds each package
first, and skips versions already on npm, so a failed run can be re-run. Add
`--dry-run` to either command to preview it. Push the commit and tag with
`git push --follow-tags`.

The **Release** workflow on GitHub runs the same publish step in CI with OIDC
trusted publishing instead of your credentials.

To try packages locally before releasing:

```sh
bun run build && bun run pack   # tarballs in packs/
```
