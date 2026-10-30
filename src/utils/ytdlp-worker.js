import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { spawn } from 'child_process';

if (!isMainThread) {
    const { cmd, args, timeoutMs, shell } = workerData;
    const proc = spawn(cmd, args, { windowsHide: true, shell });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { }
    }, timeoutMs);

    proc.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('error', (err) => {
        clearTimeout(timer);
        parentPort?.postMessage({ error: err.message || String(err) });
    });
    proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
            parentPort?.postMessage({ output: stdout.trim() || stderr.trim() });
        } else {
            parentPort?.postMessage({ error: (stderr || stdout).trim() || `yt-dlp exit ${code}` });
        }
    });
}

export function runYtDlpInWorker(cmd, args, timeoutMs = 240000, shell = false) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./ytdlp-worker.js', import.meta.url), {
            workerData: { cmd, args, timeoutMs, shell }
        });

        const timer = setTimeout(() => {
            worker.terminate().catch(() => {});
            reject(new Error(`yt-dlp: timeout ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs + 1000);

        worker.on('message', (msg) => {
            if (msg.error) return reject(new Error(msg.error));
            resolve(msg.output || '');
        });

        worker.on('error', (err) => {
            reject(err);
        });

        worker.on('exit', (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                reject(new Error(`yt-dlp worker exited ${code}`));
            }
        });
    });
}
