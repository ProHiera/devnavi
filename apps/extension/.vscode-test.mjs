import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	useInstallation: process.env.DEVNAVI_TEST_VSCODE ? { fromPath: process.env.DEVNAVI_TEST_VSCODE } : undefined,
	workspaceFolder: process.env.DEVNAVI_TEST_WORKSPACE,
	mocha: { timeout: 10000 },
});
