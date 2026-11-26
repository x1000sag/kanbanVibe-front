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
      <h2 class="column-head">{{ columnLabel[column.name] }}</h2>
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
.column-head {
  align-self: flex-start;
  margin: 0;
  padding: 7px 14px;
  border-radius: 8px;
  font-family: 'DM Sans', sans-serif;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.2;
  box-shadow:
    0 1px 2px oklch(0.22 0.02 50 / 0.07),
    0 3px 10px oklch(0.22 0.03 50 / 0.05);
}

.column-todo .column-head {
  background: oklch(0.94 0.03 250);
  color: oklch(0.42 0.06 250);
}

.column-progress .column-head {
  background: oklch(0.94 0.04 75);
  color: oklch(0.45 0.08 75);
}

.column-done .column-head {
  background: oklch(0.94 0.04 155);
  color: oklch(0.42 0.07 155);
}
</style>
