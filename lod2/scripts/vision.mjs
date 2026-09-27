/**
 * Starts the SAM 3 vision service (lod2-vision/server.py) on any operating system.
 *
 * It reads the repo-root .env, picks the Python of lod2-vision/.venv (or LOD2_VISION_PYTHON),
 * and explains in one line what is missing instead of failing with a shell error.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const visionDir = join(root, 'lod2-vision')

loadEnv()
warnAboutPlatform()
const python = findPython()
start(python)

function loadEnv() {
  // The repository root, one level above lod2/.
  const envFile = join(root, '..', '.env')
  // Variables already set in the shell win over the file.
  if (existsSync(envFile)) process.loadEnvFile(envFile)
}

function warnAboutPlatform() {
  if (process.platform === 'darwin') {
    console.warn('Note: SAM 3 needs an NVIDIA GPU with CUDA, which Macs do not have. The map and the manual editor still work.')
  }
  if (process.platform === 'win32') {
    console.warn('Note: SAM 3 is tested on Linux. On Windows, run the vision service inside WSL2 (see README, step 7).')
  }
}

function findPython() {
  const fromEnv = process.env.LOD2_VISION_PYTHON
  // Relative paths in .env are relative to the repository root, where .env lives.
  if (fromEnv) return resolve(root, '..', fromEnv)
  const venv = join(visionDir, '.venv')
  return process.platform === 'win32' ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python')
}

function start(pythonPath) {
  if (!existsSync(pythonPath)) {
    console.error(`No Python found at ${pythonPath}. Create lod2-vision/.venv as described in README step 7, or set LOD2_VISION_PYTHON in .env.`)
    process.exit(1)
  }
  const child = spawn(pythonPath, ['server.py'], { cwd: visionDir, stdio: 'inherit' })
  // Ctrl+C in the terminal stops the service too.
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  child.on('exit', (code) => process.exit(code ?? 1))
}
