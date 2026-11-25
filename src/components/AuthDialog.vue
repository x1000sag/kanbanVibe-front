<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { FieldHint } from '../stores/accountStore'

const props = defineProps<{
  message: string | null
  focusField: FieldHint | null
  focusTick: number
}>()

const emit = defineEmits<{
  close: []
  submit: [payload: { mode: 'sign-in' | 'create'; name: string; nick: string; password: string }]
}>()

const mode = ref<'sign-in' | 'create'>('sign-in')
const name = ref('')
const nick = ref('')
const password = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
const nickInput = ref<HTMLInputElement | null>(null)
const passwordInput = ref<HTMLInputElement | null>(null)
const dialogTitle = ref('Войти')

function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  emit('close')
}

function focusInitial(): void {
  if (mode.value === 'create') nameInput.value?.focus()
  else nickInput.value?.focus()
}

function focusHint(field: FieldHint | null): void {
  if (field === 'name') nameInput.value?.focus()
  if (field === 'nick') nickInput.value?.focus()
  if (field === 'password') passwordInput.value?.focus()
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  focusInitial()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
})

watch(
  () => props.focusTick,
  () => focusHint(props.focusField),
)

function switchMode(next: 'sign-in' | 'create'): void {
  mode.value = next
  dialogTitle.value = next === 'create' ? 'Создать аккаунт' : 'Войти'
  password.value = ''
  void nextTick(() => focusInitial())
}

function submit(): void {
  const payload = {
    mode: mode.value,
    name: name.value,
    nick: nick.value,
    password: password.value,
  }
  password.value = ''
  emit('submit', payload)
}
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-title"
      @click.stop
    >
      <button type="button" class="dialog-close" aria-label="Закрыть" @click="emit('close')">×</button>
      <div class="brand">
        <span class="tile" aria-hidden="true"></span>
        <span class="brand-name">Board</span>
      </div>
      <p class="eyebrow">Доска</p>
      <h2 id="auth-title" class="dialog-title">{{ dialogTitle }}</h2>
      <form class="stack" @submit.prevent="submit">
        <label v-if="mode === 'create'" class="field">
          Имя
          <input ref="nameInput" v-model="name" autocomplete="off" />
        </label>
        <label class="field">
          Логин
          <input ref="nickInput" v-model="nick" autocomplete="off" />
        </label>
        <label class="field">
          Пароль
          <input ref="passwordInput" v-model="password" type="password" autocomplete="off" />
        </label>
        <p v-if="message" class="alert" role="alert">{{ message }}</p>
        <button type="submit" class="wide">{{ mode === 'create' ? 'Создать аккаунт' : 'Войти' }}</button>
        <button
          v-if="mode === 'sign-in'"
          type="button"
          class="linkish"
          @click="switchMode('create')"
        >
          Нет аккаунта — создать
        </button>
        <button v-else type="button" class="linkish" @click="switchMode('sign-in')">Уже есть аккаунт</button>
        <button type="button" class="ghost" @click="emit('close')">Отмена</button>
      </form>
    </div>
  </div>
</template>
