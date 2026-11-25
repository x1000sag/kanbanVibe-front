import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { createAccountBoardPort, type PortFailure } from '../services/accountBoardPort'
import { phrase, phraseForCode, type PhraseAction } from '../services/phrases'
import type { Card, CardCreate, Column, ColumnName, Profile } from '../types/accountBoard'

const port = createAccountBoardPort()

export type FieldHint = 'name' | 'nick' | 'password' | 'title' | 'category' | null

export interface Attempt {
  action: 'stay' | 'close'
  focus: FieldHint
}

export interface ProfileDraft {
  displayName: string
  changePassword: null | { currentPassword: string; newPassword: string; repeat: string }
}

function stay(focus: FieldHint): Attempt {
  return { action: 'stay', focus }
}

function close(): Attempt {
  return { action: 'close', focus: null }
}

function copyColumns(columns: Profile['board']['columns']): Column[] {
  return columns.map((column) => ({
    name: column.name,
    cards: column.cards.map((card) => ({ ...card, tags: [...card.tags] })),
  }))
}

function byCreated(a: Card, b: Card): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

export const useAccountStore = defineStore('account', () => {
  const nick = ref<string | null>(null)
  const displayName = ref<string | null>(null)
  const columns = ref<Column[] | null>(null)
  const phraseText = ref<string | null>(null)
  const profileSeen = ref(false)
  const signedIn = computed(() => nick.value !== null)

  function resetGuest(): void {
    nick.value = null
    displayName.value = null
    columns.value = null
    profileSeen.value = false
  }

  function adopt(profile: Profile): void {
    nick.value = profile.nick
    displayName.value = profile.displayName
    columns.value = copyColumns(profile.board.columns)
    profileSeen.value = true
  }

  function applyFailure(failure: PortFailure, action?: PhraseAction): void {
    if (failure.kind === 'access') {
      resetGuest()
      phraseText.value = phrase.needSignIn
      return
    }
    if (failure.kind === 'network') {
      phraseText.value = phrase.network
      return
    }
    if (failure.code) {
      phraseText.value = phraseForCode(failure.code, action)
      return
    }
    if (failure.kind === 'store') {
      phraseText.value = phrase.storeUnavailable
      return
    }
    if (failure.kind === 'service') {
      phraseText.value = phrase.serviceFailed
      return
    }
    phraseText.value = phrase.requestFailed
  }

  function focusFor(failure: PortFailure): FieldHint {
    if (failure.code === 'nick_invalid' || failure.code === 'nick_taken' || failure.code === 'sign_in_failed') {
      return 'nick'
    }
    if (failure.code === 'password_invalid') return 'password'
    if (failure.code === 'display_name_invalid') return 'name'
    return null
  }

  function insertCard(card: Card, columnName: ColumnName): void {
    if (!columns.value) return
    columns.value = columns.value.map((column) => {
      if (column.name !== columnName) return column
      return { ...column, cards: [...column.cards, card].sort(byCreated) }
    })
  }

  function removeCard(cardId: string): void {
    if (!columns.value) return
    columns.value = columns.value.map((column) => ({
      ...column,
      cards: column.cards.filter((card) => card.id !== cardId),
    }))
  }

  async function register(input: { name: string; nick: string; password: string }): Promise<Attempt> {
    if (input.name.length === 0) {
      phraseText.value = phrase.needName
      return stay('name')
    }
    if (input.nick.length === 0) {
      phraseText.value = phrase.needNick
      return stay('nick')
    }
    if (input.password.length === 0) {
      phraseText.value = phrase.needPassword
      return stay('password')
    }
    const result = await port.openAccount({
      nick: input.nick,
      password: input.password,
      displayName: input.name,
    })
    if (!result.ok) {
      if (result.signedIn && result.nick) {
        nick.value = result.nick
        displayName.value = result.nick
        columns.value = null
        profileSeen.value = false
      }
      applyFailure(result.failure)
      return result.signedIn ? close() : { action: 'stay', focus: focusFor(result.failure) }
    }
    adopt(result.profile)
    if (result.nameFailure) applyFailure(result.nameFailure)
    else phraseText.value = null
    return close()
  }

  async function signIn(input: { nick: string; password: string }): Promise<Attempt> {
    if (input.nick.trim().length === 0) {
      phraseText.value = phrase.needNick
      return stay('nick')
    }
    if (input.password.length === 0) {
      phraseText.value = phrase.needPassword
      return stay('password')
    }
    const signed = await port.signIn({ nick: input.nick.trim(), password: input.password })
    if (!signed.ok) {
      applyFailure(signed)
      return stay('nick')
    }
    nick.value = input.nick.trim()
    displayName.value = input.nick.trim()
    const profile = await port.getProfile()
    if (!profile.ok) {
      if (profile.kind === 'access') {
        resetGuest()
        phraseText.value = phrase.needSignIn
        return close()
      }
      columns.value = null
      profileSeen.value = false
      applyFailure(profile)
      return close()
    }
    adopt(profile.data)
    phraseText.value = null
    return close()
  }

  async function createCard(body: CardCreate): Promise<Attempt> {
    if (!profileSeen.value) return stay(null)
    const title = body.title.trim()
    if (title.length === 0) {
      phraseText.value = phrase.needTitle
      return stay('title')
    }
    const tag = body.tags?.[0] ?? ''
    if (Array.from(tag).length > 32) {
      phraseText.value = phrase.categoryTooLong
      return stay('category')
    }
    const result = await port.createCard({
      columnName: body.columnName,
      title,
      description: body.description ?? null,
      tags: tag.length > 0 ? [tag] : [],
      deadline: body.deadline ?? null,
    })
    if (!result.ok) {
      const access = result.kind === 'access'
      applyFailure(result, 'create-card')
      return access ? close() : stay(null)
    }
    insertCard(result.data, body.columnName)
    phraseText.value = null
    return close()
  }

  async function deleteCard(cardId: string): Promise<Attempt> {
    const result = await port.deleteCard(cardId)
    if (!result.ok) {
      const access = result.kind === 'access'
      applyFailure(result, 'delete-card')
      return access ? close() : stay(null)
    }
    removeCard(cardId)
    phraseText.value = null
    return close()
  }

  async function saveProfile(input: ProfileDraft): Promise<Attempt> {
    if (input.changePassword && input.changePassword.newPassword !== input.changePassword.repeat) {
      phraseText.value = phrase.passwordMismatch
      return stay(null)
    }
    if (input.changePassword) {
      const changed = await port.changePassword({
        currentPassword: input.changePassword.currentPassword,
        newPassword: input.changePassword.newPassword,
      })
      if (!changed.ok) {
        const access = changed.kind === 'access'
        applyFailure(changed)
        return access ? close() : stay(null)
      }
    }
    const named = await port.changeDisplayName({ displayName: input.displayName })
    if (!named.ok) {
      const access = named.kind === 'access'
      applyFailure(named)
      return access ? close() : stay(null)
    }
    displayName.value = named.data.displayName
    phraseText.value = null
    return stay(null)
  }

  async function signOut(): Promise<void> {
    await port.endSession()
    resetGuest()
    phraseText.value = null
  }

  function clearPhrase(): void {
    phraseText.value = null
  }

  return {
    nick,
    displayName,
    columns,
    phraseText,
    profileSeen,
    signedIn,
    register,
    signIn,
    createCard,
    deleteCard,
    saveProfile,
    signOut,
    clearPhrase,
  }
})
