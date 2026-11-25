import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, renameSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const destination = path.join(root, 'vendor', 'kanbanVibe-Back')
const repoUrl = 'https://github.com/x1000sag/kanbanVibe-Back.git'
const specPrefix = `git+${repoUrl}#`

function git(args, cwd) {
  try {
    return execFileSync('git', ['-c', 'advice.detachedHead=false', '-c', 'init.defaultBranch=main', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).trim()
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('git не найден в PATH. Сборка забирает тег kanbanVibe-Back и требует git.')
    }
    const stderr = error.stderr?.toString?.().trim() ?? ''
    const stdout = error.stdout?.toString?.().trim() ?? ''
    const detail = [stdout, stderr].filter(Boolean).join('\n')
    const status = error.status ?? '?'
    throw new Error(`git ${args.join(' ')} завершился с кодом ${status}${detail ? `\n${detail}` : ''}`)
  }
}

function readPin() {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const spec = manifest.kanbanVibeBackend
  if (typeof spec !== 'string' || !spec.startsWith(specPrefix)) {
    throw new Error(
      `package.json: kanbanVibeBackend должен быть git-зависимостью ${specPrefix}vX.Y.Z`,
    )
  }
  const tag = spec.slice(specPrefix.length)
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`package.json: тег в kanbanVibeBackend должен быть вида vX.Y.Z, сейчас «${tag}»`)
  }
  return tag
}

function remoteTag(repoUrl, tag) {
  const output = git(['ls-remote', '--tags', repoUrl, tag])
  const refs = new Map()
  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [sha, ref] = trimmed.split(/\s+/)
    if (sha && ref) refs.set(ref, sha.toLowerCase())
  }
  const tagSha = refs.get(`refs/tags/${tag}`) ?? null
  const commitSha = refs.get(`refs/tags/${tag}^{}`) ?? null
  if (!tagSha && !commitSha) {
    throw new Error(`Тег ${tag} не найден в ${repoUrl}`)
  }
  return { tagSha, commitSha }
}

const tag = readPin()
const remote = remoteTag(repoUrl, tag)
const stage = path.join(root, 'vendor', `.fetch-${tag}`)
const previous = path.join(root, 'vendor', `.previous-${tag}`)

rmSync(stage, { recursive: true, force: true })
mkdirSync(path.dirname(stage), { recursive: true })

try {
  git(['init', stage])
  git(['remote', 'add', 'origin', repoUrl], stage)
  git(['fetch', '--depth', '1', 'origin', `refs/tags/${tag}:refs/tags/${tag}`], stage)

  const localTag = git(['rev-parse', `refs/tags/${tag}`], stage).toLowerCase()
  const localCommit = git(['rev-parse', `refs/tags/${tag}^{commit}`], stage).toLowerCase()
  if (remote.tagSha && localTag !== remote.tagSha) {
    throw new Error(`Объект тега ${tag} (${localTag}) не совпадает с origin (${remote.tagSha})`)
  }
  if (remote.commitSha && localCommit !== remote.commitSha) {
    throw new Error(`Коммит тега ${tag} (${localCommit}) не совпадает с origin (${remote.commitSha})`)
  }

  git(['checkout', '--detach', '--force', localCommit], stage)
  const head = git(['rev-parse', 'HEAD'], stage).toLowerCase()
  if (head !== localCommit) {
    throw new Error(`HEAD ${head} не равен коммиту тега ${tag} (${localCommit})`)
  }
  const described = git(['describe', '--tags', '--exact-match', 'HEAD'], stage)
  if (described !== tag) {
    throw new Error(`HEAD описан как ${described}, ожидался тег ${tag}`)
  }
  const sentinel = path.join(stage, 'kanban-cli', 'Kanban.sln')
  if (!existsSync(sentinel)) {
    throw new Error(`В теге ${tag} нет kanban-cli/Kanban.sln`)
  }

  rmSync(previous, { recursive: true, force: true })
  if (existsSync(destination)) renameSync(destination, previous)
  renameSync(stage, destination)
  rmSync(previous, { recursive: true, force: true })
} catch (error) {
  rmSync(stage, { recursive: true, force: true })
  if (!existsSync(destination) && existsSync(previous)) renameSync(previous, destination)
  throw error
}

const resolved = remote.commitSha ?? git(['rev-parse', 'HEAD'], destination).toLowerCase()
console.log(`kanbanVibe-Back ${tag} @ ${resolved}`)
