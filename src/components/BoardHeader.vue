<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  signedIn: boolean
  displayName: string | null
}>()

const emit = defineEmits<{
  add: [source: HTMLElement]
  signIn: [source: HTMLElement]
  profile: [source: HTMLElement]
}>()

const signInButton = ref<HTMLButtonElement | null>(null)
const letter = computed(() => Array.from(props.displayName ?? '')[0] ?? '')

function sourceOf(event: Event): HTMLElement | null {
  return event.currentTarget instanceof HTMLElement ? event.currentTarget : null
}

function onAdd(event: Event): void {
  const source = sourceOf(event)
  if (source) emit('add', source)
}

function onSignIn(event: Event): void {
  const source = sourceOf(event)
  if (source) emit('signIn', source)
}

function onProfile(event: Event): void {
  const source = sourceOf(event)
  if (source) emit('profile', source)
}

function focusSignIn(): void {
  signInButton.value?.focus()
}

defineExpose({ focusSignIn })
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <span class="tile" aria-hidden="true"></span>
      <span class="brand-name">Board</span>
    </div>
    <div class="top-actions">
      <button type="button" class="add" aria-label="Добавить карточку" @click="onAdd">+</button>
      <button v-if="!signedIn" ref="signInButton" type="button" class="ghost" @click="onSignIn">Войти</button>
      <button
        v-else
        type="button"
        class="profile-mark"
        :aria-label="`Профиль, ${displayName}`"
        @click="onProfile"
      >
        <span class="letter" aria-hidden="true">{{ letter }}</span>
        <span>{{ displayName }}</span>
      </button>
    </div>
  </header>
</template>
