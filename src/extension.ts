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

// Helper: Smart Default Guesser
function getDefaultEnvValue(key: string): string {
    const k = key.toUpperCase();
    
    // Environment & Networking
    if (k === 'NODE_ENV') return 'development';
    if (k.includes('PORT')) return '8080';
    if (k.includes('HOST')) return 'localhost';
    
    // Databases
    if (k.includes('DATABASE_URL') || k.includes('DB_URL')) return 'postgresql://user:password@localhost:5432/mydb';
    if (k.includes('MONGO_URI') || k.includes('MONGODB_URL')) return 'mongodb://localhost:27017/mydb';
    if (k.includes('REDIS')) return 'redis://localhost:6379';
    if (k.includes('DB_USER')) return 'postgres';
    if (k.includes('DB_PASS')) return 'password';
    if (k.includes('DB_NAME')) return 'my_database';
    if (k.includes('DB_PORT')) return '5432';
    
    // Auth & Security
    if (k.includes('JWT_SECRET') || k.includes('TOKEN_SECRET')) return 'your_jwt_secret';
    if (k.includes('API_KEY')) return 'your_api_key';
    if (k.includes('SECRET')) return 'your_secret_string';
    if (k.includes('PASSWORD') || k.includes('PASS')) return 'your_password';
    
    // Cloud & Providers
    if (k.includes('AWS_ACCESS')) return 'your_aws_access_key';
    if (k.includes('AWS_SECRET')) return 'your_aws_secret_key';
    if (k.includes('AWS_REGION')) return 'us-east-1';
    if (k.includes('STRIPE_SECRET') || k.includes('STRIPE_API')) return 'sk_test_your_stripe_key';
    if (k.includes('STRIPE_WEBHOOK')) return 'whsec_your_webhook_secret';
    
    // Mail
    if (k.includes('SMTP_HOST')) return 'smtp.mailtrap.io';
    if (k.includes('SMTP_PORT')) return '2525';
    if (k.includes('SMTP_USER')) return 'your_smtp_user';
    
    // URLs
    if (k.includes('URL') || k.includes('URI')) return 'http://localhost:3000';
    
    // Fallback for anything else
    return 'your_value_here';
}

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('env-extractor.generateEnv', async () => {
        
        if (!vscode.workspace.workspaceFolders) {
            vscode.window.showErrorMessage('Please open a workspace folder first.');
            return;
        }

        vscode.window.showInformationMessage('Scanning for environment variables and mapping sub-projects...');

        try {
            // 3. Find Sub-Project Roots using "Marker Files"
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
                let targetRoot = workspaceFolder.uri.fsPath; 
                
                for (const root of projectRoots) {
                    const relative = path.relative(root, file.fsPath);
                    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
                        targetRoot = root;
                        break;
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

                // CHANGED: Map now applies the smart default guesser
                const envContent = Array.from(variables)
                    .sort()
                    .map(v => `${v}=${getDefaultEnvValue(v)}`)
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