<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import AuthDialog from '../components/AuthDialog.vue'
import BoardColumns from '../components/BoardColumns.vue'
import BoardHeader from '../components/BoardHeader.vue'
import CardDialog from '../components/CardDialog.vue'
import ProfileDialog from '../components/ProfileDialog.vue'
import { useAccountStore, type Attempt, type FieldHint, type ProfileDraft } from '../stores/accountStore'
import type { Card, CardCreate, ColumnName } from '../types/accountBoard'

const store = useAccountStore()
const header = ref<{ focusSignIn: () => void } | null>(null)
const dialog = ref<null | 'auth' | 'card' | 'profile'>(null)
const opener = ref<HTMLElement | null>(null)
const editing = ref<Card | null>(null)
const editingColumn = ref<ColumnName>('ToDo')
const focusField = ref<FieldHint>(null)
const focusTick = ref(0)

const knownTags = computed(() => {
  const tags = ['UX Design', 'UI Design', 'Testing', 'Project Management']
  for (const column of store.columns ?? []) {
    for (const card of column.cards) {
      const tag = card.tags[0]
      if (tag && !tags.includes(tag)) tags.push(tag)
    }
  }
  return tags
})

function closeDialog(): void {
  const target = opener.value
  dialog.value = null
  editing.value = null
  void nextTick(() => {
    if (target?.isConnected) target.focus()
  })
}

function openFrom(source: HTMLElement, next: 'auth' | 'card' | 'profile'): void {
  if (dialog.value) return
  opener.value = source
  store.clearPhrase()
  focusField.value = null
  dialog.value = next
}

function apply(result: Attempt): void {
  focusField.value = result.focus
  if (result.focus) focusTick.value += 1
  if (result.action === 'close') closeDialog()
}

function onAdd(source: HTMLElement): void {
  if (store.profileSeen && store.columns) {
    editing.value = null
    editingColumn.value = 'ToDo'
    openFrom(source, 'card')
    return
  }
  if (!store.signedIn) openFrom(source, 'auth')
}

function onSignIn(source: HTMLElement): void {
  if (!store.signedIn) openFrom(source, 'auth')
}

function onProfile(source: HTMLElement): void {
  if (store.signedIn) openFrom(source, 'profile')
}

function onEdit(card: Card, column: ColumnName, source: HTMLElement): void {
  editing.value = card
  editingColumn.value = column
  openFrom(source, 'card')
}

async function onAuthSubmit(payload: {
  mode: 'sign-in' | 'create'
  name: string
  nick: string
  password: string
}): Promise<void> {
  if (payload.mode === 'create') {
    apply(await store.register({ name: payload.name, nick: payload.nick, password: payload.password }))
    return
  }
  apply(await store.signIn({ nick: payload.nick, password: payload.password }))
}

async function onCreate(body: CardCreate): Promise<void> {
  apply(await store.createCard(body))
}

async function onDelete(): Promise<void> {
  if (!editing.value) return
  apply(await store.deleteCard(editing.value.id))
}

async function onSave(draft: ProfileDraft): Promise<void> {
  apply(await store.saveProfile(draft))
}

async function onSignOut(): Promise<void> {
  await store.signOut()
  dialog.value = null
  editing.value = null
  await nextTick()
  header.value?.focusSignIn()
}
</script>

<template>
  <div class="canvas" :inert="dialog !== null">
    <BoardHeader
      ref="header"
      :signed-in="store.signedIn"
      :display-name="store.displayName"
      @add="onAdd"
      @sign-in="onSignIn"
      @profile="onProfile"
    />
    <p v-if="!store.signedIn" class="invite">Войдите, чтобы открыть свою доску</p>
    <p v-if="store.phraseText && dialog === null" class="phrase" role="alert">{{ store.phraseText }}</p>
    <BoardColumns
      v-if="store.profileSeen && store.columns"
      :columns="store.columns"
      @edit="onEdit"
    />
  </div>
  <AuthDialog
    v-if="dialog === 'auth'"
    :message="store.phraseText"
    :focus-field="focusField"
    :focus-tick="focusTick"
    @close="closeDialog"
    @submit="onAuthSubmit"
  />
  <CardDialog
    v-if="dialog === 'card'"
    :card="editing"
    :column-name="editingColumn"
    :known-tags="knownTags"
    :message="store.phraseText"
    :focus-field="focusField"
    :focus-tick="focusTick"
    @close="closeDialog"
    @create="onCreate"
    @delete="onDelete"
  />
  <ProfileDialog
    v-if="dialog === 'profile' && store.nick && store.displayName"
    :display-name="store.displayName"
    :nick="store.nick"
    :message="store.phraseText"
    :focus-field="focusField"
    :focus-tick="focusTick"
    @close="closeDialog"
    @save="onSave"
    @sign-out="onSignOut"
  />
</template>
