import { AnalyzerService } from '../../pyright-internal/src/analyzer/service';
import { createServiceProvider } from '../../pyright-internal/src/common/serviceProviderExtensions';
import { FullAccessHost } from '../../pyright-internal/src/common/fullAccessHost';
console.log('imports ok', typeof AnalyzerService, typeof createServiceProvider, typeof FullAccessHost);
