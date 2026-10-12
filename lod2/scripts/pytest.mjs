/**
 * The Python tests of lod2-vision and lod2-floorplan, for `npm run check:lod2`.
 *
 * Each runs in its own .venv, the same one `npm run dev` starts the service from. A service
 * without one is not installed on this computer, so its tests are skipped with a note, not
 * failed. The floor plan service's real-plan tests (test_samples.py) are left out: they run the
 * room model on the graphics card for over a minute. Run them by hand with
 * `.venv/bin/python -m pytest test_samples.py` in lod2/lod2-floorplan.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const lod2 = join(dirname(fileURLToPath(import.meta.url)), '..')
const services = [
  { name: 'lod2-vision', args: [] },
  { name: 'lod2-floorplan', args: ['--ignore=test_samples.py'] },
]

let failed = false
for (const { name, args } of services) {
  const dir = join(lod2, name)
  const python = join(dir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  if (!existsSync(python)) {
    console.log(`${name}: no .venv, Python tests skipped`)
    continue
  }
  const run = spawnSync(python, ['-m', 'pytest', '-q', '-p', 'no:cacheprovider', ...args], {
    cwd: dir,
    stdio: 'inherit',
  })
  if (run.status !== 0) failed = true
}
process.exit(failed ? 1 : 0)
