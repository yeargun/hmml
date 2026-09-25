// Explicit worker entry. This is the only module with registration side effects.
import { serveDecodeWorker } from "./worker-host";
serveDecodeWorker(self);
