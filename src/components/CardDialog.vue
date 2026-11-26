<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { FieldHint } from '../stores/accountStore'
import { columnLabel, type Card, type CardCreate, type ColumnName } from '../types/accountBoard'

const PRESETS = ['UX Design', 'UI Design', 'Testing', 'Project Management'] as const

const props = defineProps<{
  card: Card | null
  columnName: ColumnName
  knownTags: string[]
  message: string | null
  focusField: FieldHint | null
  focusTick: number
}>()

const emit = defineEmits<{
  close: []
  create: [body: CardCreate]
  delete: []
}>()

const readOnly = computed(() => props.card !== null)
const title = ref(props.card?.title ?? '')
const description = ref(props.card?.description ?? '')
const deadline = ref(props.card?.deadline ?? '')
const column = ref<ColumnName>(props.columnName)
const initialTag = props.card?.tags[0] ?? 'UX Design'
const preset = PRESETS.find((item) => item === initialTag)
const category = ref<string>(preset ?? 'custom')
const custom = ref(preset || !props.card ? '' : initialTag)
const titleInput = ref<HTMLInputElement | null>(null)
const customInput = ref<HTMLInputElement | null>(null)
const accessibleName = computed(() => (readOnly.value ? 'Редактирование' : 'Новая карточка'))

function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  if (!readOnly.value) titleInput.value?.focus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
})

watch(category, (value) => {
  if (value !== 'custom') custom.value = ''
})

watch(
  () => props.focusTick,
  () => {
    if (props.focusField === 'title') titleInput.value?.focus()
    if (props.focusField === 'category') customInput.value?.focus()
  },
)

function onCustomInput(): void {
  category.value = 'custom'
}

function chosenTag(): string {
  const typed = custom.value.trim()
  if (typed.length > 0) {
    const known = props.knownTags.find((item) => item.toLocaleLowerCase() === typed.toLocaleLowerCase())
    return known ?? typed
  }
  if ((PRESETS as readonly string[]).includes(category.value)) return category.value
  return 'UX Design'
}

function submit(): void {
  if (readOnly.value) return
  emit('create', {
    columnName: column.value,
    title: title.value,
    description: description.value.trim() ? description.value.trim() : null,
    tags: [chosenTag()],
    deadline: deadline.value.trim() ? deadline.value.trim() : null,
  })
}
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true" :aria-label="accessibleName" @click.stop>
      <button type="button" class="dialog-close" aria-label="Закрыть" @click="emit('close')">×</button>
      <p class="eyebrow">Карточка</p>
      <form class="stack" @submit.prevent="submit">
        <label class="field">
          <span class="sr-only">Название</span>
          <input
            ref="titleInput"
            v-model="title"
            class="title-input"
            placeholder="Название"
            aria-label="Название"
            :readonly="readOnly"
          />
        </label>
        <label class="field">
          Описание
          <textarea v-model="description" rows="3" :readonly="readOnly"></textarea>
        </label>
        <fieldset class="field">
          <legend>Категория</legend>
          <div class="choice">
            <label v-for="item in PRESETS" :key="item">
              <input v-model="category" type="radio" name="category" :value="item" :disabled="readOnly" />
              {{ item }}
            </label>
            <label>
              Новая
              <input
                ref="customInput"
                v-model="custom"
                :readonly="readOnly"
                @input="onCustomInput"
              />
            </label>
          </div>
        </fieldset>
        <fieldset class="field">
          <legend>Колонка</legend>
          <div class="choice">
            <label v-for="(label, name) in columnLabel" :key="name">
              <input v-model="column" type="radio" name="column" :value="name" :disabled="readOnly" />
              {{ label }}
            </label>
          </div>
        </fieldset>
        <label class="field">
          Дата
          <input v-model="deadline" type="text" :readonly="readOnly" />
        </label>
        <p v-if="message" class="alert" role="alert">{{ message }}</p>
        <div class="dialog-actions">
          <template v-if="readOnly">
            <button type="button" class="ghost" @click="emit('delete')">Удалить</button>
            <button type="button" class="ghost" @click="emit('close')">Отмена</button>
          </template>
          <template v-else>
            <button type="button" class="ghost" @click="emit('close')">Отмена</button>
            <button type="submit" class="primary">Создать</button>
          </template>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

fieldset {
  margin: 0;
  padding: 0;
  border: 0;
}
</style>
