/*
 * checkMain.ts — reduced-scope CLI entry for scriptc-native fence iteration.
 *
 * Single-threaded typecheck only: `pyright <files...>` plus --project,
 * --outputjson, --verbose, --pythonversion/--pythonplatform/--pythonpath,
 * --venvpath, --typeshedpath, --skipunannotated, --level, --warnings,
 * --version. Everything that pulls verifier/stubgen/worker/watch machinery
 * out of the bundle is dropped (--verifytypes, --createstub, --threads,
 * --watch, --dependencies, --stats, stdin file list). Keep the full CLI as
 * the parity target; this is the fast fence-verification build.
 */

import { parseArgs } from 'node:util';

import { AnalysisResults } from './analyzer/analysis';
import { AnalyzerService } from './analyzer/service';
import { timingStats } from './common/timing';
import { ChokidarFileWatcherProvider } from './common/chokidarFileWatcherProvider';
import { CommandLineOptions as PyrightCommandLineOptions } from './common/commandLineOptions';
import { LogLevel, StandardConsole, StderrConsole } from './common/console';
import { fail } from './common/debug';
import { createDeferred } from './common/deferred';
import { Diagnostic, DiagnosticCategory, compareDiagnostics } from './common/diagnostic';
import { FileDiagnostics } from './common/diagnosticSink';
import { FullAccessHost } from './common/fullAccessHost';
import { combinePaths, normalizePath } from './common/pathUtils';
import { PythonVersion } from './common/pythonVersion';
import { RealTempFile, createFromRealFileSystem } from './common/realFileSystem';
import { createServiceProvider } from './common/serviceProviderExtensions';
import { Range, isEmptyRange } from './common/textRange';
import { Uri } from './common/uri/uri';
import { getFileSpec, tryStat } from './common/uri/uriUtils';
import { PyrightFileSystem } from './pyrightFileSystem';

function getVersionString(): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const version = require('../package.json').version;
    return version.toString();
}

type SeverityLevel = 'error' | 'warning' | 'information';

enum ExitStatus {
    NoErrors = 0,
    ErrorsReported = 1,
    FatalError = 2,
    ConfigFileParseError = 3,
    ParameterError = 4,
}

interface PyrightJsonDiagnostic {
    file: string;
    severity: SeverityLevel;
    message: string;
    range?: Range | undefined;
    rule?: string | undefined;
}

interface PyrightJsonResults {
    version: string;
    time: string;
    generalDiagnostics: PyrightJsonDiagnostic[];
    summary: {
        filesAnalyzed: number;
        errorCount: number;
        warningCount: number;
        informationCount: number;
        timeInSec: number;
    };
}

function convertSeverity(category: DiagnosticCategory): SeverityLevel {
    switch (category) {
        case DiagnosticCategory.Error:
            return 'error';
        case DiagnosticCategory.Warning:
            return 'warning';
        case DiagnosticCategory.Information:
            return 'information';
        default:
            fail('Unexpected diagnostic category');
    }
}

function isIncluded(sev: SeverityLevel, min: SeverityLevel): boolean {
    if (sev === 'error') return true;
    if (sev === 'warning') return min !== 'error';
    return min === 'information';
}

function toJsonDiag(filePath: string, diag: Diagnostic): PyrightJsonDiagnostic {
    return {
        file: filePath,
        severity: convertSeverity(diag.category),
        message: diag.message,
        range: isEmptyRange(diag.range) ? undefined : diag.range,
        rule: diag.getRule(),
    };
}

export async function main(): Promise<void> {
    const { values: args, positionals } = parseArgs({
        args: process.argv.slice(2),
        options: {
            files: { type: 'string', multiple: true },
            help: { type: 'boolean', short: 'h' },
            level: { type: 'string' },
            outputjson: { type: 'boolean' },
            project: { type: 'string', short: 'p' },
            pythonpath: { type: 'string' },
            pythonplatform: { type: 'string' },
            pythonversion: { type: 'string' },
            skipunannotated: { type: 'boolean' },
            typeshedpath: { type: 'string', short: 't' },
            venvpath: { type: 'string', short: 'v' },
            verbose: { type: 'boolean' },
            version: { type: 'boolean' },
            warnings: { type: 'boolean' },
        },
        allowPositionals: true,
    });

    if (args.version !== undefined) {
        console.info(`pyright-check ${getVersionString()}`);
        process.exitCode = ExitStatus.NoErrors;
        return;
    }
    if (args.help !== undefined) {
        console.info('Usage: pyright-check [options] files...');
        process.exitCode = ExitStatus.NoErrors;
        return;
    }

    const options = new PyrightCommandLineOptions(process.cwd(), false);
    const tempFile = new RealTempFile();

    const fileSpecs = [...(args.files ?? []), ...positionals];
    if (fileSpecs.length > 0) {
        options.configSettings.includeFileSpecsOverride = fileSpecs.map((f) => combinePaths(process.cwd(), f));
        const tempFileSystem = new PyrightFileSystem(createFromRealFileSystem(tempFile));
        for (const fileDesc of options.configSettings.includeFileSpecsOverride) {
            const includeSpec = getFileSpec(Uri.file(process.cwd(), tempFile), fileDesc);
            if (!tryStat(tempFileSystem, includeSpec.wildcardRoot)) {
                console.error(`File or directory "${includeSpec.wildcardRoot.toUserVisibleString()}" does not exist`);
                process.exitCode = ExitStatus.ParameterError;
                return;
            }
        }
    }

    if (args.project) options.configFilePath = combinePaths(process.cwd(), normalizePath(args.project));
    if (args.pythonplatform) options.configSettings.pythonPlatform = args.pythonplatform;
    if (args.pythonversion) {
        const version = PythonVersion.fromString(args.pythonversion);
        if (!version) {
            console.error(`'${args.pythonversion}' is not a supported Python version`);
            process.exitCode = ExitStatus.ParameterError;
            return;
        }
        options.configSettings.pythonVersion = version;
    }
    if (args.pythonpath !== undefined)
        options.configSettings.pythonPath = combinePaths(process.cwd(), normalizePath(args.pythonpath));
    if (args.venvpath !== undefined)
        options.configSettings.venvPath = combinePaths(process.cwd(), normalizePath(args.venvpath));
    if (args.typeshedpath !== undefined)
        options.configSettings.typeshedPath = combinePaths(process.cwd(), normalizePath(args.typeshedpath));
    if (args.skipunannotated) options.configSettings.analyzeUnannotatedFunctions = false;
    if (args.verbose) options.configSettings.verboseOutput = true;

    options.configSettings.autoSearchPaths = true;
    options.languageServerSettings.checkOnlyOpenFiles = false;

    let minSeverityLevel: SeverityLevel = 'information';
    if (args.level) {
        const level = args.level.toLowerCase();
        if (level === 'error' || level === 'warning') minSeverityLevel = level;
    }

    const logLevel = args.verbose ? LogLevel.Info : LogLevel.Error;
    const output = args.outputjson ? new StderrConsole(logLevel) : new StandardConsole(logLevel);
    const fileSystem = new PyrightFileSystem(
        createFromRealFileSystem(tempFile, output, new ChokidarFileWatcherProvider(output))
    );
    const serviceProvider = createServiceProvider(fileSystem, output, tempFile);
    const service = new AnalyzerService('<default>', serviceProvider, {
        console: output,
        hostFactory: () => new FullAccessHost(serviceProvider),
        libraryReanalysisTimeProvider: () => 2 * 1000,
        shouldRunAnalysis: () => true,
    });

    const exitStatus = createDeferred<ExitStatus>();
    service.setCompletionCallback((results: AnalysisResults) => {
        if (results.fatalErrorOccurred) {
            exitStatus.resolve(ExitStatus.FatalError);
            return;
        }
        if (results.configParseErrorOccurred) {
            exitStatus.resolve(ExitStatus.ConfigFileParseError);
            return;
        }

        let errorCount = 0;
        const fileDiagnostics = results.diagnostics.sort((a, b) =>
            a.fileUri.toString() < b.fileUri.toString() ? -1 : 1
        );

        if (args.outputjson) {
            const report: PyrightJsonResults = {
                version: getVersionString(),
                time: Date.now().toString(),
                generalDiagnostics: [],
                summary: {
                    filesAnalyzed: results.filesInProgram,
                    errorCount: 0,
                    warningCount: 0,
                    informationCount: 0,
                    timeInSec: results.elapsedTime,
                },
            };
            for (const fileDiag of fileDiagnostics) {
                for (const diag of fileDiag.diagnostics.sort(compareDiagnostics)) {
                    if (
                        diag.category === DiagnosticCategory.Error ||
                        diag.category === DiagnosticCategory.Warning ||
                        diag.category === DiagnosticCategory.Information
                    ) {
                        const jsonDiag = toJsonDiag(fileDiag.fileUri.getFilePath(), diag);
                        if (isIncluded(jsonDiag.severity, minSeverityLevel))
                            report.generalDiagnostics.push(jsonDiag);
                        if (jsonDiag.severity === 'error') report.summary.errorCount++;
                        else if (jsonDiag.severity === 'warning') report.summary.warningCount++;
                        else report.summary.informationCount++;
                    }
                }
            }
            console.info(JSON.stringify(report, undefined, 4));
            errorCount = report.summary.errorCount;
        } else {
            console.info(`pyright-check ${getVersionString()}`);
            for (const fileDiag of fileDiagnostics) {
                const shown = fileDiag.diagnostics
                    .filter(
                        (d) =>
                            d.category !== DiagnosticCategory.UnusedCode &&
                            d.category !== DiagnosticCategory.UnreachableCode &&
                            d.category !== DiagnosticCategory.Deprecated &&
                            isIncluded(convertSeverity(d.category), minSeverityLevel)
                    )
                    .sort(compareDiagnostics);
                if (shown.length === 0) continue;
                console.info(`${fileDiag.fileUri.toUserVisibleString()}`);
                for (const diag of shown) {
                    const jd = toJsonDiag(fileDiag.fileUri.getFilePath(), diag);
                    const line = diag.range && !isEmptyRange(diag.range) ? diag.range.start.line + 1 : 0;
                    const col = diag.range && !isEmptyRange(diag.range) ? diag.range.start.character + 1 : 0;
                    const rule = jd.rule ? ` (${jd.rule})` : '';
                    console.info(`  ${line}:${col} - ${jd.severity}: ${jd.message}${rule}`);
                    if (jd.severity === 'error') errorCount++;
                    if (jd.severity === 'warning' && args.warnings) errorCount++;
                }
            }
            output.info(`Completed in ${results.elapsedTime}sec`);
        }

        if (!args.outputjson) timingStats.printSummary(output);
        exitStatus.resolve(errorCount > 0 ? ExitStatus.ErrorsReported : ExitStatus.NoErrors);
    });

    service.setOptions(options);
    service.enumerateSourceFiles(0);
    process.exitCode = await exitStatus.promise;
}
