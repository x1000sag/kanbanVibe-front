import { createInMemoryAccountBoard, type InMemoryAccountBoard, type MockResult } from './mockAccountBoard'
import type {
  Card,
  CardCreate,
  DisplayNameChange,
  ErrorCode,
  Identity,
  PasswordChange,
  Profile,
} from '../types/accountBoard'

export type FailureKind = 'network' | 'client' | 'access' | 'store' | 'service'

export type PortFailure = {
  ok: false
  kind: FailureKind
  code?: ErrorCode
}

export type PortResult<T> = { ok: true; data: T } | PortFailure

export type OpenAccountResult =
  | { ok: true; profile: Profile; nameAccepted: boolean; nameFailure: PortFailure | null }
  | { ok: false; failure: PortFailure; signedIn: boolean; nick: string | null }

export interface AccountBoardPort {
  createAccount(body: { nick: string; password: string }): Promise<PortResult<Identity>>
  signIn(body: { nick: string; password: string }): Promise<PortResult<{ expiresAt: string }>>
  endSession(): Promise<PortResult<null>>
  getProfile(): Promise<PortResult<Profile>>
  changeDisplayName(body: DisplayNameChange): Promise<PortResult<Identity>>
  changePassword(body: PasswordChange): Promise<PortResult<null>>
  createCard(body: CardCreate): Promise<PortResult<Card>>
  deleteCard(cardId: string): Promise<PortResult<null>>
  openAccount(input: { nick: string; password: string; displayName: string }): Promise<OpenAccountResult>
}

function asFailure(result: MockResult<unknown>): PortFailure {
  if (result.ok) return { ok: false, kind: 'service' }
  if ('network' in result) return { ok: false, kind: 'network' }
  if (result.error.code === 'no_active_access') return { ok: false, kind: 'access', code: result.error.code }
  if (result.error.code === 'store_unavailable') return { ok: false, kind: 'store', code: result.error.code }
  if (result.status >= 500) return { ok: false, kind: 'service', code: result.error.code }
  return { ok: false, kind: 'client', code: result.error.code }
}

export function createAccountBoardPort(memory: InMemoryAccountBoard = createInMemoryAccountBoard()): AccountBoardPort {
  let token: string | null = null
  let nick: string | null = null
  let profileReady = false

  function drop(): void {
    token = null
    nick = null
    profileReady = false
  }

  function rejectAccess(): PortFailure {
    drop()
    return { ok: false, kind: 'access', code: 'no_active_access' }
  }

  return {
    async createAccount(body) {
      const result = await memory.createAccount({ nick: body.nick, password: body.password })
      if (!result.ok) return asFailure(result)
      return { ok: true, data: result.data }
    },

    async signIn(body) {
      const result = await memory.signIn({ nick: body.nick, password: body.password })
      if (!result.ok) return asFailure(result)
      token = result.data.accessToken
      nick = body.nick.trim()
      profileReady = false
      return { ok: true, data: { expiresAt: result.data.expiresAt } }
    },

    async endSession() {
      if (token) await memory.endSession(token)
      drop()
      return { ok: true, data: null }
    },

    async getProfile() {
      if (!token || !nick) return rejectAccess()
      const result = await memory.getProfile(token, nick)
      if (!result.ok) {
        const failure = asFailure(result)
        if (failure.kind === 'access') drop()
        return failure
      }
      profileReady = true
      return { ok: true, data: result.data }
    },

    async changeDisplayName(body) {
      if (!token || !nick) return rejectAccess()
      const result = await memory.changeDisplayName(token, nick, { displayName: body.displayName })
      if (!result.ok) {
        const failure = asFailure(result)
        if (failure.kind === 'access') drop()
        return failure
      }
      return { ok: true, data: result.data }
    },

    async changePassword(body) {
      if (!token || !nick) return rejectAccess()
      const result = await memory.changePassword(token, nick, {
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
      })
      if (!result.ok) {
        const failure = asFailure(result)
        if (failure.kind === 'access') drop()
        return failure
      }
      return { ok: true, data: null }
    },

    async createCard(body) {
      if (!token || !nick || !profileReady) return { ok: false, kind: 'client', code: 'request_invalid' }
      const result = await memory.createCard(token, nick, {
        columnName: body.columnName,
        title: body.title,
        description: body.description ?? null,
        tags: body.tags ?? [],
        deadline: body.deadline ?? null,
      })
      if (!result.ok) {
        const failure = asFailure(result)
        if (failure.kind === 'access') drop()
        return failure
      }
      return { ok: true, data: result.data }
    },

    async deleteCard(cardId) {
      if (!token || !nick || !profileReady) return { ok: false, kind: 'client', code: 'request_invalid' }
      const result = await memory.deleteCard(token, nick, cardId)
      if (!result.ok) {
        const failure = asFailure(result)
        if (failure.kind === 'access') drop()
        return failure
      }
      return { ok: true, data: null }
    },

    async openAccount(input) {
      const created = await memory.createAccount({ nick: input.nick, password: input.password })
      if (!created.ok) return { ok: false, failure: asFailure(created), signedIn: false, nick: null }
      const signed = await memory.signIn({ nick: created.data.nick, password: input.password })
      if (!signed.ok) return { ok: false, failure: asFailure(signed), signedIn: false, nick: null }
      token = signed.data.accessToken
      nick = created.data.nick
      profileReady = false
      const named = await memory.changeDisplayName(token, nick, { displayName: input.displayName })
      const profile = await memory.getProfile(token, nick)
      if (!profile.ok) {
        const failure = asFailure(profile)
        if (failure.kind === 'access') {
          drop()
          return { ok: false, failure, signedIn: false, nick: null }
        }
        return { ok: false, failure, signedIn: true, nick }
      }
      profileReady = true
      if (!named.ok) {
        return { ok: true, profile: profile.data, nameAccepted: false, nameFailure: asFailure(named) }
      }
      return { ok: true, profile: profile.data, nameAccepted: true, nameFailure: null }
    },
  }
}
