<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { FieldHint, ProfileDraft } from '../stores/accountStore'

const props = defineProps<{
  displayName: string
  nick: string
  message: string | null
  focusField: FieldHint | null
  focusTick: number
}>()

const emit = defineEmits<{
  close: []
  save: [draft: ProfileDraft]
  signOut: []
}>()

const name = ref(props.displayName)
const passwordOpen = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const repeatPassword = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
const letter = computed(() => Array.from(props.displayName)[0] ?? '')

function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  nameInput.value?.focus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
})

watch(
  () => props.focusTick,
  () => {
    if (props.focusField === 'name') nameInput.value?.focus()
  },
)

watch(
  () => props.displayName,
  (value) => {
    name.value = value
  },
)

function save(): void {
  const draft: ProfileDraft = {
    displayName: name.value,
    changePassword: passwordOpen.value
      ? {
          currentPassword: currentPassword.value,
          newPassword: newPassword.value,
          repeat: repeatPassword.value,
        }
      : null,
  }
  currentPassword.value = ''
  newPassword.value = ''
  repeatPassword.value = ''
  emit('save', draft)
}
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title" @click.stop>
      <button type="button" class="dialog-close" aria-label="Закрыть" @click="emit('close')">×</button>
      <p class="profile-letter" aria-hidden="true">{{ letter }}</p>
      <p class="eyebrow">Профиль</p>
      <h2 id="profile-title" class="dialog-title">{{ displayName }}</h2>
      <form class="stack" @submit.prevent="save">
        <label class="field">
          Имя на доске
          <input ref="nameInput" v-model="name" autocomplete="off" />
        </label>
        <label class="field">
          Логин
          <input :value="nick" readonly />
        </label>
        <button
          type="button"
          class="ghost password-toggle"
          :aria-expanded="passwordOpen"
          @click="passwordOpen = !passwordOpen"
        >
          Сменить пароль
        </button>
        <template v-if="passwordOpen">
          <label class="field">
            Текущий пароль
            <input v-model="currentPassword" type="password" autocomplete="off" />
          </label>
          <label class="field">
            Новый пароль
            <input v-model="newPassword" type="password" autocomplete="off" />
          </label>
          <label class="field">
            Повтор
            <input v-model="repeatPassword" type="password" autocomplete="off" />
          </label>
        </template>
        <p v-if="message" class="alert" role="alert">{{ message }}</p>
        <div class="dialog-actions">
          <button type="button" class="ghost" @click="emit('signOut')">Выйти</button>
          <button type="button" class="ghost" @click="emit('close')">Назад</button>
          <button type="button" class="ghost" @click="emit('close')">Закрыть</button>
          <button type="submit" class="primary">Сохранить</button>
        </div>
      </form>
    </div>
  </div>
</template>
