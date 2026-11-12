import { parentPort, workerData } from 'node:worker_threads';
import { indexTypeScript } from './typescriptIndex';
import { IndexRequest } from './model';

try {
    const graph = indexTypeScript(workerData as IndexRequest, message => parentPort?.postMessage({ type: 'progress', message }));
    parentPort?.postMessage({ type: 'result', graph });
} catch (error) {
    parentPort?.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
}
