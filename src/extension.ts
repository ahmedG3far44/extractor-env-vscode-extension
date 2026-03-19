import * as vscode from 'vscode';
import * as path from 'path';

// 1. Framework Regex Patterns
const REGEX_PATTERNS = [
    /process\.env\.([A-Z0-9_]+)/g,       // Node.js, Express, Nest, Next.js
    /import\.meta\.env\.([A-Z0-9_]+)/g,  // Vite, React
    /REACT_APP_([A-Z0-9_]+)/g,           // Create React App
    /os\.environ\.get\(['"]([A-Z0-9_]+)['"]\)/g, // Python (Django/Flask/FastAPI)
    /os\.getenv\(['"]([A-Z0-9_]+)['"]\)/g,       // Python 
    /config\(['"]([A-Z0-9_]+)['"]\)/g,           // Python (python-decouple)
    /env\(['"]([A-Z0-9_]+)['"]\)/g,              // PHP (Laravel)
    /Environment\.GetEnvironmentVariable\(['"]([A-Z0-9_]+)['"]\)/g // .NET
];

// 2. Ignore heavy directories
const EXCLUDE_PATTERN = '**/{node_modules,.git,.next,dist,build,venv,out,vendor}/**';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('env-extractor.generateEnv', async () => {
        
        if (!vscode.workspace.workspaceFolders) {
            vscode.window.showErrorMessage('Please open a workspace folder first.');
            return;
        }

        vscode.window.showInformationMessage('Scanning for environment variables and mapping sub-projects...');

        try {
            // 3. Find Sub-Project Roots using "Marker Files"
            // This covers Node/JS, Python, PHP, and .NET projects
            const markerFiles = await vscode.workspace.findFiles(
                '**/{package.json,requirements.txt,manage.py,pyproject.toml,composer.json,*.csproj}', 
                EXCLUDE_PATTERN
            );
            
            // Extract the directory paths of these marker files
            let projectRoots = markerFiles.map(uri => path.dirname(uri.fsPath));
            
            // Sort by length (longest first) to ensure we match the deepest nested project root
            projectRoots.sort((a, b) => b.length - a.length);

            // 4. Find all source files
            const files = await vscode.workspace.findFiles('**/*.{ts,tsx,js,jsx,py,php,cs}', EXCLUDE_PATTERN);
            const envMap = new Map<string, Set<string>>();

            for (const file of files) {
                const document = await vscode.workspace.openTextDocument(file);
                const text = document.getText();
                
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(file);
                if (!workspaceFolder) continue;

                // 5. Determine the correct root for THIS specific file
                let targetRoot = workspaceFolder.uri.fsPath; // Fallback to main workspace root
                
                for (const root of projectRoots) {
                    // Check if the current file is inside this project root's directory
                    const relative = path.relative(root, file.fsPath);
                    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
                        targetRoot = root;
                        break; // Stop at the first (deepest) match
                    }
                }

                if (!envMap.has(targetRoot)) {
                    envMap.set(targetRoot, new Set());
                }

                // 6. Extract variables
                for (const pattern of REGEX_PATTERNS) {
                    let match;
                    while ((match = pattern.exec(text)) !== null) {
                        if (match[1]) {
                            envMap.get(targetRoot)?.add(match[1]);
                        }
                    }
                }
            }

            // 7. Generate separate .env.example files for each found sub-project
            let generatedCount = 0;
            for (const [dirPath, variables] of envMap.entries()) {
                if (variables.size === 0) continue;

                const envContent = Array.from(variables)
                    .sort()
                    .map(v => `${v}=`)
                    .join('\n');

                const targetUri = vscode.Uri.file(path.join(dirPath, '.env.example'));
                const writeData = Buffer.from(envContent, 'utf8');
                await vscode.workspace.fs.writeFile(targetUri, writeData);
                generatedCount++;
            }

            vscode.window.showInformationMessage(`Success! Generated ${generatedCount} .env.example file(s) across your projects.`);

        } catch (error) {
            console.error(error);
            vscode.window.showErrorMessage('An error occurred while extracting variables.');
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}