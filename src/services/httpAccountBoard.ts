import type {
  Card,
  Column,
  ColumnName,
  ErrorBody,
  ErrorCode,
  Identity,
  Profile,
  Session,
} from '../types/accountBoard'

export type TransportResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; network: true }
  | { ok: false; status: number; error: ErrorBody }
  | { ok: false; status: number; service: true }
  | { ok: false; status: number; unrecognized: true }

export interface AccountTransport {
  createAccount(body: unknown): Promise<TransportResult<Identity>>
  signIn(body: unknown): Promise<TransportResult<Session>>
  endSession(token: string): Promise<TransportResult<null>>
  getProfile(token: string, nick: string): Promise<TransportResult<Profile>>
  changeDisplayName(token: string, nick: string, body: unknown): Promise<TransportResult<Identity>>
  changePassword(token: string, nick: string, body: unknown): Promise<TransportResult<null>>
  createCard(token: string, nick: string, body: unknown): Promise<TransportResult<Card>>
  deleteCard(token: string, nick: string, cardId: string): Promise<TransportResult<null>>
}

const ERROR_CODES: readonly ErrorCode[] = [
  'nick_taken',
  'nick_invalid',
  'password_invalid',
  'sign_in_failed',
  'no_active_access',
  'foreign_data',
  'display_name_invalid',
  'password_change_rejected',
  'store_unavailable',
  'request_invalid',
  'card_invalid',
  'object_missing',
]

const COLUMN_NAMES: readonly ColumnName[] = ['ToDo', 'InProgress', 'Done']

type ReadBody = { kind: 'empty' } | { kind: 'json'; value: unknown } | { kind: 'invalid' }

function apiBase(): string {
  let raw = ''
  const configured = import.meta.env?.VITE_API_BASE_URL
  if (typeof configured === 'string') raw = configured.trim()
  const base = raw.length > 0 ? raw : 'http://localhost:5050'
  return base.replace(/\/+$/, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isColumnName(value: string): value is ColumnName {
  return COLUMN_NAMES.some((name) => name === value)
}

function knownCode(value: unknown): ErrorCode | undefined {
  if (!isRecord(value) || typeof value.code !== 'string') return undefined
  return ERROR_CODES.find((code) => code === value.code)
}

function accountPath(nick: string, suffix = ''): string {
  return `/v1/accounts/${encodeURIComponent(nick)}${suffix}`
}

function network(): TransportResult<never> {
  return { ok: false, network: true }
}

function service(status: number): TransportResult<never> {
  return { ok: false, status, service: true }
}

function refusal(status: number, body: ReadBody, unauthorized?: ErrorCode): TransportResult<never> {
  const parsed = body.kind === 'json' ? knownCode(body.value) : undefined
  const code = parsed ?? (status === 401 ? unauthorized : undefined) ?? (status === 503 ? 'store_unavailable' : undefined)
  if (code) return { ok: false, status, error: { code } }
  if (status >= 500) return service(status)
  return { ok: false, status, unrecognized: true }
}

async function readBody(response: Response): Promise<ReadBody> {
  let text = ''
  try {
    text = await response.text()
  } catch {
    return { kind: 'invalid' }
  }
  if (text.trim() === '') return { kind: 'empty' }
  try {
    return { kind: 'json', value: JSON.parse(text) as unknown }
  } catch {
    return { kind: 'invalid' }
  }
}

function parseIdentity(value: unknown): Identity | null {
  if (!isRecord(value) || typeof value.nick !== 'string' || typeof value.displayName !== 'string') return null
  return { nick: value.nick, displayName: value.displayName }
}

function parseSession(value: unknown): Session | null {
  if (!isRecord(value) || typeof value.accessToken !== 'string' || value.accessToken.length === 0) return null
  if (typeof value.expiresAt !== 'string' || value.expiresAt.length === 0) return null
  return { accessToken: value.accessToken, expiresAt: value.expiresAt }
}

function parseCard(value: unknown): Card | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || value.id.length === 0) return null
  if (typeof value.title !== 'string') return null
  if (typeof value.createdAt !== 'string' || value.createdAt.length === 0) return null
  if (!Array.isArray(value.tags)) return null
  const tags = value.tags.filter((tag): tag is string => typeof tag === 'string')
  if (tags.length !== value.tags.length) return null
  let description: string | null = null
  if (value.description !== undefined && value.description !== null) {
    if (typeof value.description !== 'string') return null
    description = value.description
  }
  let deadline: string | null = null
  if (value.deadline !== undefined && value.deadline !== null) {
    if (typeof value.deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.deadline)) return null
    deadline = value.deadline
  }
  return {
    id: value.id,
    title: value.title,
    description,
    tags,
    deadline,
    createdAt: value.createdAt,
  }
}

function parseColumn(value: unknown): Column | null {
  if (!isRecord(value) || typeof value.name !== 'string' || !isColumnName(value.name)) return null
  if (!Array.isArray(value.cards)) return null
  const cards: Card[] = []
  for (const item of value.cards) {
    const card = parseCard(item)
    if (!card) return null
    cards.push(card)
  }
  return { name: value.name, cards }
}

function parseProfile(value: unknown): Profile | null {
  if (!isRecord(value) || typeof value.nick !== 'string' || typeof value.displayName !== 'string') return null
  if (!isRecord(value.board) || !Array.isArray(value.board.columns)) return null
  const parsed = value.board.columns.map(parseColumn)
  if (parsed.some((column) => column === null)) return null
  const columns = parsed as Column[]
  const ordered = COLUMN_NAMES.map((name) => columns.find((column) => column.name === name))
  if (ordered.some((column) => !column) || columns.length !== COLUMN_NAMES.length) return null
  return {
    nick: value.nick,
    displayName: value.displayName,
    board: { columns: ordered as [Column, Column, Column] },
  }
}

async function call<T>(
  method: string,
  path: string,
  token: string | undefined,
  body: unknown | undefined,
  parse: ((payload: unknown) => T | null) | null,
  unauthorized?: ErrorCode,
): Promise<TransportResult<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  let encoded: string | undefined
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    encoded = JSON.stringify(body)
  }
  let response: Response
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method,
      headers,
      body: encoded,
      credentials: 'omit',
      cache: 'no-store',
    })
  } catch {
    return network()
  }
  const payload = await readBody(response)
  if (response.ok) {
    if (parse === null) {
      if (payload.kind === 'empty') return { ok: true, status: response.status, data: null as T }
      return service(response.status)
    }
    if (payload.kind !== 'json') return service(response.status)
    const data = parse(payload.value)
    if (data === null) return service(response.status)
    return { ok: true, status: response.status, data }
  }
  return refusal(response.status, payload, unauthorized)
}

export function createHttpAccountBoard(): AccountTransport {
  return {
    createAccount(body) {
      return call('POST', '/v1/accounts', undefined, body, parseIdentity)
    },
    signIn(body) {
      return call('POST', '/v1/sessions', undefined, body, parseSession, 'sign_in_failed')
    },
    endSession(token) {
      return call('DELETE', '/v1/sessions/current', token, undefined, null, 'no_active_access')
    },
    getProfile(token, nick) {
      return call('GET', accountPath(nick), token, undefined, parseProfile, 'no_active_access')
    },
    changeDisplayName(token, nick, body) {
      return call('PUT', accountPath(nick, '/display-name'), token, body, parseIdentity, 'no_active_access')
    },
    changePassword(token, nick, body) {
      return call('PUT', accountPath(nick, '/password'), token, body, null, 'no_active_access')
    },
    createCard(token, nick, body) {
      return call('POST', accountPath(nick, '/cards'), token, body, parseCard, 'no_active_access')
    },
    deleteCard(token, nick, cardId) {
      return call(
        'DELETE',
        accountPath(nick, `/cards/${encodeURIComponent(cardId)}`),
        token,
        undefined,
        null,
        'no_active_access',
      )
    },
  }
}
