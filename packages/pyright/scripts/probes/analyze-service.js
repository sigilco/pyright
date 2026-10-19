// Probe: run real program.analyze() on /tmp/fixture-run in-process.
import { CommandLineOptions } from '../../pyright-internal/src/common/commandLineOptions';
import { createFromRealFileSystem, RealTempFile } from '../../pyright-internal/src/common/realFileSystem';
import { PyrightFileSystem } from '../../pyright-internal/src/pyrightFileSystem';
import { createServiceProvider } from '../../pyright-internal/src/common/serviceProviderExtensions';
import { AnalyzerService } from '../../pyright-internal/src/analyzer/service';
import { FullAccessHost } from '../../pyright-internal/src/common/fullAccessHost';
import { StandardConsole, LogLevel } from '../../pyright-internal/src/common/console';
import { combinePaths } from '../../pyright-internal/src/common/pathUtils';

const root = '/tmp/fixture-run';
const options = new CommandLineOptions(root, false);
options.configSettings.includeFileSpecsOverride = [combinePaths(root, '.')];
console.log('opts ok');
const tempFile = new RealTempFile();
console.log('tf ok');
const output = new StandardConsole(LogLevel.Info);
console.log('con ok');
const fileSystem = new PyrightFileSystem(createFromRealFileSystem(tempFile, output));
console.log('fs ok');
const serviceProvider = createServiceProvider(fileSystem, output, tempFile);
console.log('sp ok');
const service = new AnalyzerService('<default>', serviceProvider, {
    console: output,
    hostFactory: () => new FullAccessHost(serviceProvider),
    libraryReanalysisTimeProvider: () => 2000,
    skipScanningUserFiles: false,
    shouldRunAnalysis: () => true,
});
console.log('service ok');
service.setCompletionCallback((results) => {
    console.log('CB fatal=', results.fatalErrorOccurred);
});
service.setOptions(options);
console.log('analyze:', service.test_program.analyze());
