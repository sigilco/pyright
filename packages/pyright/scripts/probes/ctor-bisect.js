import { CommandLineOptions } from '../../pyright-internal/src/common/commandLineOptions';
import { StandardConsole, LogLevel } from '../../pyright-internal/src/common/console';
import { RealTempFile } from '../../pyright-internal/src/common/realFileSystem';
const c = new StandardConsole(LogLevel.Info);
console.log('console ok');
const t = new RealTempFile();
console.log('tempfile ok');
const o = new CommandLineOptions('/tmp', false);
console.log('options ok', o.executionRoot);
