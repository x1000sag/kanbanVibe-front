<script setup lang="ts">
import CardView from './CardView.vue'
import { columnLabel, type Card, type Column, type ColumnName } from '../types/accountBoard'

defineProps<{ columns: Column[] }>()
const emit = defineEmits<{ edit: [card: Card, column: ColumnName, source: HTMLElement] }>()

const columnClass: Record<ColumnName, string> = {
  ToDo: 'column column-todo',
  InProgress: 'column column-progress',
  Done: 'column column-done',
}
</script>

<template>
  <div class="columns">
    <section v-for="column in columns" :key="column.name" :class="columnClass[column.name]">
      <h2>{{ columnLabel[column.name] }}</h2>
      <p v-if="column.cards.length === 0" class="empty">Пусто</p>
      <CardView
        v-for="card in column.cards"
        :key="card.id"
        :card="card"
        @edit="emit('edit', card, column.name, $event)"
      />
    </section>
  </div>
</template>

<style scoped>
.column-todo {
  background: oklch(0.94 0.03 250);
}
.column-progress {
  background: oklch(0.94 0.04 75);
}
.column-done {
  background: oklch(0.94 0.04 155);
}
</style>
