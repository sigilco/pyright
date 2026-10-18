const path = require('path');
const { createRequire } = require('module');
const { monorepoResourceNameMapper, tsconfigResolveAliases } = require('../../build/lib/webpack');

const rspack = createRequire(__filename)('@rspack/core');
// Development builds go to a sibling dir so they can't clobber or be mistaken
// for the production bundle; they also skip minification, which keeps the
// emitted JS closer to the authored source (needed by the scriptc probe).
const devOutPath = path.resolve(__dirname, 'dist-cli-dev');
const typeshedFallback = path.resolve(__dirname, '..', 'pyright-internal', 'typeshed-fallback');

// Single-file CLI-only variant of rspack.config.js: emits just the typecheck
// CLI entry (no langserver) with split chunks disabled so the output is one
// self-contained dist-cli/pyright.js, plus a typeshed-fallback copy. Used by
// the native-binary POC (bun --compile). The default build is untouched.
/** @type {(env: any, argv: { mode: 'production' | 'development' | 'none' }) => any} */
module.exports = (_, { mode }) => {
    const outPath = mode === 'development' ? devOutPath : path.resolve(__dirname, 'dist-cli');
    return {
        context: __dirname,
        entry: {
            pyright: './src/pyright.ts',
        },
        target: 'node',
        output: {
            filename: '[name].js',
            path: outPath,
            devtoolModuleFilenameTemplate:
                mode === 'development' ? '../[resource-path]' : monorepoResourceNameMapper('pyright'),
            clean: true,
        },
        devtool: mode === 'development' ? 'source-map' : 'nosources-source-map',
        cache: mode === 'development',
        stats: {
            all: false,
            errors: true,
            warnings: true,
            publicPath: true,
            timings: true,
        },
        resolve: {
            extensions: ['.ts', '.js'],
            alias: tsconfigResolveAliases('tsconfig.json'),
        },
        externals: {
            fsevents: 'commonjs2 fsevents',
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    loader: 'ts-loader',
                    options: {
                        configFile: path.resolve(__dirname, 'tsconfig.json'),
                    },
                },
                {
                    test: /\.js$/,
                    loader: 'esbuild-loader',
                    options: {
                        target: 'node12',
                    },
                },
            ],
        },
        plugins: [new rspack.CopyRspackPlugin({ patterns: [{ from: typeshedFallback, to: 'typeshed-fallback' }] })],
        optimization: {
            splitChunks: false,
            // Dev mode: hoist ESM modules into the entry scope. Keeping module
            // contents at top level matters for the scriptc native probe —
            // classes inside webpack module closures hit an engine fence.
            concatenateModules: mode === 'development',
        },
    };
};
