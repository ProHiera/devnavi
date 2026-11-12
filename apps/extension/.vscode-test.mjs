import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	useInstallation: process.env.DEVNAVI_TEST_VSCODE ? { fromPath: process.env.DEVNAVI_TEST_VSCODE } : undefined,
	mocha: { timeout: 10000 },
});
