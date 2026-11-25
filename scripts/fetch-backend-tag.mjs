import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const destination = path.join(root, 'vendor', 'kanbanVibe-Back')
const httpsUrl = 'https://github.com/x1000sag/kanbanVibe-Back.git'
const specPrefix = `git+${httpsUrl}#`
const githubSshHostKey = 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n'

const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
let cleanupTransport = () => {}

function git(args, cwd) {
  try {
    return execFileSync('git', ['-c', 'advice.detachedHead=false', '-c', 'init.defaultBranch=main', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: gitEnv,
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

function remoteTag(remoteUrl, tag) {
  const output = git(['ls-remote', '--tags', remoteUrl, tag])
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
    throw new Error(`Тег ${tag} не найден в ${remoteUrl}`)
  }
  return { tagSha, commitSha }
}

function normalizeDeployKey(raw) {
  let text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim()
  }
  if (!text.includes('\n') && text.includes('\\n')) {
    text = text.replace(/\\n/g, '\n').trim()
  }
  if (!text.includes('-----BEGIN ') && !/[\s]/.test(text)) {
    const decoded = Buffer.from(text, 'base64').toString('utf8')
    if (decoded.includes('-----BEGIN ')) text = decoded.trim()
  }
  const begin = text.indexOf('-----BEGIN ')
  if (begin === -1) {
    const looksPublic = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-|sk-ssh-)/.test(text)
    const hint = looksPublic ? ' Похоже, в секрете публичный ключ, а нужен приватный.' : ''
    throw new Error(`BACKEND_SSH_DEPLOY_KEY не похож на приватный ключ OpenSSH.${hint}`)
  }
  const end = text.indexOf('-----END ', begin)
  if (end === -1) {
    throw new Error('BACKEND_SSH_DEPLOY_KEY не содержит строки -----END')
  }
  const endLine = text.indexOf('\n', end)
  text = text.slice(begin, endLine === -1 ? undefined : endLine + 1)
  if (!text.endsWith('\n')) text += '\n'
  return text
}

function useDeployKey(fallbackUrl) {
  const raw = process.env.BACKEND_SSH_DEPLOY_KEY
  delete gitEnv.BACKEND_SSH_DEPLOY_KEY
  if (typeof raw !== 'string' || raw.trim() === '') return fallbackUrl

  const material = normalizeDeployKey(raw)

  const dir = mkdtempSync(path.join(tmpdir(), 'kanban-backend-key-'))
  const keyPath = path.join(dir, 'id')
  const knownHosts = path.join(dir, 'known_hosts')
  const emptyGitConfig = path.join(dir, 'gitconfig')
  try {
    writeFileSync(keyPath, material, { mode: 0o600 })
    chmodSync(keyPath, 0o600)
    writeFileSync(knownHosts, githubSshHostKey)
    writeFileSync(emptyGitConfig, '')
    gitEnv.GIT_SSH_COMMAND = `ssh -i ${keyPath} -o IdentitiesOnly=yes -o UserKnownHostsFile=${knownHosts} -o StrictHostKeyChecking=yes -o BatchMode=yes`
    gitEnv.GIT_CONFIG_GLOBAL = emptyGitConfig
    gitEnv.GIT_CONFIG_NOSYSTEM = '1'
    delete gitEnv.GIT_CONFIG_SYSTEM
    delete gitEnv.GIT_CONFIG_COUNT
    for (const key of Object.keys(gitEnv)) {
      if (key.startsWith('GIT_CONFIG_KEY_') || key.startsWith('GIT_CONFIG_VALUE_')) delete gitEnv[key]
    }
    cleanupTransport = () => rmSync(dir, { recursive: true, force: true })
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
  return 'git@github.com:x1000sag/kanbanVibe-Back.git'
}

const tag = readPin()
const originUrl = useDeployKey(httpsUrl)

try {
  const remote = remoteTag(originUrl, tag)
  const stage = path.join(root, 'vendor', `.fetch-${tag}`)
  const previous = path.join(root, 'vendor', `.previous-${tag}`)

  rmSync(stage, { recursive: true, force: true })
  mkdirSync(path.dirname(stage), { recursive: true })

  try {
    git(['init', stage])
    git(['remote', 'add', 'origin', originUrl], stage)
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
} finally {
  cleanupTransport()
}
