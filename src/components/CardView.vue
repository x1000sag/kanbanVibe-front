<script setup lang="ts">
import { computed } from 'vue'
import type { Card } from '../types/accountBoard'

const props = defineProps<{ card: Card }>()
const emit = defineEmits<{ edit: [source: HTMLElement] }>()

const presetClass: Record<string, string> = {
  'UX Design': 'tag-ux',
  'UI Design': 'tag-ui',
  Testing: 'tag-test',
  'Project Management': 'tag-pm',
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const tag = computed(() => props.card.tags[0] ?? '')
const tagClass = computed(() => presetClass[tag.value] ?? 'tag-custom')
const when = computed(() => formatDeadline(props.card.deadline))

function formatDeadline(value: string | null): string {
  if (!value) return ''
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return ''
  const month = Number(match[2])
  const day = Number(match[3])
  const label = months[month - 1]
  if (!label || day < 1) return ''
  return `${day} ${label}`
}

function onEdit(event: Event): void {
  if (event.currentTarget instanceof HTMLElement) emit('edit', event.currentTarget)
}
</script>

<template>
  <article class="card">
    <p v-if="tag" class="card-tag" :class="tagClass">{{ tag }}</p>
    <h3 class="card-title">{{ card.title }}</h3>
    <p v-if="card.description" class="card-description">{{ card.description }}</p>
    <div class="card-foot">
      <button type="button" class="card-edit" :aria-label="`Edit, ${card.title}`" @click="onEdit">Edit</button>
      <span v-if="when" class="card-date">{{ when }}</span>
    </div>
  </article>
</template>
