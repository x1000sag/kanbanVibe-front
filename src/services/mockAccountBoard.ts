import { takeFault } from './accountBoardFault'
import type {
  Board,
  Card,
  Column,
  ColumnName,
  ErrorBody,
  ErrorCode,
  Identity,
  Profile,
  Session,
} from '../types/accountBoard'

const COLUMN_NAMES = ['ToDo', 'InProgress', 'Done'] as const
const BODY_LIMIT = 16 * 1024
const SESSION_MS = 12 * 60 * 60 * 1000
const NICK_MAX = 64
const PASSWORD_MAX = 1024
const NAME_MAX = 128

export type MockResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ErrorBody }
  | { ok: false; network: true }

interface AccountRecord {
  nick: string
  displayName: string
  verifier: string
  columns: [Column, Column, Column]
}

interface SessionRecord {
  token: string
  nick: string
  expiresAtMs: number
  profileRead: boolean
}

function fail(status: number, code: ErrorCode): MockResult<never> {
  return { ok: false, status, error: { code } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function scalarLength(value: string): number {
  return Array.from(value).length
}

function bodyTooLarge(value: unknown): boolean {
  try {
    const encoded = JSON.stringify(value)
    if (typeof encoded !== 'string') return false
    return new TextEncoder().encode(encoded).length > BODY_LIMIT
  } catch {
    return true
  }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value)
  return present.length === keys.length && keys.every((key) => present.includes(key))
}

function allowedKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function utcSecond(ms: number): number {
  return Math.floor(ms / 1000) * 1000
}

function formatUtc(ms: number): string {
  return new Date(ms).toISOString().replace('.000Z', 'Z')
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function emptyColumns(): [Column, Column, Column] {
  return [
    { name: 'ToDo', cards: [] },
    { name: 'InProgress', cards: [] },
    { name: 'Done', cards: [] },
  ]
}

function isColumnName(value: string): value is ColumnName {
  return COLUMN_NAMES.some((name) => name === value)
}

function calendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

function sortTags(tags: string[]): string[] {
  return [...tags].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

function copyCard(card: Card): Card {
  return { ...card, tags: [...card.tags] }
}

function copyProfile(account: AccountRecord): Profile {
  const columns = account.columns.map((column) => ({
    name: column.name,
    cards: sortCards(column.cards).map(copyCard),
  })) as [Column, Column, Column]
  const board: Board = { columns }
  return { nick: account.nick, displayName: account.displayName, board }
}

export interface InMemoryAccountBoard {
  createAccount(body: unknown): Promise<MockResult<Identity>>
  signIn(body: unknown): Promise<MockResult<Session>>
  endSession(token: string): Promise<MockResult<null>>
  getProfile(token: string, nick: string): Promise<MockResult<Profile>>
  changeDisplayName(token: string, nick: string, body: unknown): Promise<MockResult<Identity>>
  changePassword(token: string, nick: string, body: unknown): Promise<MockResult<null>>
  createCard(token: string, nick: string, body: unknown): Promise<MockResult<Card>>
  deleteCard(token: string, nick: string, cardId: string): Promise<MockResult<null>>
}

export function createInMemoryAccountBoard(): InMemoryAccountBoard {
  const accounts = new Map<string, AccountRecord>()
  const sessions = new Map<string, SessionRecord>()
  let chain: Promise<void> = Promise.resolve()
  let lastCreatedMs = 0

  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task, task)
    chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  function applyFault(token?: string): MockResult<never> | null {
    const fault = takeFault()
    if (fault === 'network') return { ok: false, network: true }
    if (fault === 'store_unavailable') return fail(503, 'store_unavailable')
    if (fault === 'expire' && token) {
      const session = sessions.get(token)
      if (session) session.expiresAtMs = utcSecond(Date.now())
    }
    return null
  }

  function requireSession(token: string): SessionRecord | MockResult<never> {
    const session = sessions.get(token)
    if (!session || Date.now() >= session.expiresAtMs) return fail(401, 'no_active_access')
    return session
  }

  function isSession(value: SessionRecord | MockResult<never>): value is SessionRecord {
    return !('ok' in value)
  }

  function ownAccount(session: SessionRecord, nick: string): AccountRecord | MockResult<never> {
    const pathNick = nick.trim()
    if (pathNick !== session.nick) return fail(403, 'foreign_data')
    const account = accounts.get(session.nick)
    if (!account) return fail(401, 'no_active_access')
    return account
  }

  function isAccount(value: AccountRecord | MockResult<never>): value is AccountRecord {
    return !('ok' in value)
  }

  function nextCreatedAt(now: number): string {
    let ms = utcSecond(now)
    if (ms <= lastCreatedMs) ms = lastCreatedMs + 1000
    lastCreatedMs = ms
    return formatUtc(ms)
  }

  return {
    createAccount(body) {
      return serial(async () => {
        const fault = applyFault()
        if (fault) return fault
        if (bodyTooLarge(body)) return fail(400, 'request_invalid')
        if (!isRecord(body) || !exactKeys(body, ['nick', 'password'])) return fail(400, 'request_invalid')
        if (typeof body.nick !== 'string' || typeof body.password !== 'string') return fail(400, 'request_invalid')
        const nick = body.nick.trim()
        if (scalarLength(nick) < 1 || scalarLength(nick) > NICK_MAX) return fail(400, 'nick_invalid')
        if (scalarLength(body.password) < 1 || scalarLength(body.password) > PASSWORD_MAX) {
          return fail(400, 'password_invalid')
        }
        if (accounts.has(nick)) return fail(409, 'nick_taken')
        const verifier = await sha256(body.password)
        accounts.set(nick, { nick, displayName: nick, verifier, columns: emptyColumns() })
        return { ok: true, status: 201, data: { nick, displayName: nick } }
      })
    },

    signIn(body) {
      return serial(async () => {
        const fault = applyFault()
        if (fault) return fault
        if (bodyTooLarge(body)) return fail(400, 'request_invalid')
        if (!isRecord(body) || !exactKeys(body, ['nick', 'password'])) return fail(400, 'request_invalid')
        if (typeof body.nick !== 'string' || typeof body.password !== 'string') return fail(400, 'request_invalid')
        const nick = body.nick.trim()
        const account = accounts.get(nick)
        const verifier = account ? await sha256(body.password) : ''
        if (!account || verifier !== account.verifier) return fail(401, 'sign_in_failed')
        const issued = utcSecond(Date.now())
        const token = crypto.randomUUID()
        const expiresAtMs = issued + SESSION_MS
        sessions.set(token, { token, nick, expiresAtMs, profileRead: false })
        const data: Session = { accessToken: token, expiresAt: formatUtc(expiresAtMs) }
        return { ok: true, status: 200, data }
      })
    },

    endSession(token) {
      return serial(async () => {
        const fault = applyFault(token)
        if (fault) return fault
        const session = requireSession(token)
        if (!isSession(session)) return session
        sessions.delete(token)
        return { ok: true, status: 204, data: null }
      })
    },

    getProfile(token, nick) {
      return serial(async () => {
        const fault = applyFault(token)
        if (fault) return fault
        const session = requireSession(token)
        if (!isSession(session)) return session
        const account = ownAccount(session, nick)
        if (!isAccount(account)) return account
        session.profileRead = true
        return { ok: true, status: 200, data: copyProfile(account) }
      })
    },

    changeDisplayName(token, nick, body) {
      return serial(async () => {
        const fault = applyFault(token)
        if (fault) return fault
        if (bodyTooLarge(body)) return fail(400, 'request_invalid')
        const session = requireSession(token)
        if (!isSession(session)) return session
        const account = ownAccount(session, nick)
        if (!isAccount(account)) return account
        if (!isRecord(body) || !exactKeys(body, ['displayName']) || typeof body.displayName !== 'string') {
          return fail(400, 'request_invalid')
        }
        const displayName = body.displayName.trim()
        if (scalarLength(displayName) < 1 || scalarLength(displayName) > NAME_MAX) {
          return fail(400, 'display_name_invalid')
        }
        account.displayName = displayName
        return { ok: true, status: 200, data: { nick: account.nick, displayName } }
      })
    },

    changePassword(token, nick, body) {
      return serial(async () => {
        const fault = applyFault(token)
        if (fault) return fault
        if (bodyTooLarge(body)) return fail(400, 'request_invalid')
        const session = requireSession(token)
        if (!isSession(session)) return session
        const account = ownAccount(session, nick)
        if (!isAccount(account)) return account
        if (
          !isRecord(body) ||
          !exactKeys(body, ['currentPassword', 'newPassword']) ||
          typeof body.currentPassword !== 'string' ||
          typeof body.newPassword !== 'string'
        ) {
          return fail(400, 'request_invalid')
        }
        const current = await sha256(body.currentPassword)
        if (current !== account.verifier) return fail(403, 'password_change_rejected')
        if (scalarLength(body.newPassword) < 1 || scalarLength(body.newPassword) > PASSWORD_MAX) {
          return fail(400, 'password_invalid')
        }
        account.verifier = await sha256(body.newPassword)
        return { ok: true, status: 204, data: null }
      })
    },

    createCard(token, nick, body) {
      return serial(async () => {
        const fault = applyFault(token)
        if (fault) return fault
        if (bodyTooLarge(body)) return fail(400, 'request_invalid')
        const session = requireSession(token)
        if (!isSession(session)) return session
        const account = ownAccount(session, nick)
        if (!isAccount(account)) return account
        if (!session.profileRead) return fail(400, 'request_invalid')
        if (!isRecord(body) || !allowedKeys(body, ['columnName', 'title', 'description', 'tags', 'deadline'])) {
          return fail(400, 'request_invalid')
        }
        if (!('columnName' in body) || !('title' in body)) return fail(400, 'request_invalid')
        if (typeof body.columnName !== 'string' || typeof body.title !== 'string') return fail(400, 'request_invalid')
        if (!isColumnName(body.columnName)) return fail(404, 'object_missing')
        if (
          'description' in body &&
          body.description !== null &&
          typeof body.description !== 'string'
        ) {
          return fail(400, 'request_invalid')
        }
        if ('deadline' in body && body.deadline !== null && typeof body.deadline !== 'string') {
          return fail(400, 'request_invalid')
        }
        if ('tags' in body && !Array.isArray(body.tags)) return fail(400, 'request_invalid')
        if (body.title.length === 0) return fail(400, 'card_invalid')
        const description =
          typeof body.description === 'string' && body.description.trim().length > 0 ? body.description : null
        let deadline: string | null = null
        if (typeof body.deadline === 'string' && body.deadline.length > 0) {
          if (!calendarDay(body.deadline)) return fail(400, 'card_invalid')
          deadline = body.deadline
        }
        const rawTags = Array.isArray(body.tags) ? body.tags : []
        if (rawTags.some((tag) => typeof tag !== 'string')) return fail(400, 'request_invalid')
        const tags = rawTags as string[]
        const seen = new Set<string>()
        for (const tag of tags) {
          if (tag.length === 0) return fail(400, 'card_invalid')
          const key = tag.toLocaleLowerCase()
          if (seen.has(key)) return fail(400, 'card_invalid')
          seen.add(key)
        }
        const card: Card = {
          id: crypto.randomUUID(),
          title: body.title,
          description,
          tags: sortTags(tags),
          deadline,
          createdAt: nextCreatedAt(Date.now()),
        }
        const column = account.columns.find((item) => item.name === body.columnName)
        if (!column) return fail(404, 'object_missing')
        column.cards = sortCards([...column.cards, card])
        return { ok: true, status: 201, data: copyCard(card) }
      })
    },

    deleteCard(token, nick, cardId) {
      return serial(async () => {
        const fault = applyFault(token)
        if (fault) return fault
        const session = requireSession(token)
        if (!isSession(session)) return session
        const account = ownAccount(session, nick)
        if (!isAccount(account)) return account
        if (!session.profileRead) return fail(400, 'request_invalid')
        let removed = false
        for (const column of account.columns) {
          const next = column.cards.filter((card) => card.id !== cardId)
          if (next.length !== column.cards.length) {
            column.cards = next
            removed = true
          }
        }
        if (!removed) return fail(404, 'object_missing')
        return { ok: true, status: 204, data: null }
      })
    },
  }
}
